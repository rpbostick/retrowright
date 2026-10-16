import type { SaveState } from "../core/types";
import { MOVIE_FORMAT, MOVIE_VERSION, type CheckpointExpectation, type InputRun, type Movie } from "./format";
import type { PadMask } from "./pads";

// Instant replay: while a game runs with no movie recording or playing, the
// player keeps save states at intervals and the pads of every frame since the
// oldest, as RetroArch's rewind buffer and BizHawk's TAStudio greenzone do. A
// replay movie starts from the oldest state still needed and replays every
// frame to now.

/** The replay lengths offered, in seconds; 0 turns the buffer off. */
export const REPLAY_SECONDS = [0, 30, 60, 120] as const;
export type ReplaySeconds = (typeof REPLAY_SECONDS)[number];
export const DEFAULT_REPLAY_SECONDS: ReplaySeconds = 60;
/**
 * Seconds between kept states. A state of jsnes is about 1.4 MB as JSON for
 * a mapper 0 game and 1.8 MB for Final Fantasy, and takes some 40 ms to make
 * and serialise, so the interval trades a replay up to this much longer than
 * asked, and that many more states held, against one slow frame per interval.
 */
export const REPLAY_STATE_INTERVAL_SECONDS = 5;

export interface ReplayBufferOptions {
  /** Frames the replay covers at least, once that many have run. */
  windowFrames: number;
  /** Frames between kept states. */
  stateIntervalFrames: number;
}

/** What the buffer holds now, for the memory it costs. */
export interface ReplayBufferStats {
  /** States held. */
  states: number;
  /** Frames a replay saved now would run. */
  frames: number;
  /** The states' JSON text plus the pad ring, in bytes (one byte per character of JSON, as engines store ASCII strings). */
  bytes: number;
}

interface KeptState {
  /** Frames run since the buffer started when the state was taken. */
  frame: number;
  /**
   * The state as JSON. Deliberate: text rather than the state object, which
   * holds its memory as plain arrays of numbers at eight bytes an element;
   * the text is smaller, measurable, and never shares an array with the core.
   */
  json: string;
}

export class ReplayBuffer {
  /** Frames run since the buffer started; the next frame is this one. */
  private frame = 0;
  /** Oldest first; the first is the newest state at least windowFrames old, once there is one. */
  private readonly states: KeptState[] = [];
  /** Pad 1 and pad 2 of each frame, two bytes a frame, at (frame % capacity) * 2. */
  private readonly pads: Uint8Array;
  private readonly capacity: number;
  /** Frames a reset ran before, oldest first, all after the oldest state's frame. */
  private resets: number[] = [];

  constructor(private readonly options: ReplayBufferOptions) {
    if (!Number.isInteger(options.windowFrames) || options.windowFrames < 1) throw new RangeError(`windowFrames must be a whole number from 1, got ${options.windowFrames}.`);
    if (!Number.isInteger(options.stateIntervalFrames) || options.stateIntervalFrames < 1) {
      throw new RangeError(`stateIntervalFrames must be a whole number from 1, got ${options.stateIntervalFrames}.`);
    }
    // The oldest state needed is less than windowFrames + stateIntervalFrames frames back.
    this.capacity = options.windowFrames + options.stateIntervalFrames;
    this.pads = new Uint8Array(this.capacity * 2);
  }

  /**
   * Called with the pads applied just before each core.frame(); `takeState`
   * is the machine before that frame, and is called only when a state is due.
   */
  recordFrame(pad1: PadMask, pad2: PadMask, takeState: () => SaveState): void {
    if (this.frame % this.options.stateIntervalFrames === 0) this.states.push({ frame: this.frame, json: JSON.stringify(takeState()) });
    const slot = (this.frame % this.capacity) * 2;
    this.pads[slot] = pad1;
    this.pads[slot + 1] = pad2;
    this.frame++;
    this.dropOld();
  }

  /** A reset between frames, replayed before the frame that runs next. */
  recordReset(): void {
    this.resets.push(this.frame);
  }

  stats(): ReplayBufferStats {
    const oldest = this.states[0];
    return {
      states: this.states.length,
      frames: oldest ? this.frame - oldest.frame : 0,
      bytes: this.states.reduce((sum, state) => sum + state.json.length, 0) + this.pads.byteLength,
    };
  }

  /**
   * A movie from the oldest state held to now, ending in a checkpoint of
   * `end` (the picture's hash and the game's state after the last frame).
   * Throws when no frame has run since the buffer started.
   */
  toMovie(header: { rom: Movie["rom"]; core: Movie["core"] }, end: CheckpointExpectation): Movie {
    const oldest = this.states[0];
    const frames = oldest ? this.frame - oldest.frame : 0;
    if (!oldest || frames === 0) throw new Error("There is nothing to save yet: no frame has run since the replay buffer started.");
    const inputs: InputRun[] = [];
    let pad1 = 0;
    let pad2 = 0;
    for (let frame = oldest.frame; frame < this.frame; frame++) {
      const slot = (frame % this.capacity) * 2;
      if (this.pads[slot] !== pad1 || this.pads[slot + 1] !== pad2) {
        pad1 = this.pads[slot];
        pad2 = this.pads[slot + 1];
        inputs.push({ frame: frame - oldest.frame, pad1, pad2 });
      }
    }
    return {
      format: MOVIE_FORMAT,
      version: MOVIE_VERSION,
      rom: { ...header.rom },
      core: { ...header.core },
      start: { kind: "save-state", state: JSON.parse(oldest.json) as SaveState },
      frames,
      inputs,
      events: this.resets.map((frame) => ({ frame: frame - oldest.frame, kind: "reset" as const })),
      checkpoints: [{ frame: frames, name: "end", expect: end }],
    };
  }

  /**
   * Keeps the newest state at least windowFrames old and everything after it.
   * A reset at a state's own frame ran before the state was taken, so the
   * state holds it already and it is dropped with the older ones.
   */
  private dropOld(): void {
    const oldestNeeded = this.frame - this.options.windowFrames;
    while (this.states.length > 1 && this.states[1].frame <= oldestNeeded) this.states.shift();
    const start = this.states[0].frame;
    if (this.resets.length > 0 && this.resets[0] <= start) this.resets = this.resets.filter((frame) => frame > start);
  }
}
