import type { EmulatorCore } from "../core/types";
import { checkAssertion, type ViewValue } from "./expectations";
import { decodeBase64, type Checkpoint, type Movie, type MovieStart } from "./format";
import { applyPad, type PadMask } from "./pads";

/** Loads the ROM and puts the machine where the movie starts. */
export function bootMovie(core: EmulatorCore, rom: Uint8Array, start: MovieStart): void {
  core.load(rom);
  if (start.kind === "save-state") {
    core.loadState(start.state);
    return;
  }
  const battery = core.batteryRam();
  if (start.batteryRam !== null) {
    if (battery === null) throw new Error("The movie starts with battery RAM, but this cartridge has none.");
    core.restoreBatteryRam(decodeBase64(start.batteryRam));
  } else if (battery !== null) {
    core.restoreBatteryRam(new Uint8Array(battery.length));
  }
}

/** Throws, naming both, when the ROM is not the one the movie was made on. */
export function requireMovieRom(movie: Movie, romSha256: string): void {
  if (movie.rom.sha256 !== romSha256) {
    throw new Error(`This movie was recorded on ${movie.rom.name} (SHA-256 ${movie.rom.sha256.slice(0, 12)}…), not this ROM (${romSha256.slice(0, 12)}…).`);
  }
}

/**
 * Plays a movie's inputs and resets into a core one frame at a time. The
 * caller boots the core first and decides what to do between frames
 * (checkpoints, screenshots, drawing), so the page and the Node harness
 * share the frame-by-frame semantics.
 */
export class MovieRunner {
  /** Frames run so far; the next step runs this frame number. */
  frame = 0;
  pad1: PadMask = 0;
  pad2: PadMask = 0;
  private nextInput = 0;
  private nextEvent = 0;
  private nextCheckpoint = 0;

  constructor(
    private readonly core: EmulatorCore,
    readonly movie: Movie,
  ) {}

  get done(): boolean {
    return this.frame >= this.movie.frames;
  }

  step(): void {
    if (this.done) throw new Error(`The movie has ${this.movie.frames} frames and all have run.`);
    const { inputs, events } = this.movie;
    while (this.nextEvent < events.length && events[this.nextEvent].frame === this.frame) {
      this.core.reset();
      this.nextEvent++;
    }
    while (this.nextInput < inputs.length && inputs[this.nextInput].frame === this.frame) {
      this.pad1 = inputs[this.nextInput].pad1;
      this.pad2 = inputs[this.nextInput].pad2;
      this.nextInput++;
    }
    applyPad(this.core, 1, this.pad1);
    applyPad(this.core, 2, this.pad2);
    this.core.frame();
    this.frame++;
  }

  /** Checkpoints at the current frame not yet handed out; call after each step (and once before the first). */
  takeDueCheckpoints(): Checkpoint[] {
    const due: Checkpoint[] = [];
    const { checkpoints } = this.movie;
    while (this.nextCheckpoint < checkpoints.length && checkpoints[this.nextCheckpoint].frame <= this.frame) {
      due.push(checkpoints[this.nextCheckpoint]);
      this.nextCheckpoint++;
    }
    return due;
  }
}

export interface CheckpointContext {
  peek(address: number): number;
  view: ViewValue | null;
  /** screenHash() of the last picture, or null before the first frame. */
  screenHash: string | null;
}

export interface CheckpointResult {
  name: string;
  frame: number;
  passed: boolean;
  /** One line per failed expectation, in the movie's order; the first is the first difference. */
  failures: string[];
  checked: number;
}

export function evaluateCheckpoint(checkpoint: Checkpoint, context: CheckpointContext): CheckpointResult {
  const failures: string[] = [];
  let checked = 0;
  const expected = checkpoint.expect;
  if (expected.screenHash !== undefined) {
    checked++;
    if (context.screenHash !== expected.screenHash) failures.push(`screen hash is ${context.screenHash ?? "(no frame yet)"}, expected ${expected.screenHash}`);
  }
  for (const line of expected.memory ?? []) {
    checked++;
    const result = checkAssertion(line, context);
    if (result.error) failures.push(`${line}: ${result.error}`);
    else if (!result.passed) failures.push(`${line}: actual ${JSON.stringify(result.actual)}`);
  }
  return { name: checkpoint.name, frame: checkpoint.frame, passed: failures.length === 0, failures, checked };
}
