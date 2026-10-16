import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Movie } from "../src/movie/format";
import { MEMORY_SIZE, parseDump, type MemoryRecord } from "./memoryDump";

// Runs a movie in MesenCE (GPL-3.0), used only as an external program: it is
// started with --testrunner and tools/mesen/replay.lua, which applies the
// pads and writes memory records. Each run gets its own temporary settings
// folder (XDG_CONFIG_HOME), so the user's settings are never read or changed
// and no battery save or setting carries from one run to the next.

export const MESEN_PATH = process.env.RETROWRIGHT_MESEN ?? join(homedir(), "tools", "mesen", "Mesen");
const SCRIPT = fileURLToPath(new URL("../tools/mesen/replay.lua", import.meta.url));
const MESEN_SETTINGS = { Nes: { Port1: { Type: "NesController" }, Port2: { Type: "NesController" } } };

export function mesenInstalled(path = MESEN_PATH): boolean {
  return existsSync(path);
}

/**
 * The movie as one line per MesenCE frame, pad 1's bit mask in decimal, for
 * tools/mesen/replay.lua. A positive lead puts that many frames with no
 * input first; a negative lead drops the movie's first frames. Either way
 * MesenCE's frame N runs the movie's frame N - lead.
 */
export function movieInputList(movie: Movie, lead = 0): string {
  if (movie.events.length) throw new Error(`The movie has ${movie.events.length} reset event(s); the MesenCE driver replays only movies without resets.`);
  if (movie.start.kind !== "power-on") throw new Error("The movie starts from a save state; MesenCE can only replay a power-on movie.");
  const usesPad2 = movie.inputs.find((input) => input.pad2 !== 0);
  if (usesPad2) throw new Error(`The movie presses pad 2 at frame ${usesPad2.frame}; the MesenCE driver sets pad 1 only (see tools/mesen/replay.lua).`);
  const lines: string[] = [];
  for (let frame = 0; frame < lead; frame++) lines.push("0");
  let pad1 = 0;
  let next = 0;
  for (let frame = 0; frame < movie.frames; frame++) {
    while (next < movie.inputs.length && movie.inputs[next].frame === frame) {
      pad1 = movie.inputs[next].pad1;
      next++;
    }
    if (frame >= -lead) lines.push(String(pad1));
  }
  return `${lines.join("\n")}\n`;
}

export interface MesenRunOptions {
  /** Path of the ROM file. */
  rom: string;
  movie: Movie;
  /** MesenCE's frame N runs the movie's frame N - lead. */
  lead: number;
  /** Movie frames to run. */
  frames: number;
  /** Dump after every this many frames, counted from `from`. */
  every: number;
  /** First movie frame count to dump at; at least 1 - lead. */
  from: number;
  /** Work RAM then cartridge RAM written before the first frame, e.g. the other emulator's power-on contents. */
  initialMemory?: Uint8Array;
  /** Writes a PNG of the picture after this many movie frames to `screenshot`. */
  screenshotAt?: number;
  screenshot?: string;
  /** Directory for the input list and dump; defaults to a temporary one, removed afterwards. */
  workDir?: string;
  mesenPath?: string;
  timeoutSeconds?: number;
}

export interface MesenRun {
  /** Frames are movie frames (MesenCE's frame count minus the lead). */
  records: MemoryRecord[];
  log: string;
}

export function runMesen(options: MesenRunOptions): MesenRun {
  const { lead, every } = options;
  const firstCount = options.from + lead;
  if (firstCount < 1) throw new Error(`The first dump at movie frame ${options.from} comes before MesenCE's first frame with lead ${lead}.`);
  const inputList = movieInputList(options.movie, lead);
  if (!inputList.startsWith("0\n")) throw new Error("MesenCE's first input poll comes after its first frame, so pads held during MesenCE's frame 0 cannot be set; use a lead that leaves that frame empty.");
  if (options.initialMemory && options.initialMemory.length !== MEMORY_SIZE) throw new Error(`Initial memory must be ${MEMORY_SIZE} bytes, got ${options.initialMemory.length}.`);
  if (options.screenshotAt !== undefined && !options.screenshot) throw new Error("screenshotAt needs a screenshot path.");
  const mesenPath = options.mesenPath ?? MESEN_PATH;
  if (!mesenInstalled(mesenPath)) throw new Error(`MesenCE is not installed at ${mesenPath}.`);
  const settingsHome = mkdtempSync(join(tmpdir(), "retrowright-mesen-"));
  // MesenCE does not run in this process's directory, so every path it gets is absolute.
  const workDir = resolve(options.workDir ?? settingsHome);
  try {
    // Without a settings.json MesenCE opens its first-run wizard instead of
    // running the test runner. With an empty one no controller is connected
    // (emu.getInput(0) returns an empty table and emu.setInput does nothing),
    // so both ports name a standard pad; everything else is MesenCE's default.
    mkdirSync(join(settingsHome, "MesenCE"), { recursive: true });
    writeFileSync(join(settingsHome, "MesenCE", "settings.json"), JSON.stringify(MESEN_SETTINGS));
    mkdirSync(workDir, { recursive: true });
    const inputs = join(workDir, "inputs.txt");
    const dump = join(workDir, "mesen.dump");
    writeFileSync(inputs, inputList);
    rmSync(`${dump}.error`, { force: true });
    const env: Record<string, string> = {
      ...process.env,
      XDG_CONFIG_HOME: settingsHome,
      XDG_CACHE_HOME: join(settingsHome, "cache"),
      XDG_DATA_HOME: join(settingsHome, "data"),
      RW_INPUTS: inputs,
      RW_DUMP: dump,
      RW_FRAMES: String(options.frames + lead),
      RW_FIRST: String(firstCount),
      RW_EVERY: String(every),
    };
    if (options.initialMemory) {
      const init = join(workDir, "initial-memory.bin");
      writeFileSync(init, options.initialMemory);
      env.RW_INIT = init;
    }
    if (options.screenshotAt !== undefined && options.screenshot) {
      env.RW_SHOT_AT = String(options.screenshotAt + lead);
      env.RW_SHOT = resolve(options.screenshot);
    }
    const timeoutSeconds = options.timeoutSeconds ?? 3600;
    const result = spawnSync(mesenPath, ["--testrunner", `--timeout=${timeoutSeconds}`, "--debug.scriptWindow.allowIoOsAccess=true", resolve(options.rom), SCRIPT], {
      env,
      encoding: "utf8",
      timeout: (timeoutSeconds + 30) * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.error) throw new Error(`MesenCE did not run: ${result.error.message}`);
    if (existsSync(`${dump}.error`)) throw new Error(`replay.lua failed in MesenCE: ${readFileSync(`${dump}.error`, "utf8").trim()}`);
    if (result.status !== 0) throw new Error(`MesenCE exited with ${result.status ?? result.signal}:\n${log}`);
    const records = parseDump(new Uint8Array(readFileSync(dump))).map((record) => ({ frame: record.frame - lead, memory: record.memory }));
    return { records, log };
  } finally {
    rmSync(settingsHome, { recursive: true, force: true });
  }
}
