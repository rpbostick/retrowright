import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildInes } from "../src/test/syntheticRom";
import { fceuxRomMd5 } from "./fceuxRomMd5";

describe("fceuxRomMd5", () => {
  it("hashes PRG and CHR without the header, so header bytes do not change it", () => {
    const rom = buildInes({ chrBanks: 1 });
    const content = createHash("md5").update(rom.subarray(16)).digest("hex");
    expect(fceuxRomMd5(rom)).toBe(content);
    const relabelled = Uint8Array.from(rom);
    relabelled[15] = 0x44; // a "DiskDude!" style tail in the header's padding
    expect(fceuxRomMd5(relabelled)).toBe(content);
  });

  it("skips a trainer", () => {
    const plain = buildInes();
    const withTrainer = new Uint8Array(plain.length + 512);
    withTrainer.set(plain.subarray(0, 16));
    withTrainer[6] |= 0x04;
    withTrainer.fill(0xaa, 16, 16 + 512);
    withTrainer.set(plain.subarray(16), 16 + 512);
    expect(fceuxRomMd5(withTrainer)).toBe(fceuxRomMd5(plain));
  });

  it("leaves out bytes after CHR-ROM, such as a title some dumps append", () => {
    const plain = buildInes({ chrBanks: 1 });
    const withTail = new Uint8Array(plain.length + 128);
    withTail.set(plain);
    withTail.fill(0x55, plain.length);
    expect(fceuxRomMd5(withTail)).toBe(fceuxRomMd5(plain));
  });
});
