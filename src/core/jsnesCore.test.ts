import { describe, expect, it, vi } from "vitest";
import { JsnesCore } from "./jsnesCore";
import { Button, SCREEN_HEIGHT, SCREEN_WIDTH } from "./types";
import { buildInes, PAINT_BACKDROP_PROGRAM, READ_BOTH_PADS_PROGRAM, READ_PAD_BIT_PER_FRAME_PROGRAM, WRITE_BATTERY_RAM_PROGRAM } from "../test/syntheticRom";

function makeCore() {
  const callbacks = { onFrame: vi.fn(), onAudioSample: vi.fn(), onBatteryRamWrite: vi.fn() };
  return { core: new JsnesCore(callbacks), callbacks };
}

const batteryRom = () => buildInes({ battery: true, program: WRITE_BATTERY_RAM_PROGRAM });

describe("JsnesCore", () => {
  it("emits a full frame of pixels and audio samples per frame", () => {
    const { core, callbacks } = makeCore();
    core.load(buildInes());
    core.frame();
    expect(callbacks.onFrame).toHaveBeenCalledTimes(1);
    expect(callbacks.onFrame.mock.calls[0][0]).toHaveLength(SCREEN_WIDTH * SCREEN_HEIGHT);
    // 48000 Hz / 60.1 frames per second is about 800 samples a frame.
    expect(callbacks.onAudioSample.mock.calls.length).toBeGreaterThan(700);
    expect(callbacks.onAudioSample.mock.calls.length).toBeLessThan(900);
  });

  it("refuses a ROM it cannot run, naming why", () => {
    const { core } = makeCore();
    expect(() => core.load(buildInes({ mapper: 69 }))).toThrow("mapper 69");
  });

  it("reports battery RAM writes and returns the RAM", () => {
    const { core, callbacks } = makeCore();
    core.load(batteryRom());
    core.frame();
    expect(callbacks.onBatteryRamWrite).toHaveBeenCalled();
    const ram = core.batteryRam();
    expect(ram).toHaveLength(0x2000);
    expect(ram?.[0]).toBe(0x42);
    expect(ram?.[0x1fff]).toBe(0x17);
  });

  it("has no battery RAM for a cartridge without a battery", () => {
    const { core } = makeCore();
    core.load(buildInes());
    expect(core.batteryRam()).toBeNull();
  });

  it("restores battery RAM into a freshly loaded game", () => {
    const { core } = makeCore();
    core.load(buildInes({ battery: true }));
    const saved = new Uint8Array(0x2000);
    saved[0x100] = 0x99;
    saved[0x1ffe] = 0x5a;
    core.restoreBatteryRam(saved);
    core.frame();
    expect(core.batteryRam()).toEqual(saved);
  });

  it("keeps battery RAM across a reset, as cartridge SRAM does", () => {
    const { core } = makeCore();
    core.load(buildInes({ battery: true }));
    const saved = new Uint8Array(0x2000);
    saved[0] = 0x33;
    saved[0x1fff] = 0xc4;
    core.restoreBatteryRam(saved);
    core.frame();
    core.reset();
    expect(core.batteryRam()).toEqual(saved);
    core.frame();
    expect(core.batteryRam()).toEqual(saved);
  });

  it("refuses battery RAM of the wrong size", () => {
    const { core } = makeCore();
    core.load(buildInes({ battery: true }));
    expect(() => core.restoreBatteryRam(new Uint8Array(10))).toThrow("8192 bytes");
  });

  it("round-trips a save state through structured clone", () => {
    const { core } = makeCore();
    core.load(batteryRom());
    core.frame();
    const state = structuredClone(core.saveState());
    core.frame();
    core.frame();
    const later = JSON.stringify(core.saveState());

    const { core: other } = makeCore();
    other.load(batteryRom());
    other.loadState(state);
    expect(JSON.stringify(other.saveState()) === JSON.stringify(state)).toBe(true);
    other.frame();
    other.frame();
    expect(JSON.stringify(other.saveState()) === later).toBe(true);
  });

  it("keeps a save state unchanged while the game runs on", () => {
    const { core } = makeCore();
    core.load(buildInes());
    core.buttonDown(1, Button.A);
    const state = core.saveState();
    const before = JSON.stringify(state);
    core.buttonUp(1, Button.A);
    core.frame();
    // toBe(true) rather than toEqual: a failure diff of the whole state is
    // hundreds of kilobytes.
    expect(JSON.stringify(state) === before).toBe(true);
    core.loadState(state);
    core.buttonDown(1, Button.B);
    core.frame();
    expect(JSON.stringify(state) === before).toBe(true);
  });

  it("keeps a quick save state unchanged while the game runs on, though it copies only what jsnes would share", () => {
    const { core } = makeCore();
    core.load(buildInes());
    core.buttonDown(1, Button.A);
    const state = core.saveStateQuick();
    const before = JSON.stringify(state);
    expect(before === JSON.stringify(core.saveState())).toBe(true);
    core.buttonUp(1, Button.A);
    core.frame();
    expect(JSON.stringify(state) === before).toBe(true);
    core.loadStateQuick(state);
    core.buttonDown(1, Button.B);
    core.frame();
    expect(JSON.stringify(state) === before).toBe(true);
  });

  it("refuses a quick save state from another core", () => {
    const { core } = makeCore();
    core.load(buildInes());
    expect(() => core.loadStateQuick({ core: "other", data: {} })).toThrow("made by other");
  });

  it("gives back the picture of the frame a state was saved on once the state is loaded", () => {
    const paint = buildInes({ program: PAINT_BACKDROP_PROGRAM });
    const { core, callbacks } = makeCore();
    core.load(paint);
    for (let frame = 0; frame < 3; frame++) core.frame();
    const shown = Uint32Array.from(callbacks.onFrame.mock.lastCall![0] as Uint32Array);
    expect(core.picture()).toEqual(shown);
    const state = structuredClone(core.saveState());

    const { core: fresh } = makeCore();
    fresh.load(paint);
    expect(fresh.picture()).not.toEqual(shown);
    fresh.loadState(state);
    expect(fresh.picture()).toEqual(shown);
  });

  it("refuses a save state from another core", () => {
    const { core } = makeCore();
    core.load(buildInes());
    expect(() => core.loadState({ core: "other", data: {} })).toThrow("made by other");
  });

  it("peeks work RAM, its mirrors and cartridge RAM the program wrote", () => {
    const { core } = makeCore();
    // LDA #$5A / STA $0123 / LDA #$42 / STA $6000 / loop: JMP loop
    core.load(buildInes({ battery: true, program: [0xa9, 0x5a, 0x8d, 0x23, 0x01, 0xa9, 0x42, 0x8d, 0x00, 0x60, 0x4c, 0x0a, 0x80] }));
    // jsnes powers work RAM on as $FF.
    expect(core.peek(0x0123)).toBe(0xff);
    core.frame();
    expect(core.peek(0x0123)).toBe(0x5a);
    expect(core.peek(0x0923)).toBe(0x5a);
    expect(core.peek(0x1923)).toBe(0x5a);
    expect(core.peek(0x6000)).toBe(0x42);
    // PRG ROM: the first opcode of the program, and the reset vector's high byte.
    expect(core.peek(0x8000)).toBe(0xa9);
    expect(core.peek(0xfffd)).toBe(0x80);
  });

  it("refuses to peek registers and addresses outside the bus", () => {
    const { core } = makeCore();
    core.load(buildInes());
    expect(() => core.peek(0x2002)).toThrow("register");
    expect(() => core.peek(0x4016)).toThrow("register");
    expect(() => core.peek(0x10000)).toThrow("outside");
    expect(() => core.peek(-1)).toThrow("outside");
  });

  it("passes buttons to the right controller, as the game reads them", () => {
    const { core } = makeCore();
    core.load(buildInes({ program: READ_BOTH_PADS_PROGRAM }));
    const read = () => [core.peek(0x20), core.peek(0x21)];
    core.buttonDown(1, Button.Start);
    core.buttonDown(2, Button.Left);
    core.frame();
    expect(read()).toEqual([0x10, 0x02]);
    core.buttonUp(1, Button.Start);
    core.frame();
    expect(read()).toEqual([0x00, 0x02]);
  });

  it("keeps the buttons held at the strobe for the whole read, as a pad's shift register does, when the read spans frames", () => {
    const { core } = makeCore();
    core.load(buildInes({ program: READ_PAD_BIT_PER_FRAME_PROGRAM }));
    const directions = [Button.Left, Button.Right, Button.Up, Button.Down];
    const reads = new Set<number>();
    for (let frame = 0; frame < 200; frame++) {
      // One direction a frame: a pass read live would mix several, Left with Right among them.
      for (const button of directions) core.buttonUp(1, button);
      core.buttonDown(1, directions[frame % directions.length]);
      core.frame();
      // $20 holds power-on RAM until the first pass ends.
      if (frame >= 20) reads.add(core.peek(0x20));
    }
    expect(reads.size).toBeGreaterThan(1);
    expect([...reads].filter((read) => ![0x01, 0x02, 0x04, 0x08].includes(read))).toEqual([]);
  });
});
