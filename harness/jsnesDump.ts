import type { EmulatorCore } from "../src/core/types";
import type { Movie } from "../src/movie/format";
import { bootMovie, MovieRunner } from "../src/movie/runner";
import { CART_RAM_SIZE, CART_RAM_START, MEMORY_SIZE, WORK_RAM_SIZE, type MemoryRecord } from "./memoryDump";

// The jsnes side of the comparison with MesenCE: replays a movie through an
// EmulatorCore and keeps the same memory records tools/mesen/replay.lua
// writes, after the same frame counts.

export function readMemory(core: EmulatorCore, hasCartRam: boolean): Uint8Array {
  const memory = new Uint8Array(MEMORY_SIZE);
  for (let address = 0; address < WORK_RAM_SIZE; address++) memory[address] = core.peek(address);
  if (hasCartRam) for (let offset = 0; offset < CART_RAM_SIZE; offset++) memory[WORK_RAM_SIZE + offset] = core.peek(CART_RAM_START + offset);
  return memory;
}

export interface CoreDumpOptions {
  core: EmulatorCore;
  rom: Uint8Array;
  movie: Movie;
  /** Movie frames to run. */
  frames: number;
  every: number;
  /** First frame count to dump at. */
  from: number;
}

export interface CoreDump {
  /** Memory before the first frame: what MesenCE is started from. */
  initialMemory: Uint8Array;
  records: MemoryRecord[];
}

/**
 * Cartridge RAM is dumped only for a cartridge with battery RAM, zeros
 * otherwise: jsnes keeps $6000-$7FFF in its CPU memory array whether the
 * cartridge has RAM there or not, and EmulatorCore reports only battery RAM.
 */
export function dumpCore(options: CoreDumpOptions): CoreDump {
  const { core, movie, every, from } = options;
  if (movie.frames < options.frames) throw new Error(`The movie has ${movie.frames} frames; ${options.frames} were asked for.`);
  bootMovie(core, options.rom, movie.start);
  const hasCartRam = core.batteryRam() !== null;
  const initialMemory = readMemory(core, hasCartRam);
  const runner = new MovieRunner(core, movie);
  const records: MemoryRecord[] = [];
  while (runner.frame < options.frames) {
    runner.step();
    if (runner.frame >= from && (runner.frame - from) % every === 0) records.push({ frame: runner.frame, memory: readMemory(core, hasCartRam) });
  }
  return { initialMemory, records };
}
