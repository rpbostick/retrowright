import { createHash } from "node:crypto";
import { crc32 as zlibCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildInes, PAINT_BACKDROP_PROGRAM, READ_PAD_PROGRAM } from "../test/syntheticRom";
import { applyPatch, bpsActions, crc32, crc32Hex, createBps, patchFormat, WrongRomError } from "./patch";

describe("bpsActions", () => {
  it("gives steps that rebuild the target: reads in place, the patch's own bytes, and copies from the offsets they come to", () => {
    // A moved run (a source copy from elsewhere), a repeated run (a target copy) and new bytes.
    const source = Uint8Array.from({ length: 256 }, (_, index) => (index * 7) & 0xff);
    const target = source.slice();
    target.set(source.subarray(10, 60), 120);
    target.set(Array.from({ length: 20 }, (_, index) => 200 - index), 200);
    target.set(target.subarray(200, 220), 230);
    const actions = bpsActions(createBps(source, target));
    const rebuilt: number[] = [];
    for (const action of actions) {
      expect(action.targetOffset).toBe(rebuilt.length);
      for (let index = 0; index < action.length; index++) {
        if (action.kind === "target-read") rebuilt.push(action.bytes![index]);
        else if (action.kind === "target-copy") rebuilt.push(rebuilt[action.from! + index]);
        else rebuilt.push(source[action.from! + index]);
      }
    }
    expect(rebuilt).toEqual([...target]);
    expect(new Set(actions.map((action) => action.kind)).has("source-copy")).toBe(true);
  });
});

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** An IPS file written byte by byte, so the applier is checked against the format rather than against its own creator. */
function ips(records: { offset: number; data?: number[]; rle?: { length: number; byte: number } }[], truncate?: number): Uint8Array {
  const bytes = [..."PATCH"].map((char) => char.charCodeAt(0));
  for (const record of records) {
    bytes.push(record.offset >> 16, (record.offset >> 8) & 0xff, record.offset & 0xff);
    if (record.rle) bytes.push(0, 0, record.rle.length >> 8, record.rle.length & 0xff, record.rle.byte);
    else bytes.push(record.data!.length >> 8, record.data!.length & 0xff, ...record.data!);
  }
  bytes.push(0x45, 0x4f, 0x46);
  if (truncate !== undefined) bytes.push(truncate >> 16, (truncate >> 8) & 0xff, truncate & 0xff);
  return Uint8Array.from(bytes);
}

describe("createBps and applyPatch", () => {
  const source = buildInes({ program: READ_PAD_PROGRAM });
  const target = buildInes({ program: PAINT_BACKDROP_PROGRAM, prgBanks: 2 });

  it("makes a BPS that turns the source into the target, byte for byte", () => {
    const patch = createBps(source, target);
    expect(patchFormat(patch)).toBe("bps");
    const applied = applyPatch(source, patch);
    expect(applied.format).toBe("bps");
    expect(sha256(applied.data)).toBe(sha256(target));
    expect(applied.metadata).toBeNull();
  });

  it("makes a BPS that shrinks a ROM", () => {
    expect(sha256(applyPatch(target, createBps(target, source)).data)).toBe(sha256(source));
  });

  it("stores the CRC32 of source and target that zlib computes", () => {
    const patch = createBps(source, target);
    const footer = new DataView(patch.buffer, patch.byteOffset + patch.length - 12, 12);
    expect(footer.getUint32(0, true)).toBe(zlibCrc32(source));
    expect(footer.getUint32(4, true)).toBe(zlibCrc32(target));
    expect(footer.getUint32(8, true)).toBe(zlibCrc32(patch.subarray(0, patch.length - 4)));
    expect(crc32(source)).toBe(zlibCrc32(source));
  });

  it("keeps a description as UTF-8", () => {
    const applied = applyPatch(source, createBps(source, target, "Backdrop — red"));
    expect(applied.metadata).toBe("Backdrop — red");
    expect(sha256(applied.data)).toBe(sha256(target));
  });

  it("refuses a BPS for another ROM, naming the CRC32 it expects", () => {
    const patch = createBps(source, target);
    const other = buildInes({ program: [0xea, 0x4c, 0x00, 0x80] });
    const expected = crc32Hex(zlibCrc32(source));
    expect(() => applyPatch(other, patch)).toThrow(WrongRomError);
    expect(() => applyPatch(other, patch)).toThrow(`This patch is for a ROM with CRC32 ${expected}; this ROM's CRC32 is ${crc32Hex(zlibCrc32(other))}.`);
  });

  it("refuses a damaged BPS", () => {
    const patch = createBps(source, target);
    patch[10] ^= 0xff;
    expect(() => applyPatch(source, patch)).toThrow(/This BPS patch is damaged/);
    expect(() => applyPatch(source, patch.subarray(0, 12))).toThrow("This BPS patch is 12 bytes long, too short to be whole.");
  });

  it("refuses a BPS cut short by any number of bytes, without reading past its end", () => {
    const patch = createBps(source, target);
    for (let cut = 1; cut <= patch.length - 19; cut++) {
      const truncated = patch.subarray(0, patch.length - cut);
      expect(() => applyPatch(source, truncated), `cut by ${cut}`).toThrow(/This BPS patch is damaged: its CRC32 is [0-9A-F]{8}, not the [0-9A-F]{8} written at its end/);
    }
  });

  it("copies data moved by an insertion instead of carrying it in the patch", () => {
    const noisy = buildInes();
    let seed = 1;
    for (let index = 16; index < noisy.length; index++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      noisy[index] = seed >>> 24;
    }
    const inserted = new Uint8Array(noisy.length + 3);
    inserted.set(noisy.subarray(0, 100));
    inserted.set([0xea, 0xea, 0xea], 100);
    inserted.set(noisy.subarray(100), 103);
    const patch = createBps(noisy, inserted);
    expect(patch.length).toBeLessThan(100);
    expect(sha256(applyPatch(noisy, patch).data)).toBe(sha256(inserted));
  });

  it("reads byte arrays that are views into a larger buffer", () => {
    const padded = new Uint8Array(source.length + 32);
    padded.set(source, 16);
    const view = padded.subarray(16, 16 + source.length);
    const patch = createBps(view, target);
    const patchPadded = new Uint8Array(patch.length + 8);
    patchPadded.set(patch, 4);
    expect(sha256(applyPatch(view, patchPadded.subarray(4, 4 + patch.length)).data)).toBe(sha256(target));
  });
});

describe("applyPatch with IPS", () => {
  const rom = buildInes();

  it("writes plain and run-length records", () => {
    const applied = applyPatch(rom, ips([{ offset: 16, data: [0xa9, 0x01] }, { offset: 0x20, rle: { length: 4, byte: 0x7e } }]));
    const expected = rom.slice();
    expected.set([0xa9, 0x01], 16);
    expected.fill(0x7e, 0x20, 0x24);
    expect(applied.format).toBe("ips");
    expect(sha256(applied.data)).toBe(sha256(expected));
  });

  it("extends a ROM to a record past its end, and truncates to the size after EOF", () => {
    expect(applyPatch(rom, ips([{ offset: rom.length + 1, data: [0x55] }])).data.length).toBe(rom.length + 2);
    expect(applyPatch(rom, ips([], 1024)).data).toEqual(rom.slice(0, 1024));
  });

  it("refuses an IPS without its EOF", () => {
    const patch = ips([{ offset: 16, data: [1, 2, 3] }]);
    expect(() => applyPatch(rom, patch.subarray(0, patch.length - 3))).toThrow("This IPS patch does not end with EOF; it is cut short or damaged.");
  });
});

it("refuses a file that is neither IPS nor BPS", () => {
  expect(() => applyPatch(buildInes(), buildInes())).toThrow("This is not an IPS or BPS patch: it starts with neither PATCH nor BPS1.");
});
