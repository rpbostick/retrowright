// npm run hooks:cost -- <rom> <movie> [--until <frame>] [--reps <n>]
// Measures what the debug hooks cost on the movie's busiest frame: the frame
// (up to --until) with the most data reads and writes, so the measure is not
// taken on a game idling in a wait loop. That frame is run --reps times from
// a save state with each hook setup, timing frame() alone, and the medians
// are printed beside the plain core's.

import { readFileSync } from "node:fs";
import { JsnesCore } from "../src/core/jsnesCore";
import type { CoreCallbacks, DebugHooks } from "../src/core/types";
import { parseMovie, type Movie } from "../src/movie/format";
import { applyPad } from "../src/movie/pads";
import { bootMovie, MovieRunner, requireMovieRom } from "../src/movie/runner";
import { sha256Hex } from "../src/storage/gameStore";

const USAGE = "usage: npm run hooks:cost -- <rom> <movie> [--until <frame>] [--reps <n>]";
const SILENT: CoreCallbacks = { onFrame: () => {}, onAudioSample: () => {}, onBatteryRamWrite: () => {} };

interface CliArgs {
  rom: string;
  movie: string;
  until: number | undefined;
  reps: number;
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let until: number | undefined;
  let reps = 200;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--until" || arg === "--reps") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) throw new Error(`${arg} needs a positive whole number.`);
      if (arg === "--until") until = value;
      else reps = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) throw new Error("Give a ROM and a movie.");
  return { rom: positional[0], movie: positional[1], until, reps };
}

/** The frame with the most data accesses, among frames without a reset. */
function busiestFrame(rom: Uint8Array, movie: Movie, lastFrame: number): { frame: number; accesses: number; median: number } {
  let accesses = 0;
  const core = new JsnesCore(SILENT);
  core.setDebugHooks({
    onAccess: () => {
      accesses++;
    },
  });
  bootMovie(core, rom, movie.start);
  const runner = new MovieRunner(core, movie);
  const resets = new Set(movie.events.map((event) => event.frame));
  const counts: number[] = [];
  let best = { frame: -1, accesses: -1 };
  while (runner.frame < lastFrame) {
    const frame = runner.frame;
    accesses = 0;
    runner.step();
    counts.push(accesses);
    if (!resets.has(frame) && accesses > best.accesses) best = { frame, accesses };
  }
  if (best.frame < 0) throw new Error("No frame to measure.");
  return { ...best, median: median(counts) };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const rom = new Uint8Array(readFileSync(args.rom));
  const movie = parseMovie(JSON.parse(readFileSync(args.movie, "utf8")));
  requireMovieRom(movie, await sha256Hex(rom));
  const lastFrame = Math.min(args.until ?? movie.frames, movie.frames);
  const busiest = busiestFrame(rom, movie, lastFrame);

  // Run up to the busiest frame on a plain core, then keep the state before it and that frame's pads.
  const core = new JsnesCore(SILENT);
  bootMovie(core, rom, movie.start);
  const runner = new MovieRunner(core, movie);
  while (runner.frame < busiest.frame) runner.step();
  const before = core.saveState();
  runner.step();
  const { pad1, pad2 } = runner;

  let calls = 0;
  const count = () => {
    calls++;
  };
  const setups: [string, DebugHooks | null][] = [
    ["plain (no hooks)", null],
    ["execute hook", { onInstruction: count }],
    ["access hook, every address", { onAccess: count }],
    ["access hook, one RAM byte", { onAccess: count, accessRanges: [[0x0057, 0x0057]] }],
    ["execute and access hooks, every address", { onInstruction: count, onAccess: count }],
  ];
  console.log(`Movie: ${args.movie}`);
  console.log(`Busiest frame up to ${lastFrame}: ${busiest.frame}, ${busiest.accesses} data accesses (median frame: ${busiest.median})`);
  console.log(`Each setup runs that frame ${args.reps} times; median time of frame():`);
  let plainMs = 0;
  for (const [name, hooks] of setups) {
    core.setDebugHooks(hooks);
    const times: number[] = [];
    for (let rep = 0; rep < args.reps; rep++) {
      core.loadState(before);
      applyPad(core, 1, pad1);
      applyPad(core, 2, pad2);
      const started = performance.now();
      core.frame();
      times.push(performance.now() - started);
    }
    const ms = median(times);
    if (hooks === null) plainMs = ms;
    console.log(`  ${name.padEnd(42)} ${ms.toFixed(3)} ms  ${(ms / plainMs).toFixed(2)}x plain`);
  }
  core.setDebugHooks(null);
  console.log(`Hook calls made: ${calls}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  },
);
