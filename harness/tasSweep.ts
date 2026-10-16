// npm run tas:sweep -- <rom> <in.fm2> [--leads -2,0,2] [--ram jsnes,zeros,fceux]
//                      [--seeds 0-255] [--until <frame>] [--every <frames>] [--from <frame>]
// Measures which start keeps a converted Final Fantasy TAS in step longest on
// jsnes. The baseline is lead 0, jsnes's own power-on RAM and battle RNG
// state 0 (cleared battery RAM). Every other start, from each combination of
// start offset (leadFrames), work-RAM fill and starting battle RNG state
// ($688A), is compared with it every --every frames from --from on what the
// game shows:
// map, scroll position, party HP, deaths and gold. A start with lead L is
// compared at its frame f + L against the baseline's frame f. Each try stops
// at its first difference; the TSV row says where that was.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fm2ToMovie, parseFm2 } from "../src/movie/fm2";
import { sha256Hex } from "../src/storage/gameStore";
import { WORK_RAM_FILLS, type WorkRamFill } from "./tasStart";
import { baselineSignatures, compare } from "./tasSweepCompare";

interface SweepArgs {
  rom: string;
  fm2: string;
  leads: number[];
  fills: WorkRamFill[];
  seeds: number[];
  until: number;
  every: number;
  /** First baseline frame compared; before the game has set up its RAM the state is power-on noise. */
  from: number;
}

const USAGE = "usage: npm run tas:sweep -- <rom> <in.fm2> [--leads -2,0,2] [--ram jsnes,zeros,fceux] [--seeds 0-255] [--until <frame>] [--every <frames>] [--from <frame>]";

function integer(option: string, text: string): number {
  const value = Number(text);
  if (!Number.isInteger(value)) throw new Error(`${option}: ${text} is not a whole number.`);
  return value;
}

/** "N", "N-M" or a comma list of either. */
function seedList(text: string): number[] {
  return text.split(",").flatMap((item) => {
    const match = /^(\d+)(?:-(\d+))?$/.exec(item);
    if (!match) throw new Error(`--seeds takes N, N-M or a comma list of them, got ${text}.`);
    const from = Number(match[1]);
    const to = Number(match[2] ?? match[1]);
    if (from > to || to > 255) throw new Error(`--seeds must lie in 0-255, got ${item}.`);
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
  });
}

function parseArgs(argv: string[]): SweepArgs {
  const positional: string[] = [];
  const args: Omit<SweepArgs, "rom" | "fm2"> = { leads: [0], fills: ["jsnes"], seeds: [0], until: 30000, every: 60, from: 600 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`${arg} needs a value.`);
    if (arg === "--leads") args.leads = value.split(",").map((item) => integer(arg, item));
    else if (arg === "--ram") {
      args.fills = value.split(",").map((item) => {
        if (!(WORK_RAM_FILLS as readonly string[]).includes(item)) throw new Error(`--ram takes ${WORK_RAM_FILLS.join(", ")}, got ${item}.`);
        return item as WorkRamFill;
      });
    } else if (arg === "--seeds") args.seeds = seedList(value);
    else if (arg === "--until") args.until = integer(arg, value);
    else if (arg === "--every") args.every = integer(arg, value);
    else if (arg === "--from") args.from = integer(arg, value);
    else throw new Error(`Unknown option ${arg}.`);
  }
  if (positional.length !== 2) throw new Error("Give a ROM and an .fm2 movie.");
  if (args.every < 1 || args.until < args.every) throw new Error("--every must be at least 1 and --until at least --every.");
  return { rom: positional[0], fm2: positional[1], ...args };
}

async function main(): Promise<number> {
  let args: SweepArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const rom = new Uint8Array(readFileSync(args.rom));
  const fm2 = parseFm2(readFileSync(args.fm2, "utf8"));
  const romInfo = { name: basename(args.rom), sha256: await sha256Hex(rom) };
  const baseline = baselineSignatures(rom, fm2ToMovie(fm2, { rom: romInfo }), { fill: "jsnes", battleRng: 0 }, args.until, args.every);
  console.log(`baseline: lead 0, ram jsnes, seed 0; ${baseline.size} samples to frame ${Math.max(...baseline.keys())}`);
  console.log("lead\tram\tseed\tinStepTo\tfirstDifference (baseline / this start)");
  for (const lead of args.leads) {
    const movie = fm2ToMovie(fm2, { rom: romInfo, leadFrames: lead });
    for (const fill of args.fills) {
      for (const seed of args.seeds) {
        const result = compare(rom, movie, { lead, fill, battleRng: seed }, baseline, args.from);
        console.log([lead, fill, seed, result.inStepTo, result.difference ?? "none"].join("\t"));
      }
    }
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  },
);
