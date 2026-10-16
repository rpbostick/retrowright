import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JsnesCore } from "../core/jsnesCore";
import { parseMovie } from "../movie/format";
import { bootMovie, MovieRunner } from "../movie/runner";
import { sha256Hex } from "../storage/gameStore";
import { NES_RAM_RANGES, RamSearch, readValue } from "./ramSearch";

/** A fake RAM: every byte 0 unless set. */
function fakeRam(values: Record<number, number> = {}) {
  const ram = new Map<number, number>(Object.entries(values).map(([address, value]) => [Number(address), value]));
  return { ram, peek: (address: number) => ram.get(address) ?? 0 };
}

const RANGES = [[0x10, 0x17]] as const;

describe("readValue", () => {
  it("reads 1 or 2 bytes, little-endian, signed or not", () => {
    const { peek } = fakeRam({ 0x10: 0xfe, 0x11: 0xff, 0x12: 0x34, 0x13: 0x12 });
    expect(readValue(peek, 0x10, { size: 1, signed: false })).toBe(254);
    expect(readValue(peek, 0x10, { size: 1, signed: true })).toBe(-2);
    expect(readValue(peek, 0x12, { size: 2, signed: false })).toBe(0x1234);
    expect(readValue(peek, 0x10, { size: 2, signed: true })).toBe(-2);
    expect(readValue(peek, 0x10, { size: 2, signed: false })).toBe(0xfffe);
  });
});

describe("RamSearch", () => {
  it("starts with every address of work and cartridge RAM", () => {
    const search = new RamSearch(fakeRam().peek, { size: 1, signed: false });
    expect(search.count).toBe(0x800 + 0x2000);
    expect(NES_RAM_RANGES).toEqual([
      [0x0000, 0x07ff],
      [0x6000, 0x7fff],
    ]);
    // A 2-byte value never runs off the end of a range.
    search.reset({ size: 2, signed: false });
    expect(search.count).toBe(0x7ff + 0x1fff);
  });

  it("narrows by a given value, then by comparison with the last step", () => {
    const { ram, peek } = fakeRam({ 0x10: 5, 0x11: 5, 0x12: 7, 0x13: 5 });
    const search = new RamSearch(peek, { size: 1, signed: false }, RANGES);
    expect(search.filter({ comparison: "equal", value: 5 })).toBe(3);
    ram.set(0x10, 6);
    ram.set(0x11, 4);
    expect(search.filter({ comparison: "greater" })).toBe(1);
    expect(search.candidates()).toEqual([{ address: 0x10, value: 6, previous: 6 }]);
  });

  it("keeps changed or unchanged values against the last step, which each step moves on", () => {
    const { ram, peek } = fakeRam({ 0x10: 1, 0x11: 1 });
    const search = new RamSearch(peek, { size: 1, signed: false }, RANGES);
    ram.set(0x10, 2);
    expect(search.filter({ comparison: "changed" })).toBe(1);
    expect(search.candidates()[0].address).toBe(0x10);
    // $10 is 2 at the step just taken: unchanged from there.
    expect(search.filter({ comparison: "unchanged" })).toBe(1);
    ram.set(0x10, 3);
    expect(search.filter({ comparison: "unchanged" })).toBe(0);
  });

  it("compares not equal, less, and signed values", () => {
    const { peek } = fakeRam({ 0x10: 0xff, 0x11: 0x01, 0x12: 0x80 });
    const search = new RamSearch(peek, { size: 1, signed: true }, RANGES);
    expect(search.filter({ comparison: "less", value: 0 })).toBe(2);
    expect(search.candidates().map((candidate) => candidate.value)).toEqual([-1, -128]);
    expect(search.filter({ comparison: "notEqual", value: -1 })).toBe(1);
  });

  it("compares 2-byte values", () => {
    const { peek } = fakeRam({ 0x10: 0x34, 0x11: 0x12 });
    const search = new RamSearch(peek, { size: 2, signed: false }, RANGES);
    expect(search.filter({ comparison: "equal", value: 0x1234 })).toBe(1);
    expect(search.candidates()).toEqual([{ address: 0x10, value: 0x1234, previous: 0x1234 }]);
  });

  it("undoes steps one at a time, and reset starts over", () => {
    const { peek } = fakeRam({ 0x10: 1 });
    const search = new RamSearch(peek, { size: 1, signed: false }, RANGES);
    search.filter({ comparison: "equal", value: 0 });
    search.filter({ comparison: "greater", value: 0 });
    expect(search.count).toBe(0);
    expect(search.steps).toBe(2);
    expect(search.undo()).toBe(true);
    expect(search.count).toBe(7);
    expect(search.undo()).toBe(true);
    expect(search.count).toBe(8);
    expect(search.undo()).toBe(false);
    search.filter({ comparison: "equal", value: 1 });
    search.reset();
    expect(search.count).toBe(8);
    expect(search.steps).toBe(0);
  });

  it("refuses a value the size and sign cannot hold", () => {
    const search = new RamSearch(fakeRam().peek, { size: 1, signed: false }, RANGES);
    expect(() => search.filter({ comparison: "equal", value: 256 })).toThrow("not a 1-byte unsigned value (0 to 255)");
    expect(() => search.filter({ comparison: "equal", value: -1 })).toThrow(RangeError);
    expect(() => search.filter({ comparison: "equal", value: 1.5 })).toThrow(RangeError);
    search.reset({ size: 2, signed: true });
    expect(() => search.filter({ comparison: "equal", value: -32769 })).toThrow("-32768 to 32767");
    expect(search.steps).toBe(0);
  });
});

// The Final Fantasy movie and ROM, when present, as the replay suite finds them.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ROMS = process.env.RETROWRIGHT_ROMS ?? join(ROOT, "roms");
const MOVIE_PATH = join(ROOT, "movies", "ff1-new-game.rwmovie.json");
const ROM_PATH = join(ROMS, "Final_Fantasy_USA.nes");
const ff1 = existsSync(MOVIE_PATH) && existsSync(ROM_PATH) ? { movie: parseMovie(JSON.parse(readFileSync(MOVIE_PATH, "utf8"))), rom: new Uint8Array(readFileSync(ROM_PATH)) } : null;

describe("RamSearch on Final Fantasy", () => {
  it.skipIf(!ff1)(`finds the map byte $48 from ff1-new-game in three steps${ff1 ? "" : " (skipped: the movie or the Final Fantasy ROM is not here)"}`, async () => {
    const { movie, rom } = ff1!;
    expect(await sha256Hex(rom)).toBe(movie.rom.sha256);
    const core = new JsnesCore({ onFrame() {}, onAudioSample() {}, onBatteryRamWrite() {} });
    bootMovie(core, rom, movie.start);
    const runner = new MovieRunner(core, movie);
    const runTo = (frame: number) => {
      while (runner.frame < frame) runner.step();
    };
    const search = new RamSearch((address) => core.peek(address), { size: 1, signed: false });

    // On the world map after naming the party: the map byte is 0.
    runTo(2600);
    search.filter({ comparison: "equal", value: 0 });
    // Inside Coneria Castle (map 8), the movie's "inside the castle" checkpoint.
    runTo(2838);
    search.filter({ comparison: "equal", value: 8 });
    // Back outside, the byte keeps the last standard map: unchanged.
    runTo(3278);
    search.filter({ comparison: "unchanged" });

    expect(search.steps).toBe(3);
    expect(search.candidates().map((candidate) => candidate.address)).toEqual([0x48]);
  }, 60_000);
});
