import type { EmulatorCore } from "../src/core/types";
import { readFinalFantasy } from "../src/games/ff1/memoryMap";
import type { Movie } from "../src/movie/format";
import { bootAt, type TasStart } from "./tasStart";

// What npm run tas:sweep compares: a start's run against the baseline's, on
// what the game shows.

export interface SweepStart extends TasStart {
  /** The movie's leadFrames; the start's frame f + lead is compared with the baseline's frame f. */
  lead: number;
}

/** What the game shows that a desync changes: place, scroll, party HP and deaths, gold. */
export function signature(core: EmulatorCore): string {
  const view = readFinalFantasy((address) => core.peek(address));
  const party = view.party.map((member) => `${member.hp}${member.status.includes("dead") ? "x" : ""}`).join("/");
  return `${view.map} ${view.scrollX},${view.scrollY} hp ${party} gold ${view.gold}`;
}

/** The baseline's signature every `every` frames up to `until`, by frame. */
export function baselineSignatures(rom: Uint8Array, movie: Movie, start: TasStart, until: number, every: number): Map<number, string> {
  const { core, runner } = bootAt(rom, movie, start);
  const signatures = new Map<number, string>();
  while (runner.frame < Math.min(until, movie.frames)) {
    runner.step();
    if (runner.frame % every === 0) signatures.set(runner.frame, signature(core));
  }
  return signatures;
}

export interface Comparison {
  /** The last baseline frame compared equal, or 0. */
  inStepTo: number;
  /** The first difference as "baseline / this start", or null when none up to --until. */
  difference: string | null;
}

/** Runs `movie` from `start` and compares it with the baseline from baseline frame `from` on, stopping at the first difference. */
export function compare(rom: Uint8Array, movie: Movie, start: SweepStart, baseline: Map<number, string>, from: number): Comparison {
  const { core, runner } = bootAt(rom, movie, start);
  let inStepTo = 0;
  for (const [frame, expected] of baseline) {
    const target = frame + start.lead;
    if (frame < from || target < 1) continue;
    while (runner.frame < target) runner.step();
    const actual = signature(core);
    if (actual !== expected) return { inStepTo, difference: `frame ${frame}: ${expected} / ${actual}` };
    inStepTo = frame;
  }
  return { inStepTo, difference: null };
}
