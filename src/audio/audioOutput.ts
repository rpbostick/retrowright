import { AUDIO_SAMPLE_RATE } from "../core/types";
import { SampleRing } from "./sampleRing";

// Web Audio output through an AudioWorklet. The approach (worklet code from a
// Blob URL, samples batched over its MessagePort into a ring buffer) follows
// jsnes's src/browser/speakers.js; see NOTICE.
//
// Deliberate: samples travel by postMessage, not a SharedArrayBuffer, because
// SharedArrayBuffer needs cross-origin isolation headers that GitHub Pages
// cannot send.

const PROCESSOR_NAME = "retrowright-ring";
/** About 100 ms at 48 kHz: the most audio that can queue up. */
const RING_CAPACITY = 4800;
/** Two NES frames of sound buffered before playing. */
const RING_PRIME = 1600;
const BATCH_CAPACITY = 4096;

const workletSource = `
const SampleRing = (${SampleRing.toString()});
class RingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new SampleRing(${RING_CAPACITY}, ${RING_PRIME});
    this.quanta = 0;
    this.port.onmessage = (event) => this.ring.push(event.data.left, event.data.right);
  }
  process(inputs, outputs) {
    const output = outputs[0];
    this.ring.pull(output[0], output[1] || output[0]);
    this.quanta++;
    if (this.quanta % 375 === 0) {
      this.port.postMessage({ quanta: this.quanta, underruns: this.ring.underruns, queued: this.ring.available });
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(PROCESSOR_NAME)}, RingProcessor);
`;

export interface AudioStats {
  /** "not started", or the AudioContext state: "suspended", "running", "closed". */
  state: string;
  /** Render quanta the worklet has processed; rising while sound is playing. */
  quanta: number;
  underruns: number;
  /** AudioContext.currentTime in seconds; it advances only while audio renders. */
  clock: number;
}

export class AudioOutput {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private starting: Promise<void> | null = null;
  private batchLeft = new Float32Array(BATCH_CAPACITY);
  private batchRight = new Float32Array(BATCH_CAPACITY);
  private batchLength = 0;
  private volume = 0.8;
  private muted = false;
  private readonly stats: Omit<AudioStats, "clock"> = { state: "not started", quanta: 0, underruns: 0 };

  /** Must be called from a user gesture: browsers keep audio off until one. */
  start(): Promise<void> {
    this.starting ??= this.open();
    return this.starting;
  }

  private async open(): Promise<void> {
    if (typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") {
      throw new Error("This browser has no AudioWorklet support, so there is no sound.");
    }
    const context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE, latencyHint: "interactive" });
    this.context = context;
    context.onstatechange = () => {
      if (this.stats.state !== "processor error") this.stats.state = context.state;
      console.info(`[retrowright] AudioContext ${context.state}`);
    };
    this.stats.state = context.state;
    const url = URL.createObjectURL(new Blob([workletSource], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const node = new AudioWorkletNode(context, PROCESSOR_NAME, { outputChannelCount: [2] });
    node.onprocessorerror = () => {
      this.stats.state = "processor error";
      console.error("[retrowright] The AudioWorklet processor failed; there is no sound.");
    };
    node.port.onmessage = (event: MessageEvent<{ quanta: number; underruns: number }>) => {
      this.stats.quanta = event.data.quanta;
      this.stats.underruns = event.data.underruns;
    };
    const gain = context.createGain();
    node.connect(gain).connect(context.destination);
    this.node = node;
    this.gain = gain;
    this.applyGain();
    await context.resume();
    if (this.stats.state !== "processor error") this.stats.state = context.state;
    console.info(`[retrowright] AudioWorklet started, AudioContext ${context.state}`);
  }

  writeSample = (left: number, right: number): void => {
    if (!this.node) return; // no sound until the first gesture starts audio
    if (this.batchLength === BATCH_CAPACITY) this.flush();
    this.batchLeft[this.batchLength] = left;
    this.batchRight[this.batchLength] = right;
    this.batchLength++;
  };

  /** Sends the samples of the frames just run to the worklet. */
  flush(): void {
    if (!this.node || this.batchLength === 0) return;
    const left = this.batchLeft.slice(0, this.batchLength);
    const right = this.batchRight.slice(0, this.batchLength);
    this.node.port.postMessage({ left, right }, [left.buffer, right.buffer]);
    this.batchLength = 0;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  /** Stops the clock while the game is paused, so no stale sound plays on resume. */
  async pause(): Promise<void> {
    this.batchLength = 0;
    if (this.context?.state === "running") await this.context.suspend();
  }

  async resume(): Promise<void> {
    if (this.context?.state === "suspended") await this.context.resume();
  }

  getStats(): AudioStats {
    return { ...this.stats, clock: this.context?.currentTime ?? 0 };
  }

  private applyGain(): void {
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume;
  }
}
