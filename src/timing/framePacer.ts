/**
 * Fixed-step accumulator: requestAnimationFrame fires at the display's rate
 * (60, 120, 144 Hz...), and each callback runs however many whole emulator
 * frames have come due, so the game runs at the NES rate on any screen.
 */
export class FramePacer {
  private readonly stepMs: number;
  private readonly maxStepsPerTick: number;
  private lastTime: number | null = null;
  private accumulatedMs = 0;

  /**
   * @param framesPerSecond emulated frames per second.
   * @param maxStepsPerTick cap on catch-up after a stall (a slow frame, a
   *   breakpoint); beyond it the backlog is dropped instead of fast-forwarding.
   */
  constructor(framesPerSecond: number, maxStepsPerTick = 4) {
    if (!(framesPerSecond > 0)) throw new Error(`Frame rate must be positive, got ${framesPerSecond}.`);
    this.stepMs = 1000 / framesPerSecond;
    this.maxStepsPerTick = maxStepsPerTick;
  }

  /** Returns how many emulator frames to run for a callback at `nowMs`. */
  tick(nowMs: number): number {
    if (this.lastTime === null) {
      this.lastTime = nowMs;
      return 0;
    }
    this.accumulatedMs += Math.max(0, nowMs - this.lastTime);
    this.lastTime = nowMs;
    let steps = Math.floor(this.accumulatedMs / this.stepMs);
    this.accumulatedMs -= steps * this.stepMs;
    if (steps > this.maxStepsPerTick) {
      steps = this.maxStepsPerTick;
      this.accumulatedMs = 0;
    }
    return steps;
  }

  /** Forgets elapsed time, e.g. after a pause, so the game does not jump ahead. */
  reset(): void {
    this.lastTime = null;
    this.accumulatedMs = 0;
  }
}
