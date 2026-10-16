// IPS and BPS patches, through Rom Patcher JS's format modules (vendored in
// src/vendor/rompatcher). The same module runs in the page and in the harness.

import BinFile from "../vendor/rompatcher/BinFile.js";
import BPS from "../vendor/rompatcher/RomPatcher.format.bps.js";
import IPS from "../vendor/rompatcher/RomPatcher.format.ips.js";

export type PatchFormat = "ips" | "bps";

export const PATCH_EXTENSIONS = [".ips", ".bps"] as const;

export interface AppliedPatch {
  format: PatchFormat;
  data: Uint8Array;
  /** A BPS patch's own description, or null when it has none (and for every IPS patch). */
  metadata: string | null;
}

export function crc32Hex(value: number): string {
  return value.toString(16).toUpperCase().padStart(8, "0");
}

/** A BPS patch made from another ROM than the one it is applied to. */
export class WrongRomError extends Error {
  constructor(
    readonly expectedCrc32: number,
    readonly actualCrc32: number,
  ) {
    super(`This patch is for a ROM with CRC32 ${crc32Hex(expectedCrc32)}; this ROM's CRC32 is ${crc32Hex(actualCrc32)}.`);
    this.name = "WrongRomError";
  }
}

/** Magic, three size numbers of at least a byte each, and the three CRC32s at the end. */
const BPS_MIN_SIZE = 4 + 3 + 12;
const IPS_EOF = [0x45, 0x4f, 0x46];

/**
 * Deliberate: every byte array goes in as a copy. BinFile reads a typed array
 * through its whole buffer, so a view into a larger buffer (a subarray, a Node
 * Buffer from the pool) would bring in bytes that are not the file's.
 */
function binFile(bytes: Uint8Array): BinFile {
  return new BinFile(bytes.slice());
}

function startsWith(bytes: Uint8Array, magic: string): boolean {
  return bytes.length >= magic.length && [...magic].every((char, index) => bytes[index] === char.charCodeAt(0));
}

export function crc32(data: Uint8Array): number {
  return binFile(data).hashCRC32();
}

/** The format named by the patch's first bytes; a file with neither magic is refused. */
export function patchFormat(patch: Uint8Array): PatchFormat {
  if (startsWith(patch, BPS.MAGIC)) return "bps";
  if (startsWith(patch, IPS.MAGIC)) return "ips";
  throw new Error("This is not an IPS or BPS patch: it starts with neither PATCH nor BPS1.");
}

function bytesFromBinaryString(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function binaryStringFromBytes(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

/**
 * Deliberate: checked before Rom Patcher JS parses the patch. Its parser reads
 * the actions first and compares this CRC32 only afterwards, and its
 * variable-length number reader loops past the end of a file cut short, so a
 * truncated patch would hang the page instead of being refused.
 */
function checkBpsCrc32(patch: Uint8Array): void {
  const written = new DataView(patch.buffer, patch.byteOffset + patch.length - 4, 4).getUint32(0, true);
  const actual = crc32(patch.subarray(0, patch.length - 4));
  if (actual !== written) {
    throw new Error(`This BPS patch is damaged: its CRC32 is ${crc32Hex(actual)}, not the ${crc32Hex(written)} written at its end; it is cut short or changed.`);
  }
}

function applyBps(rom: Uint8Array, patch: Uint8Array): AppliedPatch {
  if (patch.length < BPS_MIN_SIZE) throw new Error(`This BPS patch is ${patch.length} bytes long, too short to be whole.`);
  checkBpsCrc32(patch);
  let parsed: BPS;
  try {
    parsed = BPS.fromFile(binFile(patch));
  } catch (error) {
    throw new Error(`This BPS patch is damaged (${error instanceof Error ? error.message : String(error)}).`);
  }
  const romFile = binFile(rom);
  const actual = romFile.hashCRC32();
  if (actual !== parsed.sourceChecksum) throw new WrongRomError(parsed.sourceChecksum, actual);
  const data = parsed.apply(romFile, false)._u8array.slice();
  const produced = crc32(data);
  if (produced !== parsed.targetChecksum) {
    throw new Error(`The patched ROM's CRC32 is ${crc32Hex(produced)}, not the ${crc32Hex(parsed.targetChecksum)} this BPS patch promises; the patch is damaged.`);
  }
  const metadata = parsed.metaData === "" ? null : new TextDecoder().decode(bytesFromBinaryString(parsed.metaData));
  return { format: "bps", data, metadata };
}

/** An IPS file ends with EOF, or with EOF and a three-byte size to truncate or extend to. */
function endsLikeIps(patch: Uint8Array): boolean {
  const eofAt = (offset: number) => offset >= IPS.MAGIC.length && IPS_EOF.every((byte, index) => patch[offset + index] === byte);
  return eofAt(patch.length - 3) || eofAt(patch.length - 6);
}

function applyIps(rom: Uint8Array, patch: Uint8Array): AppliedPatch {
  if (!endsLikeIps(patch)) throw new Error("This IPS patch does not end with EOF; it is cut short or damaged.");
  let parsed: IPS;
  try {
    parsed = IPS.fromFile(binFile(patch));
  } catch (error) {
    throw new Error(`This IPS patch is damaged (${error instanceof Error ? error.message : String(error)}).`);
  }
  return { format: "ips", data: parsed.apply(binFile(rom))._u8array.slice(), metadata: null };
}

/**
 * Applies an IPS or BPS patch to a ROM and gives the patched ROM. A BPS patch
 * checks the ROM's CRC32 first and refuses another ROM with WrongRomError; an
 * IPS patch carries no checksum and applies to whatever it is given.
 */
export function applyPatch(rom: Uint8Array, patch: Uint8Array): AppliedPatch {
  return patchFormat(patch) === "bps" ? applyBps(rom, patch) : applyIps(rom, patch);
}

/**
 * A BPS patch that turns `source` into `target`, with an optional description
 * stored as UTF-8. Deliberate: the delta encoder, which also copies moved
 * runs from anywhere in the source, so code shifted by an insertion is not
 * carried in the patch byte by byte.
 */
export type BpsActionKind = "source-read" | "target-read" | "source-copy" | "target-copy";

/** One step of a BPS patch: `length` bytes of the target from `targetOffset`, read from `from` in the source or target (absent for target-read, whose bytes the patch carries). */
export interface BpsAction {
  kind: BpsActionKind;
  targetOffset: number;
  length: number;
  from?: number;
  bytes?: number[];
}

const BPS_ACTION_KINDS: BpsActionKind[] = ["source-read", "target-read", "source-copy", "target-copy"];

/** The steps a BPS patch takes to make its target, with the offsets its relative copies come to. */
export function bpsActions(patch: Uint8Array): BpsAction[] {
  checkBpsCrc32(patch);
  const parsed = BPS.fromFile(binFile(patch));
  let targetOffset = 0;
  let sourceCopy = 0;
  let targetCopy = 0;
  return parsed.actions.map((action) => {
    const kind = BPS_ACTION_KINDS[action.type];
    const step: BpsAction = { kind, targetOffset, length: action.length };
    if (kind === "source-read") step.from = targetOffset;
    if (kind === "target-read") step.bytes = [...action.bytes!];
    if (kind === "source-copy") {
      sourceCopy += action.relativeOffset!;
      step.from = sourceCopy;
      sourceCopy += action.length;
    }
    if (kind === "target-copy") {
      targetCopy += action.relativeOffset!;
      step.from = targetCopy;
      targetCopy += action.length;
    }
    targetOffset += action.length;
    return step;
  });
}

export function createBps(source: Uint8Array, target: Uint8Array, metadata?: string): Uint8Array {
  const patch = BPS.buildFromRoms(binFile(source), binFile(target), true);
  if (metadata) {
    patch.metaData = binaryStringFromBytes(new TextEncoder().encode(metadata));
    patch.patchChecksum = patch.calculateFileChecksum();
  }
  return patch.export()._u8array.slice();
}
