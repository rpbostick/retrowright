/**
 * Stereo ring buffer between the emulator (writes ~800 samples per frame) and
 * the AudioWorklet (reads 128 per render quantum). It waits for `primeSize`
 * samples before playing, and again after running dry, so small gaps in
 * requestAnimationFrame do not crackle; when full it drops the oldest samples
 * to keep latency bounded.
 *
 * Deliberate: this class must not refer to anything outside itself. The
 * worklet is built from its source text (see audioOutput.ts) because an
 * AudioWorklet module cannot import the app's bundled modules.
 */
export class SampleRing {
  readonly capacity: number;
  readonly primeSize: number;
  private readonly left: Float32Array;
  private readonly right: Float32Array;
  private readPos = 0;
  private writePos = 0;
  private count = 0;
  private primed = false;
  underruns = 0;

  constructor(capacity: number, primeSize: number) {
    if (primeSize > capacity) throw new Error("primeSize must not exceed capacity");
    this.capacity = capacity;
    this.primeSize = primeSize;
    this.left = new Float32Array(capacity);
    this.right = new Float32Array(capacity);
  }

  get available(): number {
    return this.count;
  }

  push(left: Float32Array, right: Float32Array): void {
    const length = left.length;
    const start = Math.max(0, length - this.capacity);
    const incoming = length - start;
    const overflow = this.count + incoming - this.capacity;
    if (overflow > 0) {
      this.readPos = (this.readPos + overflow) % this.capacity;
      this.count -= overflow;
    }
    for (let index = start; index < length; index++) {
      this.left[this.writePos] = left[index];
      this.right[this.writePos] = right[index];
      this.writePos = (this.writePos + 1) % this.capacity;
    }
    this.count += incoming;
    if (this.count >= this.primeSize) this.primed = true;
  }

  /** Fills both outputs, with silence for whatever is missing. */
  pull(outLeft: Float32Array, outRight: Float32Array): void {
    const size = outLeft.length;
    let index = 0;
    if (this.primed) {
      const take = Math.min(size, this.count);
      for (; index < take; index++) {
        outLeft[index] = this.left[this.readPos];
        outRight[index] = this.right[this.readPos];
        this.readPos = (this.readPos + 1) % this.capacity;
      }
      this.count -= take;
      if (take < size) {
        this.primed = false;
        this.underruns++;
      }
    }
    for (; index < size; index++) {
      outLeft[index] = 0;
      outRight[index] = 0;
    }
  }
}
