// npm run replay -- <rom> <movie> [--screenshots <dir>] [--until <frame>]
// Replays a movie headless and prints frames, speed and each checkpoint.
// Exits 1 when a checkpoint fails, 2 on bad arguments or files.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JsnesCore } from "../src/core/jsnesCore";
import { findGameMap } from "../src/games";
import { parseMovie } from "../src/movie/format";
import { encodeFramePng } from "./png";
import { formatReport, replay } from "./replay";

interface CliArgs {
  rom: string;
  movie: string;
  screenshots: string | null;
  until: number | undefined;
}

const USAGE = "usage: npm run replay -- <rom> <movie> [--screenshots <dir>] [--until <frame>]";

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let screenshots: string | null = null;
  let until: number | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--screenshots" || arg === "--until") {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${arg} needs a value.`);
      if (arg === "--screenshots") screenshots = value;
      else {
        until = Number(value);
        if (!Number.isInteger(until) || until < 0) throw new Error(`--until needs a frame number, got ${value}.`);
      }
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) throw new Error("Give a ROM and a movie.");
  return { rom: positional[0], movie: positional[1], screenshots, until };
}

function safeFileName(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]+/g, "-");
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
  const gameMap = await findGameMap(rom);
  if (args.screenshots) mkdirSync(args.screenshots, { recursive: true });
  const report = await replay({
    createCore: (callbacks) => new JsnesCore(callbacks),
    rom,
    movie,
    gameMap,
    until: args.until,
    onCheckpoint: (result, pixels) => {
      if (!args.screenshots) return;
      const file = join(args.screenshots, `${String(result.frame).padStart(6, "0")}-${safeFileName(result.name)}.png`);
      writeFileSync(file, encodeFramePng(pixels));
    },
  });
  console.log(`Movie: ${args.movie}`);
  console.log(`Memory map: ${gameMap ? gameMap.title : "none for this ROM"}`);
  console.log(formatReport(report));
  return report.passed ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  },
);
