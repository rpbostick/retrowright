import { describe, expect, it } from "vitest";
import { parseAddressText, parseValueText } from "./numberText";
import { formatAddress, formatWatchValue, isWatchableAddress, loadWatches, saveWatches, type Watch } from "./watchList";

class FakeStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.has(key) ? this.items.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const asStorage = (fake: FakeStorage) => fake as unknown as Storage;
const ROM_A = "a".repeat(64);
const ROM_B = "b".repeat(64);
const MAP_WATCH: Watch = { address: 0x48, name: "map", size: 1, format: "hex" };

describe("watch list storage", () => {
  it("keeps each ROM's list under its SHA-256, as a setting a backup carries", () => {
    const storage = new FakeStorage();
    saveWatches(asStorage(storage), ROM_A, [MAP_WATCH]);
    expect([...storage.items.keys()]).toEqual([`retrowright.watches.v1.${ROM_A}`]);
    expect(loadWatches(asStorage(storage), ROM_A)).toEqual({ watches: [MAP_WATCH] });
    expect(loadWatches(asStorage(storage), ROM_B)).toEqual({ watches: [] });
  });

  it("starts empty and says so when the saved list cannot be read", () => {
    const storage = new FakeStorage();
    for (const bad of ["{not json", JSON.stringify({}), JSON.stringify([{ ...MAP_WATCH, address: 0x2000 }]), JSON.stringify([{ ...MAP_WATCH, size: 4 }]), JSON.stringify([{ ...MAP_WATCH, format: "octal" }])]) {
      storage.setItem(`retrowright.watches.v1.${ROM_A}`, bad);
      const loaded = loadWatches(asStorage(storage), ROM_A);
      expect(loaded.watches, bad).toEqual([]);
      expect(loaded.problem, bad).toContain("could not be read");
    }
  });

  it("works without localStorage, and refuses a key that is not a SHA-256", () => {
    expect(loadWatches(undefined, ROM_A)).toEqual({ watches: [] });
    expect(() => saveWatches(undefined, ROM_A, [MAP_WATCH])).not.toThrow();
    expect(() => loadWatches(undefined, "Final_Fantasy.nes")).toThrow("is not a ROM's SHA-256");
  });
});

describe("watch values and addresses", () => {
  const peek = (address: number) => ({ 0x10: 0xfe, 0x11: 0xff, 0x48: 8 })[address] ?? 0;

  it("shows a value in hex, decimal or signed", () => {
    expect(formatWatchValue(peek, MAP_WATCH)).toBe("$08");
    expect(formatWatchValue(peek, { ...MAP_WATCH, address: 0x10, format: "decimal" })).toBe("254");
    expect(formatWatchValue(peek, { ...MAP_WATCH, address: 0x10, format: "signed" })).toBe("-2");
    expect(formatWatchValue(peek, { ...MAP_WATCH, address: 0x10, size: 2 })).toBe("$FFFE");
    expect(formatWatchValue(peek, { ...MAP_WATCH, address: 0x10, size: 2, format: "signed" })).toBe("-2");
  });

  it("writes addresses as $ and four hex digits, and takes only RAM the tools read", () => {
    expect(formatAddress(0x48)).toBe("$0048");
    expect(formatAddress(0x7fff)).toBe("$7FFF");
    expect(isWatchableAddress(0x7ffe, 2)).toBe(true);
    expect(isWatchableAddress(0x7fff, 2)).toBe(false);
    expect(isWatchableAddress(0x0800, 1)).toBe(false);
    expect(isWatchableAddress(0x4016, 1)).toBe(false);
  });

  it("reads typed values in decimal or $hex, and addresses in hex", () => {
    expect(parseValueText("8")).toBe(8);
    expect(parseValueText(" -12 ")).toBe(-12);
    expect(parseValueText("$1f")).toBe(31);
    expect(parseValueText("0x1F")).toBe(31);
    expect(parseValueText("1f")).toBeNull();
    expect(parseValueText("")).toBeNull();
    expect(parseValueText("1.5")).toBeNull();
    expect(parseAddressText("$0048")).toBe(0x48);
    expect(parseAddressText("48")).toBe(0x48);
    expect(parseAddressText("0x6000")).toBe(0x6000);
    expect(parseAddressText("10000")).toBeNull();
    expect(parseAddressText("zz")).toBeNull();
  });
});
