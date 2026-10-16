import { describe, expect, it, vi } from "vitest";
import { JsnesCore } from "../core/jsnesCore";
import { MemoryGameStore } from "../storage/gameStore";
import { buildInes, COUNT_NMI_HANDLER, SHOW_RAM_COLOUR_PROGRAM } from "../test/syntheticRom";
import { Player } from "./player";

// The controls the developer console drives: pause and step, the pace, and
// writes to RAM, on a ROM that counts frames in $01 and shows $00 as the
// backdrop colour.

/** requestAnimationFrame driven by hand at 60 Hz. */
class FakeDisplay {
  private callback: ((time: number) => void) | null = null;
  time = 0;
  requestFrame = (callback: (time: number) => void) => {
    this.callback = callback;
    return 1;
  };
  cancelFrame = () => {
    this.callback = null;
  };
  run(seconds: number) {
    for (let tick = 0; tick < seconds * 60; tick++) {
      this.time += 1000 / 60;
      const callback = this.callback;
      this.callback = null;
      callback?.(this.time);
    }
  }
}

async function openCounter({ battery = false } = {}) {
  const store = new MemoryGameStore();
  const rom = await store.putRom("counter.nes", buildInes({ program: SHOW_RAM_COLOUR_PROGRAM, nmiHandler: COUNT_NMI_HANDLER, battery }));
  const display = new FakeDisplay();
  const writeSample = vi.fn();
  const present = vi.fn();
  const player = new Player({
    createCore: (callbacks) => new JsnesCore(callbacks),
    store,
    audio: { writeSample, flush() {}, pause: async () => {}, resume: async () => {} },
    screen: { setSize() {}, setFrame() {}, present },
    requestFrame: display.requestFrame,
    cancelFrame: display.cancelFrame,
    onError: vi.fn(),
  });
  await player.open(rom);
  display.run(0.5);
  return { player, display, writeSample, present, rom };
}

describe("the console's controls on the player", () => {
  it("steps paused frames: the game's own frame count moves by exactly the frames stepped, and the last is presented", async () => {
    const { player, display, present } = await openCounter();
    player.pause("console");
    const count = player.peek(0x01);
    const run = player.framesRun;
    display.run(0.5);
    expect(player.peek(0x01)).toBe(count);
    present.mockClear();
    player.step(5);
    expect(player.peek(0x01)).toBe((count + 5) & 0xff);
    expect(player.framesRun).toBe(run + 5);
    expect(present).toHaveBeenCalledTimes(1);
    player.resume("console");
    display.run(0.1);
    expect(player.peek(0x01)).not.toBe((count + 5) & 0xff);
  });

  it("drops the console's pause on close, so the next game opened runs", async () => {
    const { player, display, rom } = await openCounter();
    player.pause("console");
    await player.close();
    await player.open(rom);
    const run = player.framesRun;
    display.run(0.5);
    expect(player.isPausedBy("console")).toBe(false);
    expect(player.framesRun).toBeGreaterThan(run);
  });

  it("refuses to step while the game runs, and refuses a step of no frames", async () => {
    const { player } = await openCounter();
    expect(() => player.step(1)).toThrow("pause it to step");
    player.pause("console");
    expect(() => player.step(0)).toThrow(RangeError);
  });

  it("paces the game at a rate: half speed runs half the frames in a second, and sound is dropped off rate 1", async () => {
    const { player, display, writeSample } = await openCounter();
    player.setRate(0.5);
    let before = player.framesRun;
    display.run(2);
    expect(player.framesRun - before).toBeGreaterThanOrEqual(59);
    expect(player.framesRun - before).toBeLessThanOrEqual(61);
    writeSample.mockClear();
    display.run(0.2);
    expect(writeSample).not.toHaveBeenCalled();
    player.setRate(2);
    before = player.framesRun;
    display.run(1);
    // A new rate starts its pacing afresh, so the first display frame runs none.
    expect(player.framesRun - before).toBeGreaterThanOrEqual(117);
    expect(() => player.setRate(0.2)).toThrow("0.25 to 4");
    expect(() => player.setRate(5)).toThrow(RangeError);
    expect(player.rate).toBe(2);
  });

  it("writes RAM the game then shows, and refuses while a movie records", async () => {
    const { player, display } = await openCounter();
    const middle = 120 * 256 + 128;
    const black = player.picture()!.pixels[middle];
    player.poke(0x00, 0x2a);
    expect(player.peek(0x00)).toBe(0x2a);
    // Work RAM is mirrored every 2 KB.
    player.poke(0x0802, 0x11);
    expect(player.peek(0x02)).toBe(0x11);
    display.run(0.1);
    expect(player.picture()!.pixels[middle]).not.toBe(black);
    expect(() => player.poke(0x2000, 1)).toThrow("not RAM");
    expect(() => player.poke(0x8000, 1)).toThrow("not RAM");
    expect(() => player.poke(0x00, 256)).toThrow("not a byte");
    player.startRecording({ from: "current-state" });
    expect(() => player.poke(0x00, 0x16)).toThrow("could not be replayed");
    expect(player.peek(0x00)).toBe(0x2a);
  });

  it("writes battery RAM at $6000-$7FFF and stores it as a battery save", async () => {
    const { player } = await openCounter({ battery: true });
    player.poke(0x6000, 0x5a);
    player.poke(0x7fff, 0xa5);
    expect(player.peek(0x6000)).toBe(0x5a);
    expect(player.peek(0x7fff)).toBe(0xa5);
    await player.saveBatteryRam();
    const stored = await player.storedBatteryRam();
    expect(stored?.[0]).toBe(0x5a);
    expect(stored?.[0x1fff]).toBe(0xa5);
  });
});
