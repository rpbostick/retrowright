import { describe, expect, it } from "vitest";
import { parseInes } from "./ines";
import { buildInes } from "../test/syntheticRom";

describe("parseInes", () => {
  it("reads a good NROM header", () => {
    const result = parseInes(buildInes({ prgBanks: 2, chrBanks: 1 }));
    expect(result).toEqual({
      ok: true,
      header: {
        format: "iNES",
        mapper: 0,
        prgRomBytes: 32768,
        chrRomBytes: 8192,
        battery: false,
        trainer: false,
        mirroring: "horizontal",
      },
    });
  });

  it("reads the battery flag and a two-nibble mapper number", () => {
    const result = parseInes(buildInes({ mapper: 66, battery: true }));
    expect(result.ok && result.header.mapper).toBe(66);
    expect(result.ok && result.header.battery).toBe(true);
  });

  it("reads a twelve-bit NES 2.0 mapper number", () => {
    const rom = buildInes({ mapper: 0x0b4 });
    rom[7] |= 0x08; // NES 2.0 marker
    rom[8] = 0x01; // mapper bits 11..8
    const result = parseInes(rom);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("mapper 436");
  });

  it("drops the upper mapper nibble when bytes 8-15 hold junk", () => {
    const rom = buildInes({ mapper: 0x41 });
    rom.set([0x44, 0x69, 0x73, 0x6b], 10); // "Disk" from a "DiskDude!" dump
    const result = parseInes(rom);
    expect(result.ok && result.header.mapper).toBe(1);
  });

  it("rejects a wrong signature", () => {
    const rom = buildInes();
    rom[3] = 0x00;
    const result = parseInes(rom);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("not an NES ROM");
  });

  it("rejects a file shorter than the header", () => {
    const result = parseInes(new Uint8Array([0x4e, 0x45, 0x53]));
    expect(!result.ok && result.error).toContain("too short");
  });

  it("rejects a file shorter than its header says", () => {
    const rom = buildInes({ prgBanks: 2 });
    const result = parseInes(rom.subarray(0, rom.length - 100));
    expect(!result.ok && result.error).toContain("truncated");
  });

  it("names an unsupported mapper", () => {
    const result = parseInes(buildInes({ mapper: 69 }));
    expect(result).toEqual({
      ok: false,
      error: "This game uses mapper 69, which the emulator does not support yet.",
    });
  });
});
