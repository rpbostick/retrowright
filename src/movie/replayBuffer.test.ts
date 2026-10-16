import { describe, expect, it } from "vitest";
import { JsnesCore } from "../core/jsnesCore";
import type { SaveState } from "../core/types";
import { buildInes, READ_PAD_PROGRAM } from "../test/syntheticRom";
import { applyPad } from "./pads";
import { ReplayBuffer, type ReplayBufferStats } from "./replayBuffer";
import { bootMovie, MovieRunner } from "./runner";
import { screenHash } from "./screenHash";

const HEADER = { rom: { name: "pad.nes", sha256: "0".repeat(64) }, core: { name: "test", version: "1" } };
const stateAt = (frame: number) => (): SaveState => ({ core: "test", data: { frame } });

describe("ReplayBuffer", () => {
  it("keeps the newest state at least the window old, and every pad since", () => {
    const buffer = new ReplayBuffer({ windowFrames: 10, stateIntervalFrames: 4 });
    for (let frame = 0; frame < 23; frame++) buffer.recordFrame(frame % 256, 0, stateAt(frame));
    // 23 frames run: 13 is the last frame at least 10 back, so the state of frame 12 starts the replay.
    const movie = buffer.toMovie(HEADER, { screenHash: "fnv1a32:00000000" });
    expect(movie.start).toEqual({ kind: "save-state", state: { core: "test", data: { frame: 12 } } });
    expect(movie.frames).toBe(11);
    expect(movie.inputs.map((run) => run.pad1)).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    expect(movie.inputs.map((run) => run.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(movie.checkpoints).toEqual([{ frame: 11, name: "end", expect: { screenHash: "fnv1a32:00000000" } }]);
    expect(buffer.stats()).toEqual(expect.objectContaining({ states: 3, frames: 11 }));
  });

  it("covers everything run so far until the window fills", () => {
    const buffer = new ReplayBuffer({ windowFrames: 10, stateIntervalFrames: 4 });
    for (let frame = 0; frame < 7; frame++) buffer.recordFrame(1, 2, stateAt(frame));
    const movie = buffer.toMovie(HEADER, {});
    expect(movie.start).toEqual({ kind: "save-state", state: { core: "test", data: { frame: 0 } } });
    expect(movie.frames).toBe(7);
    expect(movie.inputs).toEqual([{ frame: 0, pad1: 1, pad2: 2 }]);
  });

  it("keeps the resets after the replay's start, and drops those its state already holds", () => {
    const buffer = new ReplayBuffer({ windowFrames: 6, stateIntervalFrames: 4 });
    for (let frame = 0; frame < 20; frame++) {
      if (frame === 3 || frame === 12 || frame === 17) buffer.recordReset();
      buffer.recordFrame(0, 0, stateAt(frame));
    }
    // 20 frames: the state of frame 12 starts the replay; the reset before frame 12 is in it.
    const movie = buffer.toMovie(HEADER, {});
    expect(movie.start).toEqual({ kind: "save-state", state: { core: "test", data: { frame: 12 } } });
    expect(movie.events).toEqual([{ frame: 5, kind: "reset" }]);
  });

  it("has nothing to save before a frame runs", () => {
    const buffer = new ReplayBuffer({ windowFrames: 10, stateIntervalFrames: 4 });
    expect(() => buffer.toMovie(HEADER, {})).toThrow("nothing to save");
    expect(() => new ReplayBuffer({ windowFrames: 0, stateIntervalFrames: 4 })).toThrow(RangeError);
  });

  it("holds no more states or bytes after a long session than after one window", () => {
    // A stand-in state of 100 KB, so the bound is in the numbers and not lost among the pads.
    const big = (): SaveState => ({ core: "test", data: "x".repeat(100_000) });
    // The player's numbers at 60 seconds: 60.0988 frames a second, a state every 5 seconds.
    const buffer = new ReplayBuffer({ windowFrames: 3606, stateIntervalFrames: 300 });
    const most = (stats: ReplayBufferStats[]) => ({ states: Math.max(...stats.map((each) => each.states)), bytes: Math.max(...stats.map((each) => each.bytes)) });
    const firstWindows: ReplayBufferStats[] = [];
    for (let frame = 0; frame < 7800; frame++) {
      buffer.recordFrame(frame & 0xff, 0, big);
      if (frame >= 3600) firstWindows.push(buffer.stats());
    }
    // An hour of play at 60 frames a second.
    const hour: ReplayBufferStats[] = [];
    for (let frame = 7800; frame < 60 * 60 * 60; frame++) {
      buffer.recordFrame(frame & 0xff, 0, big);
      if (frame % 7 === 0) hour.push(buffer.stats());
    }
    expect(most(hour).states).toBeLessThanOrEqual(most(firstWindows).states);
    expect(most(hour).bytes).toBeLessThanOrEqual(most(firstWindows).bytes);
    // At most the 13 states a window of 3606 frames can hold and the one just before it, of 100 KB each,
    // and two bytes a frame for the 3906 frames of the ring.
    expect(most(hour).states).toBe(14);
    expect(most(hour).bytes).toBeLessThan(14 * 100_100 + 2 * 3906);
    for (const stats of hour) {
      expect(stats.frames).toBeGreaterThanOrEqual(3606);
      expect(stats.frames).toBeLessThan(3906);
    }
  });

  it("saves a replay of a real game that runs to the same picture and RAM", () => {
    const rom = buildInes({ program: READ_PAD_PROGRAM });
    let pixels: Uint32Array | null = null;
    const callbacks = { onFrame: (frame: Uint32Array) => void (pixels = frame), onAudioSample() {}, onBatteryRamWrite() {} };
    const core = new JsnesCore(callbacks);
    core.load(rom);
    const buffer = new ReplayBuffer({ windowFrames: 120, stateIntervalFrames: 50 });
    for (let frame = 0; frame < 400; frame++) {
      // A on in some stretches and off in others, so the replay must feed every frame its own pads.
      const pad1 = frame % 37 < 11 ? 0x01 : 0;
      if (frame === 320) {
        core.reset();
        buffer.recordReset();
      }
      applyPad(core, 1, pad1);
      applyPad(core, 2, 0);
      buffer.recordFrame(pad1, 0, () => core.saveState());
      core.frame();
    }
    const ram = Array.from({ length: 0x20 }, (_, address) => core.peek(address));
    const movie = buffer.toMovie(HEADER, { screenHash: screenHash(pixels!) });
    expect(movie.frames).toBe(150);
    expect(movie.events).toEqual([{ frame: 70, kind: "reset" }]);

    const replayed = new JsnesCore(callbacks);
    bootMovie(replayed, rom, movie.start);
    const runner = new MovieRunner(replayed, movie);
    while (!runner.done) runner.step();
    expect(screenHash(pixels!)).toBe(movie.checkpoints[0].expect.screenHash);
    expect(Array.from({ length: 0x20 }, (_, address) => replayed.peek(address))).toEqual(ram);
    // $11 adds up A on every pass: nonzero shows the pads reached the game.
    expect(ram[0x11]).not.toBe(0);
  });
});
