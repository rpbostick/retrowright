import { describe, expect, it } from "vitest";
import { JsnesCore } from "../src/core/jsnesCore";
import { BATTLE_RNG_STATE } from "../src/games/ff1/memoryMap";
import type { Movie } from "../src/movie/format";
import { sha256Hex } from "../src/storage/gameStore";
import { buildInes } from "../src/test/syntheticRom";
import { bootAt, fceuxPowerOnPattern, fillWorkRam, initialWorkRam } from "./tasStart";

const EMPTY_MOVIE: Movie = {
  format: "retrowright-movie",
  version: 1,
  rom: { name: "", sha256: "" },
  core: { name: "jsnes", version: "2.1.0" },
  start: { kind: "power-on", batteryRam: null },
  frames: 10,
  inputs: [],
  events: [],
  checkpoints: [],
};

function loadedCore(): JsnesCore {
  const core = new JsnesCore({ onFrame() {}, onAudioSample() {}, onBatteryRamWrite() {} });
  core.load(buildInes());
  return core;
}

describe("tasStart", () => {
  it("writes FCEUX's power-on pattern: four $00, then four $FF", () => {
    expect(Array.from(fceuxPowerOnPattern(12))).toEqual([0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]);
    expect(initialWorkRam("zeros").every((byte) => byte === 0)).toBe(true);
    expect(initialWorkRam("fceux")).toHaveLength(0x800);
  });

  it("fills a jsnes core's work RAM through a save state, mirrors included", () => {
    const core = loadedCore();
    expect(core.peek(0x0004)).toBe(0xff); // jsnes's own power-on RAM
    fillWorkRam(core, initialWorkRam("zeros"));
    expect(core.peek(0x0004)).toBe(0);
    fillWorkRam(core, initialWorkRam("fceux"));
    expect([0x0003, 0x0004, 0x07ff, 0x0804].map((address) => core.peek(address))).toEqual([0, 0xff, 0xff, 0xff]);
  });

  it("boots a movie's start with the work-RAM fill and battle RNG state given", async () => {
    const rom = buildInes({ battery: true });
    const movie: Movie = { ...EMPTY_MOVIE, rom: { name: "battery.nes", sha256: await sha256Hex(rom) } };
    const { core, runner } = bootAt(rom, movie, { fill: "zeros", battleRng: 0x5a });
    expect(core.peek(BATTLE_RNG_STATE)).toBe(0x5a);
    expect(core.peek(0x0004)).toBe(0);
    expect(runner.frame).toBe(0);
    expect(() => bootAt(buildInes(), movie, { fill: "jsnes", battleRng: 0 })).toThrow("the core reported none");
  });

  it("refuses a core whose save state it does not know", () => {
    const core = loadedCore();
    const other = Object.assign(Object.create(Object.getPrototypeOf(core)), core, { name: "other" });
    expect(() => fillWorkRam(other, initialWorkRam("zeros"))).toThrow("Cannot fill work RAM on other");
  });
});
