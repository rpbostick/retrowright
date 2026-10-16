import { describe, expect, it } from "vitest";
import { FramePacer } from "./framePacer";

/** Calls tick() as requestAnimationFrame would at `hz` for `seconds`. */
function framesRun(pacer: FramePacer, hz: number, seconds: number, jitterMs = 0): number {
  let frames = 0;
  const ticks = Math.round(hz * seconds);
  for (let index = 0; index <= ticks; index++) {
    // Alternating jitter keeps the mean interval exact.
    const jitter = index === 0 || index === ticks ? 0 : (index % 2 === 0 ? 1 : -1) * jitterMs;
    frames += pacer.tick(1000 + (index * 1000) / hz + jitter);
  }
  return frames;
}

describe("FramePacer", () => {
  for (const hz of [60, 120, 144]) {
    it(`runs 60 frames a second on a ${hz} Hz display`, () => {
      const frames = framesRun(new FramePacer(60), hz, 10);
      expect(frames).toBeGreaterThanOrEqual(599);
      expect(frames).toBeLessThanOrEqual(600);
    });

    it(`holds the NES rate of 60.0988 on a ${hz} Hz display with jitter`, () => {
      const frames = framesRun(new FramePacer(60.0988), hz, 10, 2);
      expect(Math.abs(frames - 601)).toBeLessThanOrEqual(1);
    });
  }

  it("runs at most one frame per callback on a 144 Hz display", () => {
    const pacer = new FramePacer(60);
    const perTick: number[] = [];
    for (let index = 0; index <= 144; index++) perTick.push(pacer.tick((index * 1000) / 144));
    expect(Math.max(...perTick)).toBe(1);
  });

  it("drops the backlog after a stall instead of fast-forwarding", () => {
    const pacer = new FramePacer(60, 4);
    pacer.tick(0);
    expect(pacer.tick(2000)).toBe(4);
    expect(pacer.tick(2000 + 1000 / 60)).toBe(1);
  });

  it("starts afresh after reset", () => {
    const pacer = new FramePacer(60);
    pacer.tick(0);
    pacer.reset();
    expect(pacer.tick(5000)).toBe(0);
    expect(pacer.tick(5000 + 1000 / 60)).toBe(1);
  });

  it("refuses a non-positive frame rate", () => {
    expect(() => new FramePacer(0)).toThrow("positive");
  });
});
