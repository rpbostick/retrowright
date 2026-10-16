import { describe, expect, it } from "vitest";
import { finalFantasy } from "../src/games/ff1/memoryMap";
import { addressOfOffset, compareDumps, encodeRecord, MEMORY_SIZE, parseDump, RECORD_SIZE, WORK_RAM_SIZE, type MemoryRecord } from "./memoryDump";
import { compareStates, describeStateDifference, peekRecord } from "./stateDiff";

/** A record whose memory is all zero except the given CPU addresses. */
function record(frame: number, bytes: Record<number, number> = {}): MemoryRecord {
  const memory = new Uint8Array(MEMORY_SIZE);
  for (const [address, value] of Object.entries(bytes)) {
    const cpu = Number(address);
    memory[cpu < 0x2000 ? cpu : WORK_RAM_SIZE + cpu - 0x6000] = value;
  }
  return { frame, memory };
}

function concat(records: MemoryRecord[]): Uint8Array {
  const bytes = new Uint8Array(records.length * RECORD_SIZE);
  records.forEach((entry, index) => bytes.set(encodeRecord(entry), index * RECORD_SIZE));
  return bytes;
}

describe("memory dumps", () => {
  it("round-trip records in the layout tools/mesen/replay.lua writes", () => {
    const records = [record(1, { 0x0010: 7, 0x6000: 1 }), record(-2, { 0x07ff: 9, 0x7fff: 3 })];
    const bytes = concat(records);
    // Frame count first, little-endian, then work RAM, then cartridge RAM.
    expect(Array.from(bytes.subarray(0, 4))).toEqual([1, 0, 0, 0]);
    expect(bytes[4 + 0x10]).toBe(7);
    expect(bytes[4 + WORK_RAM_SIZE]).toBe(1);
    const parsed = parseDump(bytes);
    expect(parsed.map((entry) => entry.frame)).toEqual([1, -2]);
    expect(parsed[1].memory).toEqual(records[1].memory);
  });

  it("refuses a dump cut off mid-record", () => {
    expect(() => parseDump(new Uint8Array(RECORD_SIZE + 3))).toThrow(`whole number of ${RECORD_SIZE}-byte records`);
  });

  it("maps offsets to CPU addresses", () => {
    expect(addressOfOffset(0x7ff)).toBe(0x07ff);
    expect(addressOfOffset(WORK_RAM_SIZE)).toBe(0x6000);
    expect(addressOfOffset(MEMORY_SIZE - 1)).toBe(0x7fff);
  });
});

describe("compareDumps", () => {
  it("finds the first differing frame and every differing address with both values", () => {
    const left = [record(1), record(2, { 0x48: 8 }), record(3, { 0x48: 8, 0x601c: 0x90, 0x10: 1 })];
    const right = [record(1), record(2, { 0x48: 8 }), record(3, { 0x48: 8, 0x601c: 0x91 })];
    const comparison = compareDumps(left, right);
    expect(comparison).toMatchObject({ framesCompared: 3, lastEqualFrame: 2, firstDifferentFrame: 3 });
    expect(comparison.differences).toEqual([
      { address: 0x0010, left: 1, right: 0 },
      { address: 0x601c, left: 0x90, right: 0x91 },
    ]);
  });

  it("compares only frames both dumps hold, in frame order", () => {
    const left = [record(60, { 0x20: 1 }), record(30)];
    const right = [record(30), record(45, { 0x20: 5 }), record(60, { 0x20: 2 })];
    expect(compareDumps(left, right)).toMatchObject({ framesCompared: 2, lastEqualFrame: 30, firstDifferentFrame: 60 });
  });

  it("leaves out ignored addresses and reports no difference when the rest match", () => {
    const comparison = compareDumps([record(1, { 0x13: 4 })], [record(1, { 0x13: 5 })], [0x13]);
    expect(comparison).toMatchObject({ firstDifferentFrame: null, lastEqualFrame: 1, differences: [], ignored: [0x13] });
  });
});

describe("game-state comparison", () => {
  it("peeks work RAM with its mirrors and cartridge RAM, and refuses the rest", () => {
    const peek = peekRecord(record(1, { 0x0048: 8, 0x601c: 0x90 }));
    expect(peek(0x0848)).toBe(8);
    expect(peek(0x601c)).toBe(0x90);
    expect(() => peek(0x8000)).toThrow("not in a memory dump");
  });

  it("ignores bytes the memory map does not read and names the field that differs", () => {
    const left = [record(60, { 0x0300: 1 }), record(120, { 0x610a: 35 })];
    const right = [record(60, { 0x0300: 2 }), record(120, { 0x610a: 30 })];
    const state = compareStates(left, right, finalFantasy);
    expect(state).toMatchObject({ framesCompared: 2, lastEqualFrame: 60, firstDifferentFrame: 120 });
    expect(describeStateDifference(state.left!, state.right!)).toEqual(["party[0].hp: 35 -> 30"]);
  });
});
