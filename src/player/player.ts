import type { Button, CoreCallbacks, DebugHooks, EmulatorCore, Player as Player1Or2, SaveState, VideoDescription } from "../core/types";
import { findGameMap } from "../games";
import { withoutOpposites } from "../input/opposites";
import type { GameMemoryMap } from "../games/gameMap";
import { assertionsFor } from "../movie/expectations";
import { encodeBase64, type Checkpoint, type CheckpointExpectation, type Movie, type MovieStart } from "../movie/format";
import { applyPad, maskOf, type PadMask } from "../movie/pads";
import { MovieRecorder } from "../movie/recorder";
import { DEFAULT_REPLAY_SECONDS, REPLAY_SECONDS, REPLAY_STATE_INTERVAL_SECONDS, ReplayBuffer, type ReplayBufferStats, type ReplaySeconds } from "../movie/replayBuffer";
import { bootMovie, evaluateCheckpoint, MovieRunner, requireMovieRom, type CheckpointResult } from "../movie/runner";
import { screenHash } from "../movie/screenHash";
import type { GameStore, RomRecord, StateRecord, StateSlot } from "../storage/gameStore";
import { FramePacer } from "../timing/framePacer";

export type RecordStart = { from: "power-on"; keepBatteryRam: boolean } | { from: "current-state" };

export interface MovieStatus {
  mode: "idle" | "recording" | "playing";
  /** Frames recorded or replayed so far. */
  frame: number;
  /** The movie's length while playing. */
  frames: number | null;
  /** Checkpoint results of the replay running now or last finished. */
  results: CheckpointResult[];
  /** True once a replay has run to its last frame. */
  finished: boolean;
}

/** How often, at most, battery RAM the game has written is stored. */
export const BATTERY_SAVE_INTERVAL_MS = 1000;

/** user: the menu. hidden: the tab is hidden. focus: the window lost focus, until a click or key. console: the developer console's pause. */
export type PauseReason = "user" | "hidden" | "focus" | "console";

/** The slowest and fastest rates the console's speed command sets. */
export const RATE_RANGE = { min: 0.25, max: 4 } as const;

export interface PlayerDeps {
  createCore(callbacks: CoreCallbacks): EmulatorCore;
  store: GameStore;
  audio: { writeSample(left: number, right: number): void; flush(): void; pause(): Promise<void>; resume(): Promise<void> };
  /** setSize comes first with the core's frame size; every setFrame after it has that many pixels. */
  screen: { setSize(width: number, height: number): void; setFrame(pixels: Uint32Array): void; present(): void };
  requestFrame(callback: (timeMs: number) => void): number;
  cancelFrame(handle: number): void;
  /** Called once per animation frame while running (gamepad polling). */
  onAnimationFrame?(): void;
  onError(message: string): void;
  /** Called after each battery save, save state or resume state is stored. */
  onSaved?(): void;
  /**
   * Called once when a replay runs to its last frame. Polling movieStatus()
   * misses a replay shorter than the poll interval, since it never sees it playing.
   */
  onMovieFinished?(status: MovieStatus): void;
}

export interface LoadedGame {
  id: string;
  name: string;
}

/** Runs one game: the frame loop, pausing, battery RAM and save states. */
export class Player {
  private core: EmulatorCore | null = null;
  private game: LoadedGame | null = null;
  /** Paced at the open core's frame rate; made when a game opens. */
  private pacer: FramePacer | null = null;
  /** Frames run per paced frame: 1, or the fast-forward speed. */
  private speedMultiplier = 1;
  /** The pace against the core's frame rate, from RATE_RANGE: 0.5 runs at half speed. */
  private paceRate = 1;
  /** True while step() runs frames: their sound is dropped, as the paused audio would play it late. */
  private stepping = false;
  private readonly pauseReasons = new Set<PauseReason>();
  private frameHandle: number | null = null;
  private batteryDirty = false;
  private lastBatterySaveMs = 0;
  private batteryWrite: Promise<void> = Promise.resolve();
  private fpsWindow: { startMs: number; frames: number } | null = null;
  private readonly held = new Set<string>();
  private rom: RomRecord | null = null;
  private gameMap: GameMemoryMap | null = null;
  private lastPixels: Uint32Array | null = null;
  private recorder: MovieRecorder | null = null;
  private playback: MovieRunner | null = null;
  private playbackResults: CheckpointResult[] = [];
  private playbackFinished = false;
  private replaySeconds: ReplaySeconds = DEFAULT_REPLAY_SECONDS;
  /** The instant replay's buffer: null while it is off, no game is open, or a movie records or plays. */
  private replay: ReplayBuffer | null = null;
  /**
   * Set from the start of a recording or replay until the game is opened
   * again: the machine then runs from the movie's battery RAM, which must not
   * overwrite the player's own save in the store.
   */
  private batterySuspended = false;
  /** The tools' hooks, set on every core this player makes until removed. */
  private debugHooks: DebugHooks | null = null;
  framesRun = 0;
  /** The movie the last recording produced. */
  lastRecording: Movie | null = null;
  /** Emulated frames per second over the last full second of running. */
  measuredFps = 0;
  batterySaves = 0;
  restoredBatteryRam: Uint8Array | null = null;
  /** screenHash() of the picture restored when the game last opened from its resume state, or null. */
  continuedScreenHash: string | null = null;

  constructor(private readonly deps: PlayerDeps) {}

  get loadedGame(): LoadedGame | null {
    return this.game;
  }

  get running(): boolean {
    return this.frameHandle !== null;
  }

  /** The open game's picture size, pixel shape and frame rate, or null with no game open. */
  get video(): VideoDescription | null {
    return this.core?.video ?? null;
  }

  get speed(): number {
    return this.speedMultiplier;
  }

  /**
   * Runs `multiplier` frames for each one due: 1 is normal speed, more is
   * fast-forward. Sound is dropped while fast-forwarding: the audio ring
   * holds about 100 ms, so two to four times the samples would overflow it
   * and play back as broken, wrongly pitched sound.
   */
  setSpeed(multiplier: number): void {
    if (!Number.isInteger(multiplier) || multiplier < 1) throw new RangeError(`Speed must be a whole number from 1, got ${multiplier}.`);
    this.speedMultiplier = multiplier;
  }

  get rate(): number {
    return this.paceRate;
  }

  /**
   * Paces the game at `rate` times the core's frame rate, slower or faster,
   * on top of any fast-forward. Sound is dropped at any rate but 1, for the
   * same reason as in fast-forward and because slowed sound would underrun.
   */
  setRate(rate: number): void {
    if (!(rate >= RATE_RANGE.min && rate <= RATE_RANGE.max)) throw new RangeError(`The speed must be ${RATE_RANGE.min} to ${RATE_RANGE.max}, not ${rate}.`);
    this.paceRate = rate;
    if (this.core) this.pacer = new FramePacer(this.core.video.frameRate * rate);
  }

  /** The last frame's picture at the core's own size, or null with no game open. */
  picture(): { video: VideoDescription; pixels: Uint32Array } | null {
    const core = this.core;
    return core ? { video: core.video, pixels: core.picture() } : null;
  }

  isPausedBy(reason: PauseReason): boolean {
    return this.pauseReasons.has(reason);
  }

  /**
   * Starts the game from power-on, or, given its resume state, on the frame it
   * was left on. Throws, with a message for the user, when the ROM cannot run.
   */
  async open(rom: RomRecord, resume?: SaveState): Promise<void> {
    const core = this.newCore();
    // Load first: a ROM that fails leaves the game already running untouched.
    core.load(rom.data);
    const gameMap = await findGameMap(rom.data);
    this.stopLoop();
    await this.saveBatteryRam();
    const saved = core.batteryRam() === null ? undefined : await this.deps.store.getBatteryRam(rom.id);
    if (saved) core.restoreBatteryRam(saved);
    this.restoredBatteryRam = saved ?? null;
    if (resume) core.loadState(resume);
    this.core = core;
    this.pacer = new FramePacer(core.video.frameRate * this.paceRate);
    this.deps.screen.setSize(core.video.width, core.video.height);
    this.rom = rom;
    this.gameMap = gameMap;
    this.recorder = null;
    this.playback = null;
    this.playbackResults = [];
    this.playbackFinished = false;
    this.batterySuspended = false;
    this.lastPixels = null;
    this.restartReplay();
    // Buttons still held from the last game stay held in this one.
    this.applyHeldPads();
    this.game = { id: rom.id, name: rom.name };
    // A resume state carries its own cartridge RAM; keep the battery save in step, as loadState does.
    this.batteryDirty = resume !== undefined;
    this.framesRun = 0;
    this.continuedScreenHash = null;
    if (resume) {
      // The restored picture shows at once, before the next frame runs.
      this.lastPixels = core.picture();
      this.deps.screen.setFrame(this.lastPixels);
      this.deps.screen.present();
      this.continuedScreenHash = screenHash(this.lastPixels);
    }
    this.startLoopIfUnpaused();
  }

  /**
   * Stores the game as it is now as its resume state, with `thumbnail` (the
   * picture now, as a data: URL). Skipped while a movie records or plays and
   * after one until the game is opened again: the machine then runs from the
   * movie's start, and continuing from it would put the movie's battery RAM
   * in place of the player's own save.
   */
  saveResume(thumbnail: string | null): Promise<void> {
    if (!this.game || !this.core || this.batterySuspended) return Promise.resolve();
    return this.deps.store.putResume(this.game.id, this.core.saveState(), thumbnail).then(() => this.deps.onSaved?.());
  }

  /** Throws while a movie plays: its resets come from the movie. */
  reset(): void {
    if (this.playback) throw new Error("A movie is playing; stop it to reset.");
    this.requireCore().reset();
    this.recorder?.recordReset();
    this.replay?.recordReset();
  }

  /**
   * Input before a game is loaded has nowhere to go and is dropped. While a
   * movie plays the pads are locked out: the press is remembered, and reaches
   * the game once the movie ends. `held` keeps the order buttons were
   * pressed in, which decides which of two opposite directions the game sees.
   */
  setButton(pad: Player1Or2, button: Button, pressed: boolean): void {
    if (!this.core) return;
    const key = `${pad}:${button}`;
    this.held.delete(key);
    if (pressed) this.held.add(key);
    if (this.playback) return;
    this.applyHeldPads();
  }

  /** Starts recording; from power-on the game restarts first. */
  startRecording(start: RecordStart): void {
    const core = this.requireCore();
    const rom = this.requireRom();
    if (this.recorder || this.playback) throw new Error("A movie is already recording or playing.");
    let movieStart: MovieStart;
    if (start.from === "current-state") {
      movieStart = { kind: "save-state", state: core.saveState() };
    } else {
      const battery = start.keepBatteryRam ? core.batteryRam() : null;
      movieStart = { kind: "power-on", batteryRam: battery ? encodeBase64(battery) : null };
      this.restartCore(movieStart);
    }
    this.batterySuspended = true;
    this.replay = null;
    this.recorder = new MovieRecorder({
      rom: { name: rom.name, sha256: rom.id },
      core: { name: this.requireCore().name, version: this.requireCore().version },
      start: movieStart,
    });
  }

  /**
   * Ends the recording and returns its movie. A recording in which no frame
   * ran (started and stopped in the paused menu, or twice in one frame) ends
   * too, but throws instead: a movie of no frames replays nothing, and its
   * marks would all check the start.
   */
  stopRecording(): Movie {
    if (!this.recorder) throw new Error("Nothing is recording.");
    const movie = this.recorder.finish();
    this.recorder = null;
    this.restartReplay();
    if (movie.frames === 0) throw new Error("Nothing was recorded: no frame ran while recording (the game was paused), so no movie is saved.");
    this.lastRecording = movie;
    return movie;
  }

  /** Adds a checkpoint at the current frame: the picture's hash and the game's readable state. */
  mark(name: string): Checkpoint {
    if (!this.recorder) throw new Error("Marks are added while recording.");
    return this.recorder.mark(name, this.checkpointExpectation());
  }

  /**
   * Seconds the instant replay covers; 0 turns it off. The buffer starts
   * over, so a replay never mixes frames kept under two lengths.
   */
  setReplaySeconds(seconds: ReplaySeconds): void {
    if (!REPLAY_SECONDS.includes(seconds)) throw new RangeError(`The replay length must be one of ${REPLAY_SECONDS.join(", ")} seconds, got ${seconds}.`);
    this.replaySeconds = seconds;
    this.restartReplay();
  }

  /** What the instant replay holds now, or null while it is not kept. */
  replayStats(): ReplayBufferStats | null {
    return this.replay?.stats() ?? null;
  }

  /**
   * A movie of the last replaySeconds (up to one state interval more), from
   * the oldest state kept to now, ending in a checkpoint of the picture now.
   * Throws, with a message for the user, when there is nothing to save.
   */
  saveReplay(): Movie {
    const rom = this.requireRom();
    const core = this.requireCore();
    if (this.recorder || this.playback) throw new Error("The last minute is not kept while a movie records or plays.");
    if (!this.replay) throw new Error("The instant replay is off; turn it on in Record and play movie.");
    return this.replay.toMovie({ rom: { name: rom.name, sha256: rom.id }, core: { name: core.name, version: core.version } }, this.checkpointExpectation());
  }

  /** Restarts the game where the movie starts and replays it, pads locked out. */
  playMovie(movie: Movie): void {
    const rom = this.requireRom();
    if (this.recorder) throw new Error("Stop recording before playing a movie.");
    requireMovieRom(movie, rom.id);
    this.restartCore(movie.start);
    this.batterySuspended = true;
    this.replay = null;
    this.playback = new MovieRunner(this.requireCore(), movie);
    this.playbackResults = [];
    this.playbackFinished = false;
    this.evaluateDueCheckpoints();
  }

  /** Ends a replay early; the game goes on under the player's own pads. */
  stopMovie(): void {
    this.playback = null;
    this.applyHeldPads();
    this.restartReplay();
  }

  movieStatus(): MovieStatus {
    if (this.recorder) return { mode: "recording", frame: this.recorder.frameCount, frames: null, results: [], finished: false };
    if (this.playback) {
      return { mode: "playing", frame: this.playback.frame, frames: this.playback.movie.frames, results: [...this.playbackResults], finished: false };
    }
    return { mode: "idle", frame: 0, frames: null, results: [...this.playbackResults], finished: this.playbackFinished };
  }

  /** screenHash() of the last picture, or null before the first frame. */
  currentScreenHash(): string | null {
    return this.lastPixels ? screenHash(this.lastPixels) : null;
  }

  /** The open game's state read through its memory map (Final Fantasy's party, map, gold), or null without one. */
  gameState(): unknown {
    const core = this.core;
    return core && this.gameMap ? this.gameMap.read((address) => core.peek(address)) : null;
  }

  /** A byte of the open game's memory, read without side effects (EmulatorCore.peek). */
  peek(address: number): number {
    return this.requireCore().peek(address);
  }

  /** The open game's memory map id ("ff1"), or null for a game without one. */
  get gameMapId(): string | null {
    return this.gameMap?.id ?? null;
  }

  /**
   * Writes a byte of the open game's RAM (EmulatorCore.poke). Refused while
   * a movie records or plays, which could not replay it; the instant replay
   * starts over, as its frames lead up to the machine before the write.
   */
  poke(address: number, value: number): void {
    const core = this.requireCore();
    if (!core.poke) throw new Error(`The ${core.name} core cannot write RAM.`);
    if (this.recorder || this.playback) throw new Error("A movie is recording or playing; a write to RAM could not be replayed, so stop it first.");
    core.poke(address, value);
    if (address >= 0x6000 && address < 0x8000 && core.batteryRam() !== null) this.batteryDirty = true;
    this.restartReplay();
  }

  /**
   * Runs `frames` frames at once while the game is paused, presenting the
   * last; a movie records or plays them as any frames. Their sound is
   * dropped. Throws while the game runs, where frames come on their own.
   */
  step(frames: number): void {
    const core = this.requireCore();
    if (!Number.isInteger(frames) || frames < 1) throw new RangeError(`Frames to step must be a whole number from 1, got ${frames}.`);
    if (this.running) throw new Error("The game is running; pause it to step frames.");
    this.stepping = true;
    try {
      for (let frame = 0; frame < frames; frame++) this.runFrame(core);
    } finally {
      this.stepping = false;
    }
    this.framesRun += frames;
    this.deps.screen.present();
  }

  /** The 32 palette entries the PPU holds now, as NES colour indices, or null when the core cannot show them. */
  palette(): Uint8Array | null {
    return this.requireCore().ppuSnapshot?.().palette ?? null;
  }

  /** Writes a byte of the open game's PRG ROM (EmulatorCore.pokeRom); throws when its core cannot. */
  pokeRom(address: number, value: number): void {
    const core = this.requireCore();
    if (!core.pokeRom) throw new Error(`The ${core.name} core cannot change a game's ROM.`);
    core.pokeRom(address, value);
  }

  /** Whether the open game's core can run debug hooks; false with no game open. */
  get debugHooksAvailable(): boolean {
    return typeof this.core?.setDebugHooks === "function";
  }

  /**
   * Sets the tools' hooks, or removes them with null. They stay set on the
   * cores a movie or another game brings in, until removed. Throws when a
   * core without hooks is open.
   */
  setDebugHooks(hooks: DebugHooks | null): void {
    const core = this.core;
    if (hooks && core && !core.setDebugHooks) throw new Error(`The ${core.name} core has no debug hooks.`);
    this.debugHooks = hooks;
    core?.setDebugHooks?.(hooks);
  }

  /** Buttons held down now, as "pad:button", e.g. "1:Start". */
  heldButtons(): string[] {
    return [...this.held].sort();
  }

  /** Stops for good (the page is unmounting); stores unsaved battery RAM. */
  dispose(): Promise<void> {
    this.stopLoop();
    return this.saveBatteryRam();
  }

  pause(reason: PauseReason): void {
    this.pauseReasons.add(reason);
    this.stopLoop();
    void this.deps.audio.pause();
    void this.saveBatteryRam();
  }

  resume(reason: PauseReason): void {
    this.pauseReasons.delete(reason);
    this.startLoopIfUnpaused();
  }

  /** `thumbnail` is a small picture of the screen now, as a data: URL. */
  async saveState(slot: StateSlot, thumbnail: string | null): Promise<void> {
    const game = this.requireGame();
    await this.deps.store.putState(game.id, slot, this.requireCore().saveState(), thumbnail);
    this.deps.onSaved?.();
  }

  /** The open game's filled slots. */
  listStates(): Promise<StateRecord[]> {
    return this.deps.store.listStates(this.requireGame().id);
  }

  /** The open game's battery RAM as the store holds it now, or null. */
  async storedBatteryRam(): Promise<Uint8Array | null> {
    await this.batteryWrite;
    return (await this.deps.store.getBatteryRam(this.requireGame().id)) ?? null;
  }

  /**
   * Closes the game, storing unsaved battery RAM first, and blanks the
   * screen. A recording in progress is dropped, and so is a pause the
   * console made: it belongs to the game closed, and the next game opened
   * would otherwise sit on its first frame with nothing saying why.
   */
  async close(): Promise<void> {
    this.stopLoop();
    this.pauseReasons.delete("console");
    await this.saveBatteryRam();
    const video = this.core?.video;
    this.core = null;
    this.game = null;
    this.rom = null;
    this.gameMap = null;
    this.recorder = null;
    this.playback = null;
    this.replay = null;
    this.playbackResults = [];
    this.playbackFinished = false;
    this.lastPixels = null;
    this.restoredBatteryRam = null;
    this.continuedScreenHash = null;
    if (video) {
      this.deps.screen.setFrame(new Uint32Array(video.width * video.height));
      this.deps.screen.present();
    }
  }

  /** Returns false when the slot is empty. */
  async loadState(slot: StateSlot): Promise<boolean> {
    const game = this.requireGame();
    // A movie cannot hold a jump to another state; it would replay wrongly.
    if (this.recorder || this.playback) throw new Error("A movie is recording or playing; stop it to load a state.");
    const record = await this.deps.store.getState(game.id, slot);
    if (!record) return false;
    this.requireCore().loadState(record.state);
    // The state carries its own cartridge RAM; keep the battery save in step.
    this.batteryDirty = true;
    // The frames kept lead up to the machine before the jump, not to this one.
    this.restartReplay();
    return true;
  }

  /** Stores battery RAM now if the game changed it (page hide, game switch). */
  saveBatteryRam(): Promise<void> {
    if (this.batterySuspended || !this.batteryDirty || !this.core || !this.game) return this.batteryWrite;
    const data = this.core.batteryRam();
    const id = this.game.id;
    this.batteryDirty = false;
    if (!data) return this.batteryWrite;
    // Writes are chained so an older image never lands after a newer one.
    this.batteryWrite = this.batteryWrite
      .then(() => this.deps.store.putBatteryRam(id, data))
      .then(() => {
        this.batterySaves++;
        this.deps.onSaved?.();
      })
      .catch((error: unknown) => {
        this.batteryDirty = true;
        this.deps.onError(`The game could not be saved to the browser: ${error instanceof Error ? error.message : String(error)}`);
      });
    return this.batteryWrite;
  }

  currentBatteryRam(): Uint8Array | null {
    return this.core?.batteryRam() ?? null;
  }

  currentState(): SaveState | null {
    return this.core?.saveState() ?? null;
  }

  private startLoopIfUnpaused(): void {
    if (!this.core || !this.pacer || this.pauseReasons.size > 0 || this.frameHandle !== null) return;
    this.pacer.reset();
    this.fpsWindow = null;
    void this.deps.audio.resume();
    this.frameHandle = this.deps.requestFrame(this.onAnimationFrame);
  }

  private stopLoop(): void {
    if (this.frameHandle !== null) this.deps.cancelFrame(this.frameHandle);
    this.frameHandle = null;
  }

  private readonly onAnimationFrame = (timeMs: number): void => {
    const core = this.core;
    const pacer = this.pacer;
    if (!core || !pacer) return;
    this.frameHandle = this.deps.requestFrame(this.onAnimationFrame);
    this.deps.onAnimationFrame?.();
    // Input polled just now can pause the game (the menu chord); no frame runs then.
    if (this.frameHandle === null) return;
    const steps = pacer.tick(timeMs) * this.speedMultiplier;
    try {
      for (let step = 0; step < steps; step++) {
        this.runFrame(core);
        this.deps.audio.flush();
      }
    } catch (error) {
      this.stopLoop();
      this.deps.onError(`The game stopped: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    this.framesRun += steps;
    this.deps.screen.present();
    this.measureFps(timeMs, steps);
    if (this.batteryDirty && timeMs - this.lastBatterySaveMs >= BATTERY_SAVE_INTERVAL_MS) {
      this.lastBatterySaveMs = timeMs;
      void this.saveBatteryRam();
    }
  };

  /**
   * One emulated frame. The pads are applied here, just before core.frame(),
   * from the movie when one plays and from the held buttons otherwise; that
   * is the point a recording takes them from, so a replay feeds each frame
   * the same pads.
   */
  private runFrame(core: EmulatorCore): void {
    const playback = this.playback;
    if (playback) {
      playback.step();
      this.evaluateDueCheckpoints();
      if (playback.done) {
        this.playback = null;
        this.playbackFinished = true;
        this.applyHeldPads();
        this.restartReplay();
        this.deps.onMovieFinished?.(this.movieStatus());
      }
      return;
    }
    const [pad1, pad2] = this.applyHeldPads();
    this.recorder?.recordFrame(pad1, pad2);
    this.replay?.recordFrame(pad1, pad2, () => core.saveState());
    core.frame();
  }

  /** A new, empty buffer when the replay is on and no movie records or plays; none otherwise. */
  private restartReplay(): void {
    const core = this.core;
    if (!core || this.replaySeconds === 0 || this.recorder || this.playback) {
      this.replay = null;
      return;
    }
    const frameRate = core.video.frameRate;
    this.replay = new ReplayBuffer({
      windowFrames: Math.round(this.replaySeconds * frameRate),
      stateIntervalFrames: Math.round(REPLAY_STATE_INTERVAL_SECONDS * frameRate),
    });
  }

  /** The picture's hash and the game's readable state now, as a Mark or the replay's end checks them. */
  private checkpointExpectation(): CheckpointExpectation {
    const core = this.requireCore();
    const memory = this.gameMap ? assertionsFor(this.gameMap.read((address) => core.peek(address))) : [];
    return {
      ...(memory.length ? { memory } : {}),
      ...(this.lastPixels ? { screenHash: screenHash(this.lastPixels) } : {}),
    };
  }

  private applyHeldPads(): [PadMask, PadMask] {
    const pads: [PadMask, PadMask] = [this.heldMask(1), this.heldMask(2)];
    if (this.core) {
      applyPad(this.core, 1, pads[0]);
      applyPad(this.core, 2, pads[1]);
    }
    return pads;
  }

  private heldMask(pad: Player1Or2): PadMask {
    const prefix = `${pad}:`;
    return maskOf(withoutOpposites([...this.held].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length) as Button)));
  }

  private evaluateDueCheckpoints(): void {
    const core = this.core;
    if (!this.playback || !core) return;
    const peek = (address: number) => core.peek(address);
    for (const checkpoint of this.playback.takeDueCheckpoints()) {
      this.playbackResults.push(
        evaluateCheckpoint(checkpoint, { peek, view: this.gameMap ? this.gameMap.read(peek) : null, screenHash: this.currentScreenHash() }),
      );
    }
  }

  private newCore(): EmulatorCore {
    const core = this.deps.createCore({
      onFrame: (pixels) => {
        this.lastPixels = pixels;
        this.deps.screen.setFrame(pixels);
      },
      onAudioSample: (left, right) => {
        if (this.speedMultiplier === 1 && this.paceRate === 1 && !this.stepping) this.deps.audio.writeSample(left, right);
      },
      onBatteryRamWrite: () => {
        this.batteryDirty = true;
      },
    });
    if (this.debugHooks) {
      if (!core.setDebugHooks) throw new Error(`The ${core.name} core has no debug hooks; close the tools first.`);
      core.setDebugHooks(this.debugHooks);
    }
    return core;
  }

  /** Replaces the core with a fresh one booted where a movie starts. */
  private restartCore(start: MovieStart): void {
    const core = this.newCore();
    bootMovie(core, this.requireRom().data, start);
    this.core = core;
    // A save state carries its picture; a Mark at frame 0 of a recording from it checks that picture.
    this.lastPixels = start.kind === "save-state" ? core.picture() : null;
    this.batteryDirty = false;
  }

  private requireRom(): RomRecord {
    if (!this.rom) throw new Error("No game is loaded.");
    return this.rom;
  }

  private measureFps(timeMs: number, steps: number): void {
    if (!this.fpsWindow) {
      this.fpsWindow = { startMs: timeMs, frames: 0 };
      return;
    }
    this.fpsWindow.frames += steps;
    const elapsed = timeMs - this.fpsWindow.startMs;
    if (elapsed >= 1000) {
      this.measuredFps = (this.fpsWindow.frames * 1000) / elapsed;
      this.fpsWindow = { startMs: timeMs, frames: 0 };
    }
  }

  private requireCore(): EmulatorCore {
    if (!this.core) throw new Error("No game is loaded.");
    return this.core;
  }

  private requireGame(): LoadedGame {
    if (!this.game) throw new Error("No game is loaded.");
    return this.game;
  }
}
