import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JsnesCore } from "../src/core/jsnesCore";
import { Button, type CoreCallbacks } from "../src/core/types";
import { findGameMap } from "../src/games";
import { MOVIE_EXTENSION, parseMovie, type Movie } from "../src/movie/format";
import { sha256Hex } from "../src/storage/gameStore";
import { buildInes, NAMED_SYNTHETIC_ROMS, READ_PAD_PROGRAM } from "../src/test/syntheticRom";
import { MovieScript } from "./movieScript";
import { formatReport, replay } from "./replay";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MOVIES = join(ROOT, "movies");
// RETROWRIGHT_ROMS points the suite at another directory, e.g. an empty one
// to check that it passes on a machine without ROMs.
const ROMS = process.env.RETROWRIGHT_ROMS ?? join(ROOT, "roms");
const createCore = (callbacks: CoreCallbacks) => new JsnesCore(callbacks);

/** ROM bytes by SHA-256: the synthetic ones always, and whatever is in roms/. */
async function availableRoms(): Promise<Map<string, { name: string; data: Uint8Array }>> {
  const roms = new Map<string, { name: string; data: Uint8Array }>();
  for (const [name, build] of Object.entries(NAMED_SYNTHETIC_ROMS)) {
    const data = build();
    roms.set(await sha256Hex(data), { name, data });
  }
  // A checkout without ROMs has no roms/ at all; that is the case the skips are for.
  const files = existsSync(ROMS) ? readdirSync(ROMS).filter((file) => file.toLowerCase().endsWith(".nes")) : [];
  for (const file of files) {
    const data = new Uint8Array(readFileSync(join(ROMS, file)));
    roms.set(await sha256Hex(data), { name: file, data });
  }
  return roms;
}

const movieFiles = readdirSync(MOVIES).filter((file) => file.endsWith(MOVIE_EXTENSION)).sort();
const movies = movieFiles.map((file) => ({ file, movie: parseMovie(JSON.parse(readFileSync(join(MOVIES, file), "utf8"))) }));
const roms = await availableRoms();

describe("movies under movies/", () => {
  it("include the committed synthetic example, so this suite always replays one", () => {
    expect(movieFiles).toContain("synthetic-read-pad.rwmovie.json");
  });

  for (const { file, movie } of movies) {
    const rom = roms.get(movie.rom.sha256);
    if (!rom) {
      it.skip(`${file}: skipped, ROM ${movie.rom.name} (SHA-256 ${movie.rom.sha256.slice(0, 12)}…) is not in roms/`, () => {});
      continue;
    }
    it(`${file} passes every checkpoint on ${rom.name}`, async () => {
      const report = await replay({ createCore, rom: rom.data, movie, gameMap: await findGameMap(rom.data) });
      expect(report.framesRun).toBe(movie.frames);
      expect(report.checkpoints).toHaveLength(movie.checkpoints.length);
      expect(report.passed, formatReport(report)).toBe(true);
    }, 60_000);
  }
});

describe("replay on a synthetic ROM", () => {
  const rom = buildInes({ program: READ_PAD_PROGRAM });

  async function scripted(memoryWhileHeld: string[]): Promise<Movie> {
    const script = new MovieScript({
      rom: { name: "read-pad.nes", sha256: await sha256Hex(rom) },
      core: { name: "jsnes", version: "2.1.0" },
      start: { kind: "power-on", batteryRam: null },
    });
    script.wait(5).press(Button.A, 6, 0).checkpoint("A held", { memory: memoryWhileHeld }).wait(4).reset().wait(2);
    script.checkpoint("after reset", { memory: ["$0010 == 0", "$0011 == 0"] });
    return script.build();
  }

  it("passes checkpoints that hold and reports frames and speed", async () => {
    const report = await replay({ createCore, rom, movie: await scripted(["$0010 == 1"]), gameMap: null });
    expect(report.passed).toBe(true);
    expect(report.framesRun).toBe(17);
    expect(report.framesPerSecond).toBeGreaterThan(0);
    const text = formatReport(report);
    expect(text).toContain("Frames run: 17 of 17");
    expect(text).toMatch(/Speed: \d+ frames per second/);
    expect(text).toContain('PASS checkpoint "A held" at frame 11');
  });

  it("fails a checkpoint that does not hold and prints its first difference", async () => {
    const report = await replay({ createCore, rom, movie: await scripted(["$0010 == 0", "$0013 == 999"]), gameMap: null });
    expect(report.passed).toBe(false);
    expect(formatReport(report)).toContain('FAIL checkpoint "A held" at frame 11 (2 checks)\n     first difference: $0010 == 0: actual 1');
  });

  it("stops at --until and lists the checkpoints it did not reach", async () => {
    const report = await replay({ createCore, rom, movie: await scripted(["$0010 == 1"]), gameMap: null, until: 12 });
    expect(report.framesRun).toBe(12);
    expect(report.skippedCheckpoints).toEqual(["after reset"]);
  });

  it("refuses a movie recorded on another ROM", async () => {
    const movie = await scripted([]);
    await expect(replay({ createCore, rom: buildInes(), movie, gameMap: null })).rejects.toThrow("was recorded on read-pad.nes");
  });
});

// Run-twice determinism is checked on ff1-new-game only. The synthetic ROM
// draws nothing, so every frame of every run hashes the same: a run-twice test
// on it would pass on a core that is not deterministic.
describe("determinism", () => {
  /** A core with every hook on and watching every address, counting the calls. */
  function hookedCore(calls: { instructions: number; accesses: number }) {
    return (callbacks: CoreCallbacks) => {
      const core = new JsnesCore(callbacks);
      core.setDebugHooks({
        onInstruction: () => {
          calls.instructions++;
        },
        onAccess: () => {
          calls.accesses++;
        },
      });
      return core;
    };
  }

  it("gives the same frame hashes and RAM with debug hooks on as off", async () => {
    const rom = buildInes({ program: READ_PAD_PROGRAM });
    const movie = movies.find(({ file }) => file === "synthetic-read-pad.rwmovie.json")!.movie;
    const calls = { instructions: 0, accesses: 0 };
    const plain = await replay({ createCore, rom, movie, gameMap: null, frameHashes: true });
    const hooked = await replay({ createCore: hookedCore(calls), rom, movie, gameMap: null, frameHashes: true });
    expect(calls.instructions).toBeGreaterThan(movie.frames * 1000);
    expect(calls.accesses).toBeGreaterThan(0);
    expect(hooked.frameHashes).toEqual(plain.frameHashes);
    expect(hooked.checkpoints).toEqual(plain.checkpoints);
  });

  // The synthetic ROM draws nothing, so its pictures cannot differ; a game's can.
  const ff1 = movies.find(({ file }) => file === "ff1-new-game.rwmovie.json");
  const ff1Rom = ff1 && roms.get(ff1.movie.rom.sha256);
  it.skipIf(!ff1Rom)(`gives the same frame hashes for every frame of ff1-new-game with debug hooks on as off${ff1Rom ? "" : " (skipped: the movie or the Final Fantasy ROM is not here)"}`, async () => {
    const movie = ff1!.movie;
    const calls = { instructions: 0, accesses: 0 };
    const plain = await replay({ createCore, rom: ff1Rom!.data, movie, gameMap: null, frameHashes: true });
    const hooked = await replay({ createCore: hookedCore(calls), rom: ff1Rom!.data, movie, gameMap: null, frameHashes: true });
    expect(calls.accesses).toBeGreaterThan(movie.frames * 100);
    expect(new Set(plain.frameHashes).size).toBeGreaterThan(50);
    expect(hooked.frameHashes).toEqual(plain.frameHashes);
  }, 120_000);

  it.skipIf(!ff1Rom)(`gives the same frame hashes for every frame of ff1-new-game twice${ff1Rom ? "" : " (skipped: the movie or the Final Fantasy ROM is not here)"}`, async () => {
    const movie = ff1!.movie;
    const run = () => replay({ createCore, rom: ff1Rom!.data, movie, gameMap: null, frameHashes: true });
    const first = await run();
    const second = await run();
    expect(new Set(first.frameHashes).size).toBeGreaterThan(50);
    expect(second.frameHashes).toEqual(first.frameHashes);
  }, 60_000);
});
