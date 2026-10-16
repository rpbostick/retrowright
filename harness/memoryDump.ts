// The memory dump both emulators write for a frame-by-frame comparison: one
// record per dumped frame, each the frame count (frames run so far, 32-bit
// little-endian), work RAM $0000-$07FF and cartridge RAM $6000-$7FFF.
// tools/mesen/replay.lua writes the same layout from inside MesenCE.

export const WORK_RAM_SIZE = 0x800;
export const CART_RAM_START = 0x6000;
export const CART_RAM_SIZE = 0x2000;
export const MEMORY_SIZE = WORK_RAM_SIZE + CART_RAM_SIZE;
export const RECORD_SIZE = 4 + MEMORY_SIZE;

export interface MemoryRecord {
  frame: number;
  /** Work RAM then cartridge RAM, MEMORY_SIZE bytes. */
  memory: Uint8Array;
}

/** The CPU address of a byte at this offset into MemoryRecord.memory. */
export function addressOfOffset(offset: number): number {
  return offset < WORK_RAM_SIZE ? offset : CART_RAM_START + offset - WORK_RAM_SIZE;
}

export function encodeRecord(record: MemoryRecord): Uint8Array {
  if (record.memory.length !== MEMORY_SIZE) throw new Error(`A record holds ${MEMORY_SIZE} bytes of memory, got ${record.memory.length}.`);
  const bytes = new Uint8Array(RECORD_SIZE);
  new DataView(bytes.buffer).setInt32(0, record.frame, true);
  bytes.set(record.memory, 4);
  return bytes;
}

export function parseDump(bytes: Uint8Array): MemoryRecord[] {
  if (bytes.length % RECORD_SIZE !== 0) throw new Error(`A dump is a whole number of ${RECORD_SIZE}-byte records; this one has ${bytes.length} bytes.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records: MemoryRecord[] = [];
  for (let start = 0; start < bytes.length; start += RECORD_SIZE) {
    records.push({ frame: view.getInt32(start, true), memory: bytes.subarray(start + 4, start + RECORD_SIZE) });
  }
  return records;
}

export interface ByteDifference {
  address: number;
  /** The value in the first dump given to compareDumps, then the second. */
  left: number;
  right: number;
}

export interface DumpComparison {
  /** Frames present in both dumps that were compared, up to and including the first difference. */
  framesCompared: number;
  /** The last frame compared that matched, or null if none did. */
  lastEqualFrame: number | null;
  /** The first frame where the dumps differ, or null when every common frame matches. */
  firstDifferentFrame: number | null;
  differences: ByteDifference[];
  /** Addresses never compared because they are excluded (left as given). */
  ignored: number[];
}

/**
 * Compares records at the frames both dumps hold, in frame order, and stops
 * at the first that differs. `ignore` lists CPU addresses left out, such as
 * a byte known to hold each emulator's own power-on noise.
 */
export function compareDumps(left: MemoryRecord[], right: MemoryRecord[], ignore: readonly number[] = []): DumpComparison {
  const rightByFrame = new Map(right.map((record) => [record.frame, record]));
  const skipped = new Set(ignore);
  let framesCompared = 0;
  let lastEqualFrame: number | null = null;
  for (const record of [...left].sort((a, b) => a.frame - b.frame)) {
    const other = rightByFrame.get(record.frame);
    if (!other) continue;
    framesCompared++;
    const differences: ByteDifference[] = [];
    for (let offset = 0; offset < MEMORY_SIZE; offset++) {
      const address = addressOfOffset(offset);
      if (record.memory[offset] !== other.memory[offset] && !skipped.has(address)) {
        differences.push({ address, left: record.memory[offset], right: other.memory[offset] });
      }
    }
    if (differences.length) return { framesCompared, lastEqualFrame, firstDifferentFrame: record.frame, differences, ignored: [...ignore] };
    lastEqualFrame = record.frame;
  }
  return { framesCompared, lastEqualFrame, firstDifferentFrame: null, differences: [], ignored: [...ignore] };
}
