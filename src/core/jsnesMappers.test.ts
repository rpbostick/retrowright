import { describe, expect, it } from "vitest";
import { NES } from "jsnes";
import { SUPPORTED_MAPPERS } from "../rom/ines";
import { buildInes } from "../test/syntheticRom";

describe("SUPPORTED_MAPPERS", () => {
  it("matches what jsnes accepts, for every iNES mapper number", () => {
    const acceptedByJsnes: number[] = [];
    for (let mapper = 0; mapper < 256; mapper++) {
      const nes = new NES({ emulateSound: false });
      try {
        nes.loadROM(buildInes({ mapper, prgBanks: 2, chrBanks: 1 }));
        acceptedByJsnes.push(mapper);
      } catch (error) {
        expect(String(error)).toContain(`Unsupported mapper: ${mapper}`);
      }
    }
    expect(acceptedByJsnes).toEqual([...SUPPORTED_MAPPERS].sort((a, b) => a - b));
  });
});
