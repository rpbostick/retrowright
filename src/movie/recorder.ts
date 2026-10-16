import type { Checkpoint, CheckpointExpectation, InputRun, Movie, MovieEvent, MovieStart } from "./format";
import { MOVIE_FORMAT, MOVIE_VERSION } from "./format";
import type { PadMask } from "./pads";

export interface RecordingHeader {
  rom: Movie["rom"];
  core: Movie["core"];
  start: MovieStart;
}

/**
 * Collects a movie from the pads the player applies before each frame. The
 * frame count is the emulated frame, so a stall in the page (a slow tab, a
 * pause) changes nothing in the recording.
 */
export class MovieRecorder {
  private frames = 0;
  private pad1: PadMask = 0;
  private pad2: PadMask = 0;
  private readonly inputs: InputRun[] = [];
  private readonly events: MovieEvent[] = [];
  private readonly checkpoints: Checkpoint[] = [];

  constructor(private readonly header: RecordingHeader) {}

  get frameCount(): number {
    return this.frames;
  }

  /** Called with the pads applied just before each core.frame(). */
  recordFrame(pad1: PadMask, pad2: PadMask): void {
    if (pad1 !== this.pad1 || pad2 !== this.pad2) {
      this.inputs.push({ frame: this.frames, pad1, pad2 });
      this.pad1 = pad1;
      this.pad2 = pad2;
    }
    this.frames++;
  }

  /** A reset between frames, recorded at the frame that runs next. */
  recordReset(): void {
    this.events.push({ frame: this.frames, kind: "reset" });
  }

  mark(name: string, expect: CheckpointExpectation): Checkpoint {
    const checkpoint = { frame: this.frames, name, expect };
    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  finish(): Movie {
    return {
      format: MOVIE_FORMAT,
      version: MOVIE_VERSION,
      rom: { ...this.header.rom },
      core: { ...this.header.core },
      start: this.header.start,
      frames: this.frames,
      inputs: this.inputs.map((run) => ({ ...run })),
      events: this.events.map((event) => ({ ...event })),
      checkpoints: this.checkpoints.map((checkpoint) => structuredClone(checkpoint)),
    };
  }
}
