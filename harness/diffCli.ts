// npm run diff -- <rom> <movie> [--every N] [--from F] [--until F] [--lead L | --leads L1,L2,...]
//                 [--ignore $ADDR,...] [--out <dir>]
// Replays a movie on jsnes and in MesenCE and prints the first frame where
// work RAM or cartridge RAM differ, with each differing address, named
// through the game's memory map where it covers it, and, for a game with a
// memory map, the first frame where the game's state read through it differs.
// With --lead, it saves a screenshot from each emulator at those frames under
// --out. --leads compares several start offsets and prints one line each, to
// measure the offset.
// Exits 1 when the runs differ, 2 on bad arguments or files.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { JsnesCore } from "../src/core/jsnesCore";
import { findGameMap } from "../src/games";
import { parseMovie } from "../src/movie/format";
import { requireMovieRom } from "../src/movie/runner";
import { sha256Hex } from "../src/storage/gameStore";
import { formatDiff, runDiff } from "./diff";
import { mesenInstalled, MESEN_PATH } from "./mesen";

interface DiffArgs {
  rom: string;
  movie: string;
  every: number;
  from: number | undefined;
  until: number | undefined;
  leads: number[];
  sweep: boolean;
  ignore: number[];
  out: string;
}

const USAGE = "usage: npm run diff -- <rom> <movie> [--every N] [--from F] [--until F] [--lead L | --leads L1,L2,...] [--ignore $ADDR,...] [--out <dir>]";

function wholeNumber(option: string, value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${option} needs a whole number above 0, got ${value}.`);
  return number;
}

function lead(option: string, value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`${option} needs whole numbers, got ${value}.`);
  return number;
}

function address(value: string): number {
  const number = Number.parseInt(value.replace(/^\$/, ""), 16);
  if (!/^\$?[0-9a-fA-F]{1,4}$/.test(value) || number > 0xffff) throw new Error(`--ignore needs hex addresses such as $0048, got ${value}.`);
  return number;
}

function parseArgs(argv: string[]): DiffArgs {
  const positional: string[] = [];
  const args: Omit<DiffArgs, "rom" | "movie"> = { every: 1, from: undefined, until: undefined, leads: [0], sweep: false, ignore: [], out: ".out/diff" };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`${arg} needs a value.`);
    if (arg === "--every") args.every = wholeNumber(arg, value);
    else if (arg === "--from") args.from = wholeNumber(arg, value);
    else if (arg === "--until") args.until = wholeNumber(arg, value);
    else if (arg === "--lead") args.leads = [lead(arg, value)];
    else if (arg === "--leads") {
      args.leads = value.split(",").map((part) => lead(arg, part));
      args.sweep = true;
    } else if (arg === "--ignore") args.ignore = value.split(",").map(address);
    else if (arg === "--out") args.out = value;
    else throw new Error(`Unknown option ${arg}.`);
  }
  if (positional.length !== 2) throw new Error("Give a ROM and a movie.");
  return { rom: positional[0], movie: positional[1], ...args };
}

async function main(): Promise<number> {
  let args: DiffArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  if (!mesenInstalled()) {
    console.error(`MesenCE is not installed at ${MESEN_PATH} (RETROWRIGHT_MESEN names another path).`);
    return 2;
  }
  const rom = new Uint8Array(readFileSync(args.rom));
  const movie = parseMovie(JSON.parse(readFileSync(args.movie, "utf8")));
  requireMovieRom(movie, await sha256Hex(rom));
  const gameMap = await findGameMap(rom);
  mkdirSync(args.out, { recursive: true });
  console.log(`Movie: ${args.movie} (${movie.frames} frames)`);
  console.log(`Memory map: ${gameMap ? gameMap.title : "none for this ROM"}`);
  let differs = false;
  for (const leadFrames of args.leads) {
    const result = runDiff({
      romPath: args.rom,
      rom,
      movie,
      createCore: (callbacks) => new JsnesCore(callbacks),
      lead: leadFrames,
      every: args.every,
      from: args.from,
      until: args.until,
      ignore: args.ignore,
      screenshots: args.sweep ? undefined : args.out,
      gameMap,
    });
    differs ||= result.comparison.firstDifferentFrame !== null;
    if (args.sweep) {
      const { comparison, state } = result;
      const memory = comparison.firstDifferentFrame === null ? `memory the same to frame ${result.until}` : `memory differs at frame ${comparison.firstDifferentFrame} (${comparison.differences.length} bytes), last equal ${comparison.lastEqualFrame ?? "none"}`;
      const game = !state ? "" : state.firstDifferentFrame === null ? `; game state the same to frame ${result.until}` : `; game state differs at frame ${state.firstDifferentFrame}`;
      console.log(`lead ${leadFrames}: ${memory}${game}`);
      continue;
    }
    const report = formatDiff(result, gameMap);
    console.log(report);
    writeFileSync(join(args.out, "report.txt"), `${report}\n`);
  }
  return differs ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  },
);
