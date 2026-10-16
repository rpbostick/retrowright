import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultTraceFolder, parseTraceArgs } from "./tasTraceArgs";

describe("tas:trace's options", () => {
  it("writes to tas-trace in the folder the command runs in when --out is not given", () => {
    const working = join("/", "work", "here");
    expect(defaultTraceFolder(working)).toBe(join(working, "tas-trace"));
    expect(parseTraceArgs(["game.nes", "run.rwmovie.json"], working)).toMatchObject({ rom: "game.nes", movie: "run.rwmovie.json", out: join(working, "tas-trace") });
  });

  it("writes to --out when given", () => {
    expect(parseTraceArgs(["game.nes", "run.rwmovie.json", "--out", "elsewhere"], "/any").out).toBe("elsewhere");
  });

  it("refuses a battle RNG state outside a byte", () => {
    expect(() => parseTraceArgs(["game.nes", "run.rwmovie.json", "--battle-rng", "256"], "/any")).toThrow("--battle-rng needs a byte, 0-255, got 256.");
  });
});
