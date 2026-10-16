import { describe, expect, it } from "vitest";
import { SampleRing } from "./sampleRing";

const ramp = (from: number, length: number) => Float32Array.from({ length }, (_, index) => from + index);

function pull(ring: SampleRing, size: number) {
  const left = new Float32Array(size);
  const right = new Float32Array(size);
  ring.pull(left, right);
  return { left: [...left], right: [...right] };
}

describe("SampleRing", () => {
  it("stays silent until primed, then plays in order", () => {
    const ring = new SampleRing(16, 4);
    ring.push(ramp(1, 3), ramp(101, 3));
    expect(pull(ring, 2).left).toEqual([0, 0]);
    ring.push(ramp(4, 2), ramp(104, 2));
    expect(pull(ring, 3)).toEqual({ left: [1, 2, 3], right: [101, 102, 103] });
    expect(ring.available).toBe(2);
  });

  it("pads with silence on an underrun, counts it, and primes again", () => {
    const ring = new SampleRing(16, 4);
    ring.push(ramp(1, 4), ramp(1, 4));
    expect(pull(ring, 6).left).toEqual([1, 2, 3, 4, 0, 0]);
    expect(ring.underruns).toBe(1);
    ring.push(ramp(10, 2), ramp(10, 2));
    expect(pull(ring, 2).left).toEqual([0, 0]);
    ring.push(ramp(12, 2), ramp(12, 2));
    expect(pull(ring, 4).left).toEqual([10, 11, 12, 13]);
  });

  it("drops the oldest samples when full", () => {
    const ring = new SampleRing(4, 1);
    ring.push(ramp(1, 3), ramp(1, 3));
    ring.push(ramp(4, 3), ramp(4, 3));
    expect(ring.available).toBe(4);
    expect(pull(ring, 4).left).toEqual([3, 4, 5, 6]);
  });

  it("keeps only the newest samples of a push larger than itself", () => {
    const ring = new SampleRing(4, 1);
    ring.push(ramp(1, 10), ramp(1, 10));
    expect(pull(ring, 4).left).toEqual([7, 8, 9, 10]);
  });

  it("survives being rebuilt from its source text, as the worklet does", () => {
    const Rebuilt = new Function(`return (${SampleRing.toString()});`)() as typeof SampleRing;
    const ring = new Rebuilt(8, 2);
    ring.push(ramp(1, 2), ramp(1, 2));
    expect(pull(ring, 2).left).toEqual([1, 2]);
  });
});
