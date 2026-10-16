import type { GameMemoryMap } from "../src/games/gameMap";
import type { ViewValue } from "../src/movie/expectations";
import { CART_RAM_SIZE, CART_RAM_START, WORK_RAM_SIZE, type MemoryRecord } from "./memoryDump";

// Compares two dumps through a game's memory map instead of byte by byte:
// two runs can differ in a timer or a busy-wait counter and still play the
// same game, and what a TAS needs is the same game. The first frame where the
// game's state differs is where one of the runs has left the other's route.

/** peek over a dumped record: work RAM (mirrored to $1FFF) and cartridge RAM only. */
export function peekRecord(record: MemoryRecord): (address: number) => number {
  return (address) => {
    if (address >= 0 && address < 0x2000) return record.memory[address % WORK_RAM_SIZE];
    if (address >= CART_RAM_START && address < CART_RAM_START + CART_RAM_SIZE) return record.memory[WORK_RAM_SIZE + address - CART_RAM_START];
    throw new RangeError(`$${address.toString(16).toUpperCase()} is not in a memory dump (work RAM and $6000-$7FFF only).`);
  };
}

export interface StateComparison {
  framesCompared: number;
  lastEqualFrame: number | null;
  firstDifferentFrame: number | null;
  /** The game's state on each side at the first differing frame. */
  left: ViewValue | null;
  right: ViewValue | null;
}

/** "party[0].hp: 35 -> 30" lines for the paths whose values differ. */
export function describeStateDifference(left: ViewValue, right: ViewValue): string[] {
  const flat = (value: ViewValue, path: string, into: Map<string, string>): Map<string, string> => {
    if (Array.isArray(value)) value.forEach((item, index) => flat(item, `${path}[${index}]`, into));
    else if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) flat(item, path ? `${path}.${key}` : key, into);
    else into.set(path, JSON.stringify(value));
    return into;
  };
  const leftPaths = flat(left, "", new Map());
  const rightPaths = flat(right, "", new Map());
  const paths = [...new Set([...leftPaths.keys(), ...rightPaths.keys()])];
  return paths.filter((path) => leftPaths.get(path) !== rightPaths.get(path)).map((path) => `${path}: ${leftPaths.get(path) ?? "(none)"} -> ${rightPaths.get(path) ?? "(none)"}`);
}

export function compareStates(left: MemoryRecord[], right: MemoryRecord[], gameMap: GameMemoryMap): StateComparison {
  const rightByFrame = new Map(right.map((record) => [record.frame, record]));
  let framesCompared = 0;
  let lastEqualFrame: number | null = null;
  for (const record of [...left].sort((a, b) => a.frame - b.frame)) {
    const other = rightByFrame.get(record.frame);
    if (!other) continue;
    framesCompared++;
    const leftView = gameMap.read(peekRecord(record));
    const rightView = gameMap.read(peekRecord(other));
    if (JSON.stringify(leftView) !== JSON.stringify(rightView)) return { framesCompared, lastEqualFrame, firstDifferentFrame: record.frame, left: leftView, right: rightView };
    lastEqualFrame = record.frame;
  }
  return { framesCompared, lastEqualFrame, firstDifferentFrame: null, left: null, right: null };
}
