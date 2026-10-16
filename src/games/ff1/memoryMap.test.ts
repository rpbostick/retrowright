import { describe, expect, it } from "vitest";
import { decodeText, FINAL_FANTASY_ADDRESSES, nameFinalFantasyAddress, readFinalFantasy } from "./memoryMap";

describe("Final Fantasy memory map", () => {
  it("decodes the game's text tiles", () => {
    expect(decodeText([0x8a, 0x8b, 0x8c, 0x8d])).toBe("ABCD");
    expect(decodeText([0xa4, 0x80, 0x89, 0xff])).toBe("a09");
    expect(decodeText([0x00])).toBe("{$00}");
  });

  it("reads a character, gold and where the party is", () => {
    const ram = new Map<number, number>([
      [0x6100, 3], [0x6101, 0x04], [0x6102, 0x95], [0x6103, 0x9e], [0x6104, 0x94], [0x6105, 0x8e],
      [0x610a, 0x2c], [0x610b, 0x01], [0x610c, 0x2d], [0x610d, 0x01], [0x6126, 4],
      [0x601c, 0x90], [0x601d, 0x01], [0x2d, 0x01], [0x48, 0x08], [0x29, 5], [0x2a, 0x13],
    ]);
    const view = readFinalFantasy((address) => ram.get(address) ?? 0);
    expect(view.party[0]).toEqual({ classId: 3, class: "Red Mage", name: "LUKE", level: 5, hp: 300, maxHp: 301, status: "poison" });
    expect(view).toMatchObject({ gold: 400, onWorldMap: false, mapId: 8, map: "Coneria Castle 1F", scrollX: 5, scrollY: 0x13, inBattle: false });
  });

  it("names a source for every address and marks the unverified ones", () => {
    for (const note of FINAL_FANTASY_ADDRESSES) expect(note.source).not.toBe("");
    expect(FINAL_FANTASY_ADDRESSES.filter((note) => note.verified === null).map((note) => note.address)).toEqual(["$81"]);
  });

  it("names the addresses it reads, for memory diffs", () => {
    expect(nameFinalFantasyAddress(0x48)).toBe("current standard map");
    expect(nameFinalFantasyAddress(0x601d)).toBe("gold, byte 1");
    expect(nameFinalFantasyAddress(0x6100 + 2 * 0x40 + 0x0b)).toBe("character 2 HP, byte 1");
    expect(nameFinalFantasyAddress(0x6100 + 3 * 0x40 + 0x26)).toBe("character 3 level - 1");
    expect(nameFinalFantasyAddress(0x6110)).toBe("character 0, stats +$10");
    expect(nameFinalFantasyAddress(0x688a)).toBe("battle RNG state");
    expect(nameFinalFantasyAddress(0x0300)).toBeNull();
    expect(nameFinalFantasyAddress(0x6200)).toBeNull();
  });
});
