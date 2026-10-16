import type { Button } from "../src/core/types";
import type { CheckpointExpectation, Movie } from "../src/movie/format";
import { maskOf } from "../src/movie/pads";
import { MovieRecorder, type RecordingHeader } from "../src/movie/recorder";

/**
 * Writes a movie from a script of presses and waits, for movies made by code
 * rather than by playing: it feeds the same recorder the page uses, frame by
 * frame, so a scripted movie has the same shape as a recorded one.
 */
export class MovieScript {
  private readonly recorder: MovieRecorder;

  constructor(header: RecordingHeader) {
    this.recorder = new MovieRecorder(header);
  }

  get frame(): number {
    return this.recorder.frameCount;
  }

  /** Holds the buttons on pad 1 for `holdFrames`, then releases them for `releaseFrames`. */
  press(buttons: Button | Button[], holdFrames = 4, releaseFrames = 12): this {
    const mask = maskOf(Array.isArray(buttons) ? buttons : [buttons]);
    for (let frame = 0; frame < holdFrames; frame++) this.recorder.recordFrame(mask, 0);
    return this.wait(releaseFrames);
  }

  /** Runs frames with nothing pressed. */
  wait(frames: number): this {
    for (let frame = 0; frame < frames; frame++) this.recorder.recordFrame(0, 0);
    return this;
  }

  reset(): this {
    this.recorder.recordReset();
    return this;
  }

  checkpoint(name: string, expect: CheckpointExpectation): this {
    this.recorder.mark(name, expect);
    return this;
  }

  build(): Movie {
    return this.recorder.finish();
  }
}
