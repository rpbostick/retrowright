import { resolve } from "node:path";
import { WORK_RAM_FILLS, type WorkRamFill } from "./tasStart";

// The options of npm run tas:trace (harness/tasTrace.ts).

export interface TraceArgs {
  rom: string;
  movie: string;
  out: string;
  every: number;
  until: number | undefined;
  ram: WorkRamFill;
  battleRng: number;
  /** Frames run with nothing pressed after the movie ends, to see what its last input leads to. */
  after: number;
  shots: boolean;
  /** Also a PNG every this many frames from shotsFrom on; 0 for none. */
  shotEvery: number;
  shotsFrom: number;
}

export const TRACE_USAGE =
  "usage: npm run tas:trace -- <rom> <movie> [--out <dir>] [--every <frames>] [--until <frame>] [--ram jsnes|zeros|fceux] [--battle-rng <0-255>] [--after <frames>] [--shots] [--shot-every <frames> [--shots-from <frame>]]";

/** Where the trace goes without --out: tas-trace in the folder the command runs in. */
export function defaultTraceFolder(workingFolder: string): string {
  return resolve(workingFolder, "tas-trace");
}

function wholeNumber(option: string, value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${option} needs a whole number above 0, got ${value}.`);
  return number;
}

function workRamFill(option: string, value: string): WorkRamFill {
  if (!(WORK_RAM_FILLS as readonly string[]).includes(value)) throw new Error(`${option} must be one of ${WORK_RAM_FILLS.join(", ")}, got ${value}.`);
  return value as WorkRamFill;
}

function byteValue(option: string, value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 0xff) throw new Error(`${option} needs a byte, 0-255, got ${value}.`);
  return number;
}

export function parseTraceArgs(argv: string[], workingFolder: string): TraceArgs {
  const positional: string[] = [];
  const args: Omit<TraceArgs, "rom" | "movie"> = { out: defaultTraceFolder(workingFolder), every: 60, until: undefined, ram: "jsnes", battleRng: 0, after: 0, shots: false, shotEvery: 0, shotsFrom: 0 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--shots") {
      args.shots = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`${arg} needs a value.`);
    if (arg === "--out") args.out = value;
    else if (arg === "--every") args.every = wholeNumber(arg, value);
    else if (arg === "--until") args.until = wholeNumber(arg, value);
    else if (arg === "--after") args.after = wholeNumber(arg, value);
    else if (arg === "--shot-every") args.shotEvery = wholeNumber(arg, value);
    else if (arg === "--shots-from") args.shotsFrom = wholeNumber(arg, value);
    else if (arg === "--ram") args.ram = workRamFill(arg, value);
    else if (arg === "--battle-rng") args.battleRng = byteValue(arg, value);
    else throw new Error(`Unknown option ${arg}.`);
  }
  if (positional.length !== 2) throw new Error("Give a ROM and a movie.");
  return { rom: positional[0], movie: positional[1], ...args };
}
