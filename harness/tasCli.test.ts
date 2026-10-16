import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { findGameMap } from "../src/games";
import { BATTLE_RNG_STATE } from "../src/games/ff1/memoryMap";
import { parseMovie } from "../src/movie/format";
import { sha256Hex } from "../src/storage/gameStore";
import { bootAt } from "./tasStart";

// bootAt, npm run tas:trace and npm run tas:sweep on the real Final Fantasy
// ROM and the converted TAS, short runs of each. Skipped where the ROM or the
// TAS files are not present.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ROMS = process.env.RETROWRIGHT_ROMS ?? join(ROOT, "roms");
const TAS_MOVIE = join(ROOT, "movies/tas/ff1-tas-4450.rwmovie.json");
const TAS_FM2 = join(ROOT, "movies/tas/FinalFantasy-noResets-final-fromStart.fm2");
const TSX = join(ROOT, "node_modules/tsx/dist/cli.mjs");

/** The Final Fantasy (USA) ROM in roms/, found by its game map, not its file name. */
async function findFf1Rom(): Promise<string | null> {
  if (!existsSync(ROMS)) return null;
  for (const file of readdirSync(ROMS).filter((name) => name.toLowerCase().endsWith(".nes"))) {
    const path = join(ROMS, file);
    if ((await findGameMap(new Uint8Array(readFileSync(path))))?.id === "ff1") return path;
  }
  return null;
}

const ff1RomPath = await findFf1Rom();
const ready = ff1RomPath !== null && existsSync(TAS_MOVIE) && existsSync(TAS_FM2);
const skipNote = ready ? "" : " (skipped: the Final Fantasy ROM is not in roms/ or the TAS is not in movies/tas/)";

function runCli(script: string, args: string[]) {
  return spawnSync(process.execPath, [TSX, join(ROOT, "harness", script), ...args], { cwd: ROOT, encoding: "utf8" });
}

describe.skipIf(!ready)(`the TAS tools on Final Fantasy${skipNote}`, () => {
  const folder = mkdtempSync(join(tmpdir(), "retrowright-tas-"));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it("bootAt puts the start's work-RAM fill and battle RNG state in, and the same start plays the same 600 frames", async () => {
    const rom = new Uint8Array(readFileSync(ff1RomPath!));
    const movie = parseMovie(JSON.parse(readFileSync(TAS_MOVIE, "utf8")));
    expect(movie.rom.sha256).toBe(await sha256Hex(rom));
    const start = { fill: "fceux", battleRng: 7 } as const;
    const first = bootAt(rom, movie, start);
    expect(first.runner.frame).toBe(0);
    expect(first.core.peek(BATTLE_RNG_STATE)).toBe(7);
    expect([0x0000, 0x0003, 0x0004, 0x0007, 0x0008].map((address) => first.core.peek(address))).toEqual([0, 0, 0xff, 0xff, 0]);
    const ramAfter = (boot: ReturnType<typeof bootAt>) => {
      for (let frame = 0; frame < 600; frame++) boot.runner.step();
      return Array.from({ length: 0x800 }, (_, address) => boot.core.peek(address));
    };
    const ram = ramAfter(first);
    expect(first.runner.frame).toBe(600);
    expect(ramAfter(bootAt(rom, movie, start))).toEqual(ram);
    expect(ramAfter(bootAt(rom, movie, { fill: "zeros", battleRng: 7 }))).not.toEqual(ram);
  }, 60_000);

  it("tas:trace writes a trace row every --every frames up to --until, and an events file", () => {
    const out = join(folder, "trace");
    const run = runCli("tasTrace.ts", [ff1RomPath!, TAS_MOVIE, "--out", out, "--every", "60", "--until", "600"]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^Ran 600 of \d+ frames \(ram jsnes, battle RNG 0\)/);
    const trace = readFileSync(join(out, "trace.tsv"), "utf8").trim().split("\n");
    expect(trace[0]).toBe("frame\tplace\tx\ty\t$81\tbattleRng\thp\tgold\tdead\tscreen");
    expect(trace.slice(1).map((line) => Number(line.split("\t")[0]))).toEqual([60, 120, 180, 240, 300, 360, 420, 480, 540, 600]);
    expect(readFileSync(join(out, "events.tsv"), "utf8").split("\n")[0]).toMatch(/\tchange$/);
  }, 60_000);

  it("tas:trace refuses an unknown option with its usage and exit 2", () => {
    const run = runCli("tasTrace.ts", [ff1RomPath!, TAS_MOVIE, "--no-such-option", "1"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Unknown option --no-such-option.");
    expect(run.stderr).toContain("usage: npm run tas:trace");
  }, 60_000);

  it("tas:sweep compares the 20 samples from --from to --until and finds the baseline's own start with no difference", () => {
    const run = runCli("tasSweep.ts", [ff1RomPath!, TAS_FM2, "--leads", "0", "--ram", "jsnes", "--seeds", "0", "--until", "1200", "--from", "600"]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const lines = run.stdout.trim().split("\n");
    expect(lines[0]).toMatch(/^baseline: lead 0, ram jsnes, seed 0; 20 samples to frame 1200$/);
    expect(lines[1]).toBe("lead\tram\tseed\tinStepTo\tfirstDifference (baseline / this start)");
    expect(lines[2].split("\t")).toEqual(["0", "jsnes", "0", expect.any(String), "none"]);
    expect(lines).toHaveLength(3);
  }, 120_000);

  it("tas:sweep refuses a seed outside 0-255 with its usage and exit 2", () => {
    const run = runCli("tasSweep.ts", [ff1RomPath!, TAS_FM2, "--seeds", "300"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("--seeds must lie in 0-255, got 300.");
    expect(run.stderr).toContain("usage: npm run tas:sweep");
  }, 60_000);
});
