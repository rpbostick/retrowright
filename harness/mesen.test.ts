import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { JsnesCore } from "../src/core/jsnesCore";
import type { Movie } from "../src/movie/format";
import { sha256Hex } from "../src/storage/gameStore";
import { buildInes, NMI_IDLE_PROGRAM, NMI_READ_PAD_HANDLER, READ_PAD_PROGRAM } from "../src/test/syntheticRom";
import { formatDiff, runDiff } from "./diff";
import { MESEN_PATH, mesenInstalled, movieInputList, runMesen } from "./mesen";

function movie(fields: Partial<Movie> = {}): Movie {
  return {
    format: "retrowright-movie",
    version: 1,
    rom: { name: "synthetic.nes", sha256: "0".repeat(64) },
    core: { name: "jsnes", version: "2.1.0" },
    start: { kind: "power-on", batteryRam: null },
    frames: 6,
    inputs: [
      { frame: 2, pad1: 1, pad2: 0 },
      { frame: 4, pad1: 0x88, pad2: 0 },
    ],
    events: [],
    checkpoints: [],
    ...fields,
  };
}

describe("movieInputList", () => {
  it("writes pad 1 for every frame, holding each input until the next", () => {
    expect(movieInputList(movie())).toBe("0\n0\n1\n1\n136\n136\n");
  });

  it("puts empty frames first for a positive lead and drops frames for a negative one", () => {
    expect(movieInputList(movie(), 2)).toBe("0\n0\n0\n0\n1\n1\n136\n136\n");
    expect(movieInputList(movie(), -3)).toBe("1\n136\n136\n");
  });

  it("refuses what the MesenCE driver cannot replay", () => {
    expect(() => movieInputList(movie({ events: [{ frame: 3, kind: "reset" }] }))).toThrow("reset event");
    expect(() => movieInputList(movie({ inputs: [{ frame: 1, pad1: 0, pad2: 8 }] }))).toThrow("presses pad 2 at frame 1");
    expect(() => movieInputList(movie({ start: { kind: "save-state", state: { core: "jsnes-2.1.0", data: null } } }))).toThrow("save state");
  });
});

describe("runMesen", () => {
  it("refuses pads at MesenCE's frame 0, which its first input poll comes after", () => {
    const pressedAtStart = movie({ inputs: [{ frame: 0, pad1: 8, pad2: 0 }] });
    expect(() => runMesen({ rom: "x.nes", movie: pressedAtStart, lead: 0, frames: 6, every: 1, from: 1 })).toThrow("cannot be set");
  });

  it("refuses a first dump before MesenCE's first frame", () => {
    expect(() => runMesen({ rom: "x.nes", movie: movie(), lead: -2, frames: 6, every: 1, from: 1 })).toThrow("comes before MesenCE's first frame");
  });
});

// The rest runs MesenCE itself and is skipped on a machine without it.
const installed = mesenInstalled();
const skipNote = installed ? "" : ` (skipped: MesenCE is not installed at ${MESEN_PATH})`;

describe("jsnes against MesenCE on synthetic ROMs", () => {
  const scratch = mkdtempSync(join(tmpdir(), "retrowright-mesen-test-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  async function synthetic(name: string, rom: Uint8Array, inputs: Movie["inputs"], frames: number) {
    const path = join(scratch, name);
    writeFileSync(path, rom);
    return { path, rom, movie: movie({ rom: { name, sha256: await sha256Hex(rom) }, frames, inputs }) };
  }

  it.skipIf(!installed)(`agrees byte for byte on a ROM that reads the pad in its NMI handler${skipNote}`, async () => {
    const { path, rom, movie: pressA } = await synthetic(
      "nmi-read-pad.nes",
      buildInes({ program: NMI_IDLE_PROGRAM, nmiHandler: NMI_READ_PAD_HANDLER }),
      [
        { frame: 5, pad1: 1, pad2: 0 },
        { frame: 8, pad1: 0, pad2: 0 },
        { frame: 20, pad1: 1, pad2: 0 },
        { frame: 21, pad1: 0, pad2: 0 },
      ],
      40,
    );
    const shots = join(scratch, "nmi-shots");
    const result = runDiff({ romPath: path, rom, movie: pressA, createCore: (callbacks) => new JsnesCore(callbacks), lead: 0, every: 1, screenshots: shots });
    expect(result.comparison, formatDiff(result, null)).toMatchObject({ firstDifferentFrame: null, framesCompared: 40, lastEqualFrame: 40 });
    expect(result.screenshots).toEqual([]);
  }, 60_000);

  it.skipIf(!installed)(`reports the first differing frame, its addresses and a screenshot from each side${skipNote}`, async () => {
    // A busy loop counts passes in $13, so RAM after each frame shows how
    // many CPU cycles each emulator ran before its frame ended.
    const { path, rom, movie: idle } = await synthetic("read-pad.nes", buildInes({ program: READ_PAD_PROGRAM }), [], 10);
    const shots = join(scratch, "busy-shots");
    const result = runDiff({ romPath: path, rom, movie: idle, createCore: (callbacks) => new JsnesCore(callbacks), lead: 0, every: 1, screenshots: shots });
    expect(result.comparison.firstDifferentFrame).toBe(1);
    expect(result.comparison.differences.map((difference) => difference.address)).toContain(0x0013);
    expect(result.screenshots).toHaveLength(1);
    expect(existsSync(result.screenshots[0].jsnes) && existsSync(result.screenshots[0].mesen)).toBe(true);
    expect(formatDiff(result, null)).toContain("Memory: first difference at frame 1");
  }, 60_000);
});
