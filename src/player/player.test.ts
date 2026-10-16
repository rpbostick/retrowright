import { describe, expect, it, vi } from "vitest";
import { JsnesCore } from "../core/jsnesCore";
import { Button } from "../core/types";
import { MemoryGameStore, type GameStore } from "../storage/gameStore";
import { buildInes, PAINT_BACKDROP_PROGRAM, READ_BOTH_PADS_PROGRAM, READ_PAD_PROGRAM, WRITE_BATTERY_RAM_PROGRAM } from "../test/syntheticRom";
import { ButtonLatch } from "../input/buttonLatch";
import { GamepadPoller } from "../input/gamepad";
import { addCombo, DEFAULT_BINDINGS, padButtonsForCode } from "../input/keyBindings";
import { Player, type PlayerDeps } from "./player";
import { screenHash } from "../movie/screenHash";
import { parseMovie, serializeMovie } from "../movie/format";

/** requestAnimationFrame driven by hand at a fixed display rate. */
class FakeDisplay {
  private callback: ((time: number) => void) | null = null;
  time = 0;
  requestFrame = (callback: (time: number) => void) => {
    this.callback = callback;
    return 1;
  };
  cancelFrame = () => {
    this.callback = null;
  };
  run(seconds: number, hz = 60) {
    for (let tick = 0; tick < seconds * hz; tick++) {
      this.time += 1000 / hz;
      const callback = this.callback;
      this.callback = null;
      callback?.(this.time);
    }
  }
}

function makePlayer(store: GameStore, onMovieFinished?: PlayerDeps["onMovieFinished"]) {
  const display = new FakeDisplay();
  const onError = vi.fn();
  const player = new Player({
    createCore: (callbacks) => new JsnesCore(callbacks),
    store,
    audio: { writeSample() {}, flush() {}, pause: async () => {}, resume: async () => {} },
    screen: { setSize() {}, setFrame() {}, present() {} },
    requestFrame: display.requestFrame,
    cancelFrame: display.cancelFrame,
    onError,
    onMovieFinished,
  });
  return { player, display, onError };
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Player", () => {
  it("stores battery RAM the game writes and restores it when the game opens again", async () => {
    const store = new MemoryGameStore();
    const rom = await store.putRom("battery.nes", buildInes({ battery: true, program: WRITE_BATTERY_RAM_PROGRAM }));
    const first = makePlayer(store);
    await first.player.open(rom);
    first.display.run(1.5);
    await first.player.saveBatteryRam();
    const stored = await store.getBatteryRam(rom.id);
    expect(stored?.[0]).toBe(0x42);
    expect(stored?.[0x1fff]).toBe(0x17);

    // A cartridge that only reads its RAM shows the restore is what put it there.
    const reader = await store.putRom("reader.nes", buildInes({ battery: true }));
    await store.putBatteryRam(reader.id, stored!);
    const second = makePlayer(store);
    await second.player.open(reader);
    expect(second.player.restoredBatteryRam).toEqual(stored);
    second.display.run(0.5);
    expect(second.player.currentBatteryRam()).toEqual(stored);
  });

  it("keeps the tools' debug hooks on the cores a movie and another game bring in, until removed", async () => {
    const store = new MemoryGameStore();
    const rom = await store.putRom("battery.nes", buildInes({ battery: true, program: WRITE_BATTERY_RAM_PROGRAM }));
    const { player, display } = makePlayer(store);
    await player.open(rom);
    const writes: number[] = [];
    player.setDebugHooks({ onAccess: (kind, address) => void (kind === "write" && writes.push(address)), accessRanges: [[0x6000, 0x7fff]] });
    expect(player.debugHooksAvailable).toBe(true);
    // Recording from power-on boots a new core: the hooks see its writes.
    player.startRecording({ from: "power-on", keepBatteryRam: false });
    display.run(0.1);
    expect(writes).toEqual([0x6000, 0x7fff]);
    player.stopRecording();
    await player.open(rom);
    display.run(0.1);
    expect(writes).toEqual([0x6000, 0x7fff, 0x6000, 0x7fff]);
    expect(player.peek(0x6000)).toBe(0x42);
    player.setDebugHooks(null);
    await player.open(rom);
    display.run(0.1);
    expect(writes).toHaveLength(4);
  });

  it("does not store battery RAM for a cartridge without a battery", async () => {
    const store = new MemoryGameStore();
    const rom = await store.putRom("plain.nes", buildInes({ program: WRITE_BATTERY_RAM_PROGRAM }));
    const { player, display } = makePlayer(store);
    await player.open(rom);
    display.run(2);
    await player.saveBatteryRam();
    expect(await store.getBatteryRam(rom.id)).toBeUndefined();
  });

  it("saves a state to a slot and loads it into a new session", async () => {
    const store = new MemoryGameStore();
    const rom = await store.putRom("game.nes", buildInes({ battery: true, program: WRITE_BATTERY_RAM_PROGRAM }));
    const first = makePlayer(store);
    await first.player.open(rom);
    first.display.run(0.5);
    await first.player.saveState(2, "data:image/webp;base64,UklG");
    const saved = JSON.stringify(first.player.currentState());

    const second = makePlayer(store);
    await second.player.open(rom);
    second.display.run(0.2);
    expect(await second.player.loadState(1)).toBe(false);
    expect(await second.player.loadState(2)).toBe(true);
    expect(JSON.stringify(second.player.currentState()) === saved).toBe(true);
    expect((await second.player.listStates()).map(({ slot, thumbnail }) => ({ slot, thumbnail }))).toEqual([{ slot: 2, thumbnail: "data:image/webp;base64,UklG" }]);
  });

  it("fast-forwards at the speed set, drops sound meanwhile, and returns to normal speed", async () => {
    const store = new MemoryGameStore();
    const display = new FakeDisplay();
    let samples = 0;
    const player = new Player({
      createCore: (callbacks) => new JsnesCore(callbacks),
      store,
      audio: { writeSample: () => samples++, flush() {}, pause: async () => {}, resume: async () => {} },
      screen: { setSize() {}, setFrame() {}, present() {} },
      requestFrame: display.requestFrame,
      cancelFrame: display.cancelFrame,
      onError: vi.fn(),
    });
    await player.open(await store.putRom("game.nes", buildInes()));
    // The first second starts the pacer and runs a frame short; the second shows normal speed.
    display.run(1);
    const started = player.framesRun;
    display.run(1);
    const normal = player.framesRun - started;
    expect(normal).toBe(60);
    expect(samples).toBeGreaterThan(0);
    player.setSpeed(3);
    const before = { frames: player.framesRun, samples };
    display.run(1);
    expect(player.framesRun - before.frames).toBe(3 * normal);
    expect(samples).toBe(before.samples);
    player.setSpeed(1);
    const after = player.framesRun;
    display.run(1);
    expect(player.framesRun - after).toBe(normal);
    expect(() => player.setSpeed(0)).toThrow(RangeError);
  });

  it("paces the game at the core's frame rate and gives its picture at the core's size", async () => {
    const store = new MemoryGameStore();
    const sizes: string[] = [];
    const display = new FakeDisplay();
    const player = new Player({
      createCore: (callbacks) => new JsnesCore(callbacks),
      store,
      audio: { writeSample() {}, flush() {}, pause: async () => {}, resume: async () => {} },
      screen: { setSize: (width, height) => sizes.push(`${width}x${height}`), setFrame() {}, present() {} },
      requestFrame: display.requestFrame,
      cancelFrame: display.cancelFrame,
      onError: vi.fn(),
    });
    expect(player.picture()).toBeNull();
    await player.open(await store.putRom("game.nes", buildInes({ program: PAINT_BACKDROP_PROGRAM })));
    expect(sizes).toEqual(["256x240"]);
    display.run(2, 120);
    // 60.0988 frames a second on a 120 Hz display: 120 frames in two seconds, give or take the first tick.
    expect(Math.abs(player.framesRun - 120)).toBeLessThanOrEqual(1);
    const picture = player.picture()!;
    expect(picture.video).toEqual({ width: 256, height: 240, pixelAspect: { width: 8, height: 7 }, frameRate: 60.0988 });
    expect(picture.pixels).toHaveLength(256 * 240);
    expect(player.currentScreenHash()).toBe(screenHash(picture.pixels));
  });

  it("runs no frame when input polled at the start of a frame pauses the game", async () => {
    const store = new MemoryGameStore();
    const display = new FakeDisplay();
    let pauseOnPoll = false;
    const player: Player = new Player({
      createCore: (callbacks) => new JsnesCore(callbacks),
      store,
      audio: { writeSample() {}, flush() {}, pause: async () => {}, resume: async () => {} },
      screen: { setSize() {}, setFrame() {}, present() {} },
      requestFrame: display.requestFrame,
      cancelFrame: display.cancelFrame,
      onAnimationFrame: () => {
        if (pauseOnPoll) player.pause("user");
      },
      onError: vi.fn(),
    });
    await player.open(await store.putRom("game.nes", buildInes()));
    display.run(0.5);
    const before = player.framesRun;
    pauseOnPoll = true;
    display.run(0.5);
    expect(player.framesRun).toBe(before);
    expect(player.running).toBe(false);
  });

  it("closes the game: battery RAM is stored, the screen goes black and nothing runs", async () => {
    const store = new MemoryGameStore();
    const display = new FakeDisplay();
    const frames: Uint32Array[] = [];
    const player = new Player({
      createCore: (callbacks) => new JsnesCore(callbacks),
      store,
      audio: { writeSample() {}, flush() {}, pause: async () => {}, resume: async () => {} },
      screen: { setSize() {}, setFrame: (pixels) => frames.push(pixels), present() {} },
      requestFrame: display.requestFrame,
      cancelFrame: display.cancelFrame,
      onError: vi.fn(),
    });
    const rom = await store.putRom("battery.nes", buildInes({ battery: true, program: WRITE_BATTERY_RAM_PROGRAM }));
    await player.open(rom);
    display.run(0.5);
    const ram = player.currentBatteryRam();
    expect(ram?.[0]).toBe(0x42);
    expect(await player.storedBatteryRam()).toEqual(null);
    const framesAtClose = player.framesRun;
    await player.close();
    expect(await store.getBatteryRam(rom.id)).toEqual(ram);
    expect(player.loadedGame).toBeNull();
    expect(player.running).toBe(false);
    expect(frames.at(-1)?.every((pixel) => pixel === 0)).toBe(true);
    display.run(0.5);
    expect(player.framesRun).toBe(framesAtClose);
  });

  it("runs 60 frames a second, and none while the tab is hidden", async () => {
    const store = new MemoryGameStore();
    const rom = await store.putRom("game.nes", buildInes());
    const { player, display } = makePlayer(store);
    await player.open(rom);
    display.run(2, 144);
    expect(Math.abs(player.framesRun - 120)).toBeLessThanOrEqual(1);
    expect(player.measuredFps).toBeCloseTo(60.1, 0);

    player.pause("hidden");
    const before = player.framesRun;
    display.run(5);
    expect(player.framesRun).toBe(before);

    player.resume("hidden");
    display.run(1, 120);
    // No burst of catch-up frames for the hidden time.
    expect(Math.abs(player.framesRun - before - 60)).toBeLessThanOrEqual(1);
  });

  it("stays paused until every reason to pause is gone", async () => {
    const store = new MemoryGameStore();
    const { player } = makePlayer(store);
    await player.open(await store.putRom("game.nes", buildInes()));
    player.pause("user");
    player.pause("hidden");
    player.resume("hidden");
    expect(player.running).toBe(false);
    player.resume("user");
    expect(player.running).toBe(true);
  });

  it("tracks held buttons and carries them into the next game", async () => {
    const store = new MemoryGameStore();
    const { player, display } = makePlayer(store);
    player.setButton(1, Button.A, true); // no game yet: dropped
    expect(player.heldButtons()).toEqual([]);
    await player.open(await store.putRom("one.nes", buildInes()));
    player.setButton(1, Button.Start, true);
    player.setButton(2, Button.Left, true);
    expect(player.heldButtons()).toEqual(["1:Start", "2:Left"]);

    await player.open(await store.putRom("two.nes", buildInes({ battery: true, program: READ_BOTH_PADS_PROGRAM })));
    display.run(0.05);
    // READ_BOTH_PADS_PROGRAM's bits: Start 0x10 on pad 1, Left 0x02 on pad 2.
    expect([player.peek(0x20), player.peek(0x21)]).toEqual([0x10, 0x02]);
    player.setButton(1, Button.Start, false);
    expect(player.heldButtons()).toEqual(["2:Left"]);
  });

  describe("opposite directions", () => {
    /** READ_BOTH_PADS_PROGRAM's bits. */
    const UP = 0x08;
    const DOWN = 0x04;
    const LEFT = 0x02;
    const RIGHT = 0x01;
    const B = 0x40;

    async function padReader() {
      const store = new MemoryGameStore();
      const { player, display } = makePlayer(store);
      await player.open(await store.putRom("pads.nes", buildInes({ program: READ_BOTH_PADS_PROGRAM })));
      const read = () => {
        display.run(0.05);
        return [player.peek(0x20), player.peek(0x21)];
      };
      return { player, display, read };
    }

    it("gives the game the direction pressed last, and the other back when it is let go", async () => {
      const { player, read } = await padReader();
      player.setButton(1, Button.Left, true);
      expect(read()).toEqual([LEFT, 0]);
      player.setButton(1, Button.Right, true);
      expect(read()).toEqual([RIGHT, 0]);
      player.setButton(1, Button.Right, false);
      expect(read()).toEqual([LEFT, 0]);
      player.setButton(1, Button.Right, true);
      player.setButton(1, Button.Left, false);
      expect(read()).toEqual([RIGHT, 0]);
      player.setButton(1, Button.Right, false);

      player.setButton(1, Button.Down, true);
      player.setButton(1, Button.Up, true);
      expect(read()).toEqual([UP, 0]);
      player.setButton(1, Button.Up, false);
      expect(read()).toEqual([DOWN, 0]);
      player.setButton(1, Button.Down, false);
      expect(read()).toEqual([0, 0]);
    });

    it("keeps the pairs apart on player 2's pad and keeps a held direction of the other pair", async () => {
      const { player, read } = await padReader();
      player.setButton(2, Button.Up, true);
      player.setButton(2, Button.Right, true);
      player.setButton(2, Button.Left, true);
      player.setButton(2, Button.Down, true);
      expect(read()).toEqual([0, DOWN | LEFT]);
      player.setButton(2, Button.Left, false);
      expect(read()).toEqual([0, DOWN | RIGHT]);
    });

    it("lets a combo key's Down win over Up held by another key, and Up win when pressed after it", async () => {
      const { player, read } = await padReader();
      const bindings = addCombo(DEFAULT_BINDINGS, "KeyC", [Button.Down, Button.B]);
      const latch = new ButtonLatch(
        (pad, button) => player.setButton(pad, button, true),
        (pad, button) => player.setButton(pad, button, false),
      );
      const key = (code: string, pressed: boolean) => {
        for (const { player: pad, button } of padButtonsForCode(bindings, code)) latch.set(`keyboard:${code}`, pad, button, pressed);
      };
      key("ArrowUp", true);
      key("KeyC", true);
      expect(read()).toEqual([DOWN | B, 0]);
      key("KeyC", false);
      expect(read()).toEqual([UP, 0]);
      key("KeyC", true);
      key("ArrowUp", false);
      key("ArrowUp", true);
      expect(read()).toEqual([UP | B, 0]);
      key("ArrowUp", false);
      expect(read()).toEqual([DOWN | B, 0]);
    });

    it("lets a gamepad's stick win over its d-pad held before, and the d-pad come back when the stick is let go", async () => {
      const { player, read } = await padReader();
      const pad = { connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0] };
      const latch = new ButtonLatch(
        (player1Or2, button) => player.setButton(player1Or2, button, true),
        (player1Or2, button) => player.setButton(player1Or2, button, false),
      );
      const poller = new GamepadPoller(() => [pad as unknown as Gamepad], (player1Or2, button, pressed) => latch.set("gamepad", player1Or2, button, pressed));
      pad.buttons[14].pressed = true; // d-pad Left
      poller.poll();
      expect(read()).toEqual([LEFT, 0]);
      pad.axes = [1, 0]; // stick right
      poller.poll();
      expect(read()).toEqual([RIGHT, 0]);
      pad.axes = [0, 0];
      poller.poll();
      expect(read()).toEqual([LEFT, 0]);
      pad.buttons[14].pressed = false;
      pad.buttons[12].pressed = true; // d-pad Up
      pad.axes = [0, 1]; // stick down, read in the same poll after the d-pad
      poller.poll();
      expect(read()).toEqual([DOWN, 0]);
    });

    it("records what the game saw, and replays a movie's stored Left+Right as it is", async () => {
      const { player, display } = await padReader();
      player.startRecording({ from: "current-state" });
      player.setButton(1, Button.Left, true);
      player.setButton(1, Button.Right, true);
      display.run(0.5);
      player.setButton(1, Button.Right, false);
      player.setButton(1, Button.Left, false);
      display.run(0.05);
      const movie = player.stopRecording();
      expect(movie.inputs.map((run) => run.pad1)).toEqual([0x80, 0]);

      movie.inputs[0].pad1 = 0xc0;
      player.playMovie(movie);
      display.run(0.2);
      expect(player.movieStatus().mode).toBe("playing");
      expect([player.peek(0x20), player.peek(0x21)]).toEqual([LEFT | RIGHT, 0]);
    });
  });

  it("records the pads per frame, and replays them with the player's pads locked out", async () => {
    const store = new MemoryGameStore();
    const { player, display } = makePlayer(store);
    await player.open(await store.putRom("pad.nes", buildInes({ program: READ_PAD_PROGRAM })));
    display.run(0.2);
    player.startRecording({ from: "power-on", keepBatteryRam: false });
    display.run(0.2);
    player.setButton(1, Button.A, true);
    display.run(0.2);
    player.mark("A held");
    player.setButton(1, Button.A, false);
    display.run(0.1);
    player.reset();
    display.run(0.1);
    const movie = player.stopRecording();
    expect(movie.start).toEqual({ kind: "power-on", batteryRam: null });
    expect(movie.inputs.map((run) => run.pad1)).toEqual([0x01, 0]);
    expect(movie.events).toHaveLength(1);
    expect(movie.checkpoints[0].expect.screenHash).toMatch(/^fnv1a32:/);
    movie.checkpoints[0].expect.memory = ["$0010 == 1"];

    player.playMovie(movie);
    player.setButton(1, Button.Start, true); // locked out while the movie plays
    display.run(1);
    const status = player.movieStatus();
    expect(status.finished).toBe(true);
    expect(status.results).toEqual([expect.objectContaining({ name: "A held", passed: true })]);
    expect(player.currentState() && (player.currentState()!.data as { controllers: Record<number, { state: number[] }> }).controllers[1].state[3]).toBe(0x41);
  });

  it("records a Mark at frame 0 of a recording from the current state, and replays it as passed", async () => {
    const store = new MemoryGameStore();
    const { player, display } = makePlayer(store);
    await player.open(await store.putRom("paint.nes", buildInes({ program: PAINT_BACKDROP_PROGRAM })));
    display.run(0.5);
    player.startRecording({ from: "current-state" });
    const mark = player.mark("start");
    expect(mark.frame).toBe(0);
    expect(mark.expect.screenHash).toBe(player.currentScreenHash());
    display.run(0.2);
    const movie = player.stopRecording();
    expect(movie.start.kind).toBe("save-state");
    expect(movie.checkpoints).toEqual([mark]);

    player.playMovie(movie);
    display.run(0.5);
    const status = player.movieStatus();
    expect(status.finished).toBe(true);
    expect(status.results).toEqual([expect.objectContaining({ name: "start", frame: 0, passed: true })]);
  });

  // The menu pauses the game, and its Record, Mark and Stop buttons work while
  // it is open: recording from power-on, marking and stopping there ran no frame.
  it("saves no movie when no frame ran while recording, and drops its marks", async () => {
    const store = new MemoryGameStore();
    const { player, display } = makePlayer(store);
    await player.open(await store.putRom("pad.nes", buildInes({ program: READ_PAD_PROGRAM })));
    display.run(0.5);
    player.pause("user");
    player.startRecording({ from: "power-on", keepBatteryRam: false });
    player.mark("mark 1");
    player.mark("mark 2");
    player.mark("mark 3");
    display.run(0.5);
    expect(() => player.stopRecording()).toThrow("Nothing was recorded");
    expect(player.lastRecording).toBeNull();
    expect(player.movieStatus().mode).toBe("idle");

    // F9, F9 with the game running back to back: stopped before the next frame.
    player.resume("user");
    player.startRecording({ from: "current-state" });
    expect(() => player.stopRecording()).toThrow("Nothing was recorded");

    // The next recording starts clean: no marks carried over from the dropped one.
    player.startRecording({ from: "current-state" });
    display.run(0.1);
    player.mark("mark 1");
    const movie = player.stopRecording();
    expect(movie.frames).toBeGreaterThan(0);
    expect(movie.checkpoints.map((checkpoint) => checkpoint.name)).toEqual(["mark 1"]);
    expect(player.lastRecording).toBe(movie);
  });

  it("adds marks only while recording", async () => {
    const store = new MemoryGameStore();
    const { player, display } = makePlayer(store);
    await player.open(await store.putRom("pad.nes", buildInes({ program: READ_PAD_PROGRAM })));
    display.run(0.1);
    expect(() => player.mark("before")).toThrow("Marks are added while recording");
    player.startRecording({ from: "current-state" });
    display.run(0.1);
    player.stopRecording();
    expect(() => player.mark("after")).toThrow("Marks are added while recording");
  });

  it("saves the last frames played as a movie that replays to the same picture and RAM", async () => {
    const store = new MemoryGameStore();
    const readRam = () => Array.from({ length: 0x20 }, (_, address) => player.peek(address));
    // Read as the last frame ends: the game goes on running after it.
    let ramAtEnd: number[] = [];
    const { player, display } = makePlayer(store, () => (ramAtEnd = readRam()));
    const rom = await store.putRom("pad.nes", buildInes({ program: READ_PAD_PROGRAM }));
    await player.open(rom);
    player.setReplaySeconds(30);
    // Past the window and a state interval, with A held now and then.
    for (let second = 0; second < 32; second++) {
      player.setButton(1, Button.A, second % 3 === 0);
      display.run(1);
    }
    player.reset();
    display.run(0.5);
    player.setButton(1, Button.A, false);
    display.run(0.5);
    const ram = readRam();
    const movie = player.saveReplay();
    expect(movie.rom).toEqual({ name: "pad.nes", sha256: rom.id });
    expect(movie.start.kind).toBe("save-state");
    expect(movie.frames).toBeGreaterThanOrEqual(30 * 60);
    expect(movie.frames).toBeLessThan(35 * 60 + 2);
    expect(movie.events).toHaveLength(1);
    expect(movie.checkpoints).toEqual([{ frame: movie.frames, name: "end", expect: { screenHash: player.currentScreenHash() } }]);

    // Through the file's own text, as a downloaded movie comes back.
    player.playMovie(parseMovie(JSON.parse(serializeMovie(movie))));
    expect(player.replayStats()).toBeNull();
    display.run(36);
    const status = player.movieStatus();
    expect(status.finished).toBe(true);
    expect(status.results).toEqual([expect.objectContaining({ name: "end", passed: true })]);
    expect(ramAtEnd).toEqual(ram);
    // Some 4000 emulated frames each way.
  }, 30_000);

  it("keeps no replay while off, recording or playing, and starts it over after a state is loaded", async () => {
    const store = new MemoryGameStore();
    const { player, display } = makePlayer(store);
    await player.open(await store.putRom("pad.nes", buildInes({ program: READ_PAD_PROGRAM })));
    expect(() => player.saveReplay()).toThrow("nothing to save");
    display.run(1);
    expect(player.replayStats()?.frames).toBeGreaterThan(50);
    await player.saveState(1, null);
    display.run(1);
    await player.loadState(1);
    expect(player.replayStats()?.frames).toBe(0);
    player.startRecording({ from: "current-state" });
    expect(player.replayStats()).toBeNull();
    display.run(0.5);
    expect(() => player.saveReplay()).toThrow("not kept while a movie records");
    player.stopRecording();
    display.run(0.5);
    expect(player.replayStats()?.frames).toBeGreaterThan(20);
    player.setReplaySeconds(0);
    display.run(0.5);
    expect(player.replayStats()).toBeNull();
    expect(() => player.saveReplay()).toThrow("instant replay is off");
    expect(() => player.setReplaySeconds(45 as 30)).toThrow(RangeError);
  });

  it("reports a replay's end through onMovieFinished, even for a 1-frame movie", async () => {
    const store = new MemoryGameStore();
    const onMovieFinished = vi.fn();
    const display = new FakeDisplay();
    const player = new Player({
      createCore: (callbacks) => new JsnesCore(callbacks),
      store,
      audio: { writeSample() {}, flush() {}, pause: async () => {}, resume: async () => {} },
      screen: { setSize() {}, setFrame() {}, present() {} },
      requestFrame: display.requestFrame,
      cancelFrame: display.cancelFrame,
      onError: vi.fn(),
      onMovieFinished,
    });
    await player.open(await store.putRom("pad.nes", buildInes({ program: READ_PAD_PROGRAM })));
    player.startRecording({ from: "power-on", keepBatteryRam: false });
    display.run(0.1);
    const movie = { ...player.stopRecording(), frames: 1, inputs: [] };
    player.playMovie(movie);
    expect(onMovieFinished).not.toHaveBeenCalled();
    display.run(0.2);
    expect(onMovieFinished).toHaveBeenCalledTimes(1);
    expect(onMovieFinished).toHaveBeenCalledWith(expect.objectContaining({ mode: "idle", finished: true, results: [] }));
  });

  it("refuses to load a state or reset into a movie, and stores no battery RAM from one", async () => {
    const store = new MemoryGameStore();
    const { player, display } = makePlayer(store);
    const rom = await store.putRom("battery.nes", buildInes({ battery: true, program: WRITE_BATTERY_RAM_PROGRAM }));
    await player.open(rom);
    player.startRecording({ from: "power-on", keepBatteryRam: false });
    display.run(0.5);
    await player.saveBatteryRam();
    expect(await store.getBatteryRam(rom.id)).toBeUndefined();
    await expect(player.loadState(1)).rejects.toThrow("stop it to load a state");
    player.playMovie(player.stopRecording());
    expect(() => player.reset()).toThrow("A movie is playing");
  });

  it("saves a resume state and continues from it on the same frame", async () => {
    const store = new MemoryGameStore();
    const rom = await store.putRom("paint.nes", buildInes({ program: PAINT_BACKDROP_PROGRAM }));
    const first = makePlayer(store);
    await first.player.open(rom);
    first.display.run(0.5);
    first.player.pause("hidden");
    const left = first.player.currentScreenHash();
    const framesLeft = first.player.framesRun;
    await first.player.saveResume("data:image/webp;base64,LAST");
    const resume = await store.getResume(rom.id);
    expect(resume?.thumbnail).toBe("data:image/webp;base64,LAST");
    expect((await store.listGames())[0].resumeAt).toBe(resume?.savedAt);

    const second = makePlayer(store);
    await second.player.open(rom, resume!.state);
    expect(second.player.framesRun).toBe(0);
    expect(second.player.continuedScreenHash).toBe(left);
    expect(second.player.currentScreenHash()).toBe(left);
    expect(second.player.currentState()).toEqual(resume!.state);
    expect(framesLeft).toBeGreaterThan(20);

    // Opened from power-on, there is no restored picture.
    await second.player.open(rom);
    expect(second.player.continuedScreenHash).toBeNull();
    expect(second.player.currentScreenHash()).toBeNull();
  });

  it("saves no resume state while a movie records, since the machine then runs from the movie's start", async () => {
    const store = new MemoryGameStore();
    const { player, display } = makePlayer(store);
    const rom = await store.putRom("game.nes", buildInes());
    await player.open(rom);
    player.startRecording({ from: "power-on", keepBatteryRam: false });
    display.run(0.2);
    await player.saveResume(null);
    expect(await store.getResume(rom.id)).toBeUndefined();
  });

  it("keeps the current game running when a new ROM fails to load", async () => {
    const store = new MemoryGameStore();
    const { player, display } = makePlayer(store);
    await player.open(await store.putRom("good.nes", buildInes()));
    const bad = await store.putRom("bad.nes", buildInes({ mapper: 69 }));
    await expect(player.open(bad)).rejects.toThrow("mapper 69");
    expect(player.loadedGame?.name).toBe("good.nes");
    display.run(1);
    expect(player.framesRun).toBeGreaterThan(50);
    await flushPromises();
  });
});
