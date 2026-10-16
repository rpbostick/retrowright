import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CoreCallbacks, EmulatorCore } from "../src/core/types";
import type { GameMemoryMap } from "../src/games/gameMap";
import type { Movie } from "../src/movie/format";
import { dumpCore } from "./jsnesDump";
import { compareDumps, type DumpComparison } from "./memoryDump";
import { runMesen } from "./mesen";
import { encodeFramePng } from "./png";
import { compareStates, describeStateDifference, type StateComparison } from "./stateDiff";

// Runs one movie on an EmulatorCore (jsnes) and in MesenCE, dumps the same
// memory after the same frame counts, and finds the first frame where they
// differ. MesenCE starts from the core's own power-on memory, so a
// difference comes from running, not from each emulator's RAM fill.

export interface DiffOptions {
  /** Path of the ROM file, for MesenCE. */
  romPath: string;
  rom: Uint8Array;
  movie: Movie;
  createCore(callbacks: CoreCallbacks): EmulatorCore;
  /** MesenCE's frame N runs the movie's frame N - lead. */
  lead: number;
  every: number;
  /** First frame count compared; defaults to `every`, or the first multiple of it MesenCE reaches. */
  from?: number;
  /** Last frame run; defaults to the movie's end. */
  until?: number;
  /** CPU addresses left out of the comparison. */
  ignore?: readonly number[];
  /** Writes a PNG from each emulator at the first frame where memory differs here. */
  screenshots?: string;
  /** Also compares the game's state through this map, frame by frame. */
  gameMap?: GameMemoryMap | null;
  mesenPath?: string;
}

export interface DiffResult {
  lead: number;
  every: number;
  from: number;
  until: number;
  comparison: DumpComparison;
  /** The game-state comparison, when a memory map was given. */
  state: StateComparison | null;
  jsnesSeconds: number;
  mesenSeconds: number;
  /** At the first frame where memory differs and the first where the game's state does. */
  screenshots: { frame: number; jsnes: string; mesen: string }[];
}

function silentCallbacks(onFrame: (pixels: Uint32Array) => void = () => {}): CoreCallbacks {
  return { onFrame, onAudioSample() {}, onBatteryRamWrite() {} };
}

export function runDiff(options: DiffOptions): DiffResult {
  const { movie, lead, every } = options;
  const until = Math.min(options.until ?? movie.frames, movie.frames);
  // A negative lead drops the movie's first frames from MesenCE's run, so
  // the first comparable frame count moves on by whole steps.
  let from = options.from ?? every;
  while (from + lead < 1) from += every;
  let started = performance.now();
  const jsnes = dumpCore({ core: options.createCore(silentCallbacks()), rom: options.rom, movie, frames: until, every, from });
  const jsnesSeconds = (performance.now() - started) / 1000;
  started = performance.now();
  const mesen = runMesen({ rom: options.romPath, movie, lead, frames: until, every, from, initialMemory: jsnes.initialMemory, mesenPath: options.mesenPath });
  const mesenSeconds = (performance.now() - started) / 1000;
  const comparison = compareDumps(jsnes.records, mesen.records, options.ignore);
  const state = options.gameMap ? compareStates(jsnes.records, mesen.records, options.gameMap) : null;
  const shotFrames = [...new Set([comparison.firstDifferentFrame, state?.firstDifferentFrame ?? null])].filter((frame): frame is number => frame !== null);
  const directory = options.screenshots;
  const screenshots = directory ? shotFrames.map((frame) => saveScreenshots(options, frame, jsnes.initialMemory, directory)) : [];
  return { lead, every, from, until, comparison, state, jsnesSeconds, mesenSeconds, screenshots };
}

/** Runs both emulators again to `frame` and saves each one's picture after it. */
function saveScreenshots(options: DiffOptions, frame: number, initialMemory: Uint8Array, directory: string): { frame: number; jsnes: string; mesen: string } {
  mkdirSync(directory, { recursive: true });
  const name = String(frame).padStart(6, "0");
  const jsnesShot = join(directory, `${name}-jsnes.png`);
  const mesenShot = join(directory, `${name}-mesen.png`);
  let pixels: Uint32Array | null = null;
  dumpCore({ core: options.createCore(silentCallbacks((shown) => (pixels = shown))), rom: options.rom, movie: options.movie, frames: frame, every: frame, from: frame });
  if (!pixels) throw new Error(`jsnes showed no picture by frame ${frame}.`);
  writeFileSync(jsnesShot, encodeFramePng(pixels));
  runMesen({ rom: options.romPath, movie: options.movie, lead: options.lead, frames: frame, every: 1, from: frame, initialMemory, screenshotAt: frame, screenshot: mesenShot, mesenPath: options.mesenPath });
  return { frame, jsnes: jsnesShot, mesen: mesenShot };
}

function hex(value: number, digits: number): string {
  return `$${value.toString(16).toUpperCase().padStart(digits, "0")}`;
}

/** The report the CLI prints: where the runs part and, address by address, what differs. */
export function formatDiff(result: DiffResult, gameMap: GameMemoryMap | null, maxAddresses = 64): string {
  const { comparison } = result;
  const lines = [
    `Lead ${result.lead}: compared ${comparison.framesCompared} frames (every ${result.every} from ${result.from}, up to ${result.until}); jsnes ${result.jsnesSeconds.toFixed(1)} s, MesenCE ${result.mesenSeconds.toFixed(1)} s`,
  ];
  if (comparison.ignored.length) lines.push(`Ignored: ${comparison.ignored.map((address) => hex(address, 4)).join(", ")}`);
  lines.push(`Memory: last equal frame ${comparison.lastEqualFrame ?? "none"}`);
  if (comparison.firstDifferentFrame === null) lines.push("Memory: no difference in the frames compared.");
  else {
    lines.push(`Memory: first difference at frame ${comparison.firstDifferentFrame}, ${comparison.differences.length} bytes differ`);
    for (const difference of comparison.differences.slice(0, maxAddresses)) {
      const name = gameMap?.nameAddress(difference.address);
      lines.push(`  ${hex(difference.address, 4)}  jsnes ${hex(difference.left, 2)}  MesenCE ${hex(difference.right, 2)}${name ? `  ${name}` : ""}`);
    }
    if (comparison.differences.length > maxAddresses) lines.push(`  … and ${comparison.differences.length - maxAddresses} more`);
  }
  const { state } = result;
  if (state && gameMap) {
    if (state.firstDifferentFrame === null) lines.push(`Game state (${gameMap.title}): the same at all ${state.framesCompared} frames compared, last ${state.lastEqualFrame ?? "none"}`);
    else {
      lines.push(`Game state (${gameMap.title}): last equal frame ${state.lastEqualFrame ?? "none"}, first difference at frame ${state.firstDifferentFrame} (jsnes -> MesenCE)`);
      for (const line of describeStateDifference(state.left!, state.right!)) lines.push(`  ${line}`);
    }
  }
  for (const shot of result.screenshots) lines.push(`Screenshots at frame ${shot.frame}: ${shot.jsnes}, ${shot.mesen}`);
  return lines.join("\n");
}
