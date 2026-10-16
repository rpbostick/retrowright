// npm run tas:trace -- <rom> <movie> [--out <dir>] [--every <frames>] [--until <frame>]
//                      [--ram jsnes|zeros|fceux] [--battle-rng <0-255>] [--after <frames>] [--shots]
//                      [--shot-every <frames> [--shots-from <frame>]]
// Replays a converted TAS on jsnes and writes what the game was doing: a row
// of Final Fantasy state every --every frames (trace.tsv), every change of
// map, battle or party HP (events.tsv), and with --shots a PNG at each map
// and battle change. It checks nothing itself; a TAS has no checkpoints, so
// where the run leaves the route is read from these files. They go to --out,
// by default tas-trace in the folder the command runs in.
//
// --ram fills work RAM ($0000-$07FF) before the first frame: "jsnes" keeps
// jsnes's own power-on contents, "zeros" clears it, "fceux" writes FCEUX's
// power-on pattern (four $00, four $FF, repeated). --battle-rng sets the
// battle RNG state ($688A, in the otherwise cleared battery RAM) at power-on.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EmulatorCore } from "../src/core/types";
import { BATTLE_RNG_STATE, readFinalFantasy } from "../src/games/ff1/memoryMap";
import { findGameMap } from "../src/games";
import { parseMovie } from "../src/movie/format";
import { applyPad } from "../src/movie/pads";
import { requireMovieRom } from "../src/movie/runner";
import { screenHash } from "../src/movie/screenHash";
import { sha256Hex } from "../src/storage/gameStore";
import { encodeFramePng } from "./png";
import { bootAt } from "./tasStart";
import { parseTraceArgs, TRACE_USAGE, type TraceArgs } from "./tasTraceArgs";

interface Sample {
  frame: number;
  place: string;
  x: number;
  y: number;
  battleByte: number;
  battleRng: number;
  hp: number[];
  gold: number;
  dead: number;
  screen: string;
}

function sample(core: EmulatorCore, frame: number, pixels: Uint32Array | null): Sample {
  const peek = (address: number) => core.peek(address);
  const view = readFinalFantasy(peek);
  return {
    frame,
    place: view.map,
    x: view.scrollX,
    y: view.scrollY,
    battleByte: peek(0x81),
    battleRng: peek(BATTLE_RNG_STATE),
    hp: view.party.map((member) => member.hp),
    gold: view.gold,
    dead: view.party.filter((member) => member.status.includes("dead")).length,
    screen: pixels ? screenHash(pixels) : "",
  };
}

function row(entry: Sample): string {
  return [entry.frame, entry.place, entry.x, entry.y, `$${entry.battleByte.toString(16).padStart(2, "0")}`, entry.battleRng, entry.hp.join("/"), entry.gold, entry.dead, entry.screen].join("\t");
}

const HEADER = "frame\tplace\tx\ty\t$81\tbattleRng\thp\tgold\tdead\tscreen";

async function main(): Promise<number> {
  let args: TraceArgs;
  try {
    args = parseTraceArgs(process.argv.slice(2), process.cwd());
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${TRACE_USAGE}`);
    return 2;
  }
  const rom = new Uint8Array(readFileSync(args.rom));
  if ((await findGameMap(rom))?.id !== "ff1") throw new Error(`${args.rom} is not the Final Fantasy (USA) ROM the memory map knows.`);
  const movie = parseMovie(JSON.parse(readFileSync(args.movie, "utf8")));
  requireMovieRom(movie, await sha256Hex(rom));
  mkdirSync(args.out, { recursive: true });

  let pixels: Uint32Array | null = null;
  const { core, runner } = bootAt(rom, movie, { fill: args.ram, battleRng: args.battleRng }, (frame) => (pixels = frame));
  const lastFrame = Math.min(args.until ?? movie.frames, movie.frames);
  const trace = [HEADER];
  const events = [`${HEADER}\tchange`];
  let previous: Sample | null = null;
  const totalFrames = lastFrame + (lastFrame === movie.frames ? args.after : 0);
  for (let frame = 1; frame <= totalFrames; frame++) {
    if (frame <= lastFrame) runner.step();
    else {
      applyPad(core, 1, 0);
      applyPad(core, 2, 0);
      core.frame();
    }
    const current = sample(core, frame, null);
    const changes: string[] = [];
    if (previous) {
      if (current.place !== previous.place) changes.push(`place ${previous.place} -> ${current.place}`);
      if (current.battleByte !== previous.battleByte) changes.push(`$81 ${previous.battleByte} -> ${current.battleByte}`);
      if (current.hp.join() !== previous.hp.join()) changes.push("hp");
      if (current.dead !== previous.dead) changes.push(`dead ${previous.dead} -> ${current.dead}`);
    }
    if (changes.length || frame % args.every === 0) {
      const shown = { ...current, screen: pixels ? screenHash(pixels) : "" };
      if (frame % args.every === 0) trace.push(row(shown));
      if (changes.length) {
        events.push(`${row(shown)}\t${changes.join("; ")}`);
        const visible = changes.some((change) => !change.startsWith("hp"));
        if (args.shots && visible && pixels) writeFileSync(join(args.out, `${String(frame).padStart(6, "0")}.png`), encodeFramePng(pixels));
      }
    }
    if (args.shotEvery && frame >= args.shotsFrom && frame % args.shotEvery === 0 && pixels) {
      writeFileSync(join(args.out, `${String(frame).padStart(6, "0")}.png`), encodeFramePng(pixels));
    }
    previous = current;
  }
  writeFileSync(join(args.out, "trace.tsv"), `${trace.join("\n")}\n`);
  writeFileSync(join(args.out, "events.tsv"), `${events.join("\n")}\n`);
  const extra = totalFrames - lastFrame;
  console.log(`Ran ${runner.frame} of ${movie.frames} frames${extra ? ` and ${extra} more with no input` : ""} (ram ${args.ram}, battle RNG ${args.battleRng}); ${events.length - 1} changes; wrote ${args.out}/trace.tsv and events.tsv.`);
  if (previous) console.log(`Last: ${row(previous)}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  },
);
