// npm run fm2 -- <in.fm2> <out.rwmovie.json> --rom <rom> [--lead <frames>]
// Converts an FCEUX movie to a retrowright movie of the given ROM. The ROM is
// needed for the SHA-256 the movie names it by, and is checked against the
// MD5 in the .fm2 header first. Exits 1 when the ROM is not the one the movie
// was recorded on, 2 on bad arguments or files.

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fm2ToMovie, parseFm2 } from "../src/movie/fm2";
import { serializeMovie } from "../src/movie/format";
import { sha256Hex } from "../src/storage/gameStore";
import { fceuxRomMd5 } from "./fceuxRomMd5";

const USAGE = "usage: npm run fm2 -- <in.fm2> <out.rwmovie.json> --rom <rom> [--lead <frames>]";

interface CliArgs {
  input: string;
  output: string;
  rom: string;
  lead: number;
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let rom: string | null = null;
  let lead = 0;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--rom" || arg === "--lead") {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${arg} needs a value.`);
      if (arg === "--rom") rom = value;
      else {
        lead = Number(value);
        if (!Number.isInteger(lead)) throw new Error(`--lead needs a whole number of frames, got ${value}.`);
      }
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) throw new Error("Give an .fm2 movie and the output file.");
  if (rom === null) throw new Error("Give the ROM with --rom.");
  return { input: positional[0], output: positional[1], rom, lead };
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const fm2 = parseFm2(readFileSync(args.input, "utf8"));
  const rom = new Uint8Array(readFileSync(args.rom));
  const romMd5 = fceuxRomMd5(rom);
  console.log(`Movie ROM: ${fm2.header.romFilename}, MD5 ${fm2.header.romChecksumMd5} (FCEUX ${fm2.header.emuVersion})`);
  console.log(`Our ROM:   ${basename(args.rom)}, MD5 ${romMd5}`);
  if (romMd5 !== fm2.header.romChecksumMd5) {
    console.error("The ROM's MD5 differs from the one the movie was recorded on; not converted.");
    return 1;
  }
  const movie = fm2ToMovie(fm2, { rom: { name: basename(args.rom), sha256: await sha256Hex(rom) }, leadFrames: args.lead });
  writeFileSync(args.output, serializeMovie(movie));
  console.log(`Wrote ${args.output}: ${movie.frames} frames (lead ${args.lead}), ${movie.inputs.length} input changes, ${movie.events.length} resets.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  },
);
