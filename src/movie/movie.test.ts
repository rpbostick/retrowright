import { describe, expect, it, vi } from "vitest";
import { JsnesCore } from "../core/jsnesCore";
import { Button } from "../core/types";
import { buildInes, READ_PAD_PROGRAM } from "../test/syntheticRom";
import { assertionsFor, checkAssertion } from "./expectations";
import { MOVIE_FORMAT, parseMovie, serializeMovie, type Movie } from "./format";
import { describeMask, maskOf } from "./pads";
import { MovieRecorder } from "./recorder";
import { bootMovie, evaluateCheckpoint, MovieRunner } from "./runner";
import { screenHash } from "./screenHash";

const HEADER = {
  rom: { name: "read-pad.nes", sha256: "0".repeat(64) },
  core: { name: "jsnes", version: "2.1.0" },
  start: { kind: "power-on", batteryRam: null } as const,
};

function newCore() {
  return new JsnesCore({ onFrame: vi.fn(), onAudioSample: () => {}, onBatteryRamWrite: () => {} });
}

describe("pads", () => {
  it("uses the controller's shift-register bit order, A first", () => {
    expect(maskOf([Button.A])).toBe(0x01);
    expect(maskOf([Button.Start, Button.Right])).toBe(0x88);
    expect(describeMask(0x09)).toBe("A+Start");
    expect(describeMask(0)).toBe("none");
  });
});

describe("MovieRecorder", () => {
  it("keeps only the frames where a pad changes, and resets and marks at the next frame", () => {
    const recorder = new MovieRecorder(HEADER);
    recorder.recordFrame(0, 0);
    recorder.recordFrame(0x01, 0);
    recorder.recordFrame(0x01, 0);
    recorder.recordReset();
    recorder.mark("after reset", { memory: ["$0010 == 1"] });
    recorder.recordFrame(0, 0x08);
    const movie = recorder.finish();
    expect(movie.frames).toBe(4);
    expect(movie.inputs).toEqual([
      { frame: 1, pad1: 0x01, pad2: 0 },
      { frame: 3, pad1: 0, pad2: 0x08 },
    ]);
    expect(movie.events).toEqual([{ frame: 3, kind: "reset" }]);
    expect(movie.checkpoints).toEqual([{ frame: 3, name: "after reset", expect: { memory: ["$0010 == 1"] } }]);
  });
});

describe("movie file", () => {
  const movie: Movie = {
    format: MOVIE_FORMAT,
    version: 1,
    ...HEADER,
    frames: 10,
    inputs: [{ frame: 2, pad1: 1, pad2: 0 }],
    events: [{ frame: 5, kind: "reset" }],
    checkpoints: [{ frame: 10, name: "end", expect: { screenHash: "fnv1a32:00000000" } }],
  };

  it("round-trips through its JSON text", () => {
    expect(parseMovie(JSON.parse(serializeMovie(movie)))).toEqual(movie);
  });

  it("refuses files that are not movies, naming the problem", () => {
    expect(() => parseMovie({ ...movie, format: "fm2" })).toThrow('format must be "retrowright-movie"');
    expect(() => parseMovie({ ...movie, version: 2 })).toThrow("version 2 is not supported");
    expect(() => parseMovie({ ...movie, inputs: [{ frame: 11, pad1: 0, pad2: 0 }] })).toThrow("from 0 to 10");
    expect(() => parseMovie({ ...movie, inputs: [{ frame: 1, pad1: 256, pad2: 0 }] })).toThrow("bit mask");
    expect(() => parseMovie({ ...movie, inputs: [{ frame: 3, pad1: 1, pad2: 0 }, { frame: 2, pad1: 0, pad2: 0 }] })).toThrow("frame order");
    expect(() => parseMovie({ ...movie, events: [{ frame: 1, kind: "power" }] })).toThrow('"reset"');
    expect(() => parseMovie({ ...movie, start: { kind: "warm" } })).toThrow("start.kind");
  });
});

describe("assertions", () => {
  const context = { peek: (address: number) => (address === 0x48 ? 8 : 0), view: { map: "Coneria", party: [{ hp: 35, name: "LUKE" }] } };

  it("compares raw addresses and paths into a game's state", () => {
    expect(checkAssertion("$0048 == 8", context).passed).toBe(true);
    expect(checkAssertion("$48 == 0x08", context).passed).toBe(true);
    expect(checkAssertion('map == "Coneria"', context).passed).toBe(true);
    expect(checkAssertion("party[0].hp >= 30", context).passed).toBe(true);
    expect(checkAssertion("party[0].hp < 30", context)).toMatchObject({ passed: false, actual: 35 });
    expect(checkAssertion('party[0].name != "KATE"', context).passed).toBe(true);
  });

  it("fails, with a reason, on a path the state does not have or a line it cannot read", () => {
    expect(checkAssertion("party[4].hp == 1", context).error).toContain("no [4]");
    expect(checkAssertion("gold == 1", context).error).toContain("no gold");
    expect(checkAssertion("party[0].hp", context).error).toContain("not an assertion");
    expect(checkAssertion("map == Coneria", context).error).toContain("quoted string");
    expect(checkAssertion("map == 1", { ...context, view: null }).error).toContain("needs a memory map");
  });

  it("writes one equality per leaf for a Mark", () => {
    expect(assertionsFor(context.view)).toEqual(['map == "Coneria"', "party[0].hp == 35", 'party[0].name == "LUKE"']);
  });
});

describe("MovieRunner", () => {
  const rom = buildInes({ program: READ_PAD_PROGRAM });

  function scriptedMovie(): Movie {
    const recorder = new MovieRecorder(HEADER);
    for (let frame = 0; frame < 5; frame++) recorder.recordFrame(0, 0);
    recorder.mark("A not yet pressed", { memory: ["$0010 == 0", "$0011 == 0"] });
    for (let frame = 0; frame < 3; frame++) recorder.recordFrame(maskOf([Button.A, Button.Start]), 0);
    recorder.mark("A and Start held", { memory: ["$0010 == 1", "$0012 == 1"] });
    recorder.recordFrame(0, 0);
    recorder.recordReset();
    recorder.recordFrame(0, 0);
    recorder.mark("after a reset", { memory: ["$0010 == 0", "$0011 == 0"] });
    return recorder.finish();
  }

  function play(movie: Movie) {
    const core = newCore();
    bootMovie(core, rom, movie.start);
    const runner = new MovieRunner(core, movie);
    const results = [];
    while (!runner.done) {
      runner.step();
      for (const checkpoint of runner.takeDueCheckpoints()) results.push(evaluateCheckpoint(checkpoint, { peek: (address) => core.peek(address), view: null, screenHash: null }));
    }
    return { core, results };
  }

  it("applies each frame's pads before the frame, and resets where the movie says", () => {
    const { results } = play(scriptedMovie());
    expect(results.map((result) => [result.name, result.failures])).toEqual([
      ["A not yet pressed", []],
      ["A and Start held", []],
      ["after a reset", []],
    ]);
  });

  it("reports the first difference when memory is not what a checkpoint expects", () => {
    const movie = scriptedMovie();
    movie.checkpoints[1].expect.memory = ["$0010 == 0", "$0012 == 0"];
    const failed = play(movie).results[1];
    expect(failed.passed).toBe(false);
    expect(failed.failures).toEqual(["$0010 == 0: actual 1", "$0012 == 0: actual 1"]);
  });

  it("starts from battery RAM or a save state as the movie says", () => {
    const batteryRom = buildInes({ battery: true });
    const image = new Uint8Array(0x2000);
    image[5] = 0x77;
    const core = newCore();
    bootMovie(core, batteryRom, { kind: "power-on", batteryRam: btoa(String.fromCharCode(...image)) });
    expect(core.peek(0x6005)).toBe(0x77);

    const source = newCore();
    source.load(rom);
    for (let frame = 0; frame < 3; frame++) source.frame();
    const state = source.saveState();
    const target = newCore();
    bootMovie(target, rom, { kind: "save-state", state });
    expect(target.peek(0x13)).toBe(source.peek(0x13));
  });
});

describe("screenHash", () => {
  it("ignores the alpha byte and sees a one-pixel change", () => {
    const pixels = new Uint32Array(256 * 240);
    const opaque = pixels.map(() => 0xff000000);
    expect(screenHash(pixels)).toBe(screenHash(opaque));
    pixels[1000] = 0x000001;
    expect(screenHash(pixels)).not.toBe(screenHash(opaque));
    expect(screenHash(pixels)).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
  });
});
