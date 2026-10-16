import { describe, expect, it } from "vitest";
import { fm2ToMovie, parseFm2 } from "./fm2";
import { parseMovie, serializeMovie } from "./format";
import { maskOf } from "./pads";
import { Button } from "../core/types";

const ROM = { name: "game.nes", sha256: "0".repeat(64) };

function fm2(log: string[], extraHeader: string[] = []): string {
  return [
    "version 3",
    "emuVersion 22020",
    "rerecordCount 12",
    "palFlag 0",
    "romFilename Game (U)",
    "romChecksum base64:JK5e34N1Fi+RpoRtMgLj1g==",
    "guid 2CFDB3FA-742C-CDF6-CEE0-C124FA6A71C1",
    "fourscore 0",
    "port0 1",
    "port1 1",
    "port2 0",
    "comment author Someone",
    ...extraHeader,
    ...log,
    "",
  ].join("\n");
}

describe("parseFm2", () => {
  it("reads the header and decodes the base64 MD5 to hex", () => {
    const { header } = parseFm2(fm2(["|0|........|........||"]));
    expect(header).toMatchObject({ version: 3, emuVersion: 22020, romFilename: "Game (U)", rerecordCount: 12, ports: [1, 1], comments: ["author Someone"] });
    expect(header.romChecksumMd5).toBe("24ae5edf8375162f91a6846d3202e3d6");
  });

  it("reads RLDUTSBA with any character but '.' or space as pressed", () => {
    const { frames } = parseFm2(fm2(["|0|R......A|...UT...||", "|0|.L..XS .|  D  ...||", "|1|........|........||"]));
    expect(frames).toEqual([
      { commands: 0, pad1: maskOf([Button.Right, Button.A]), pad2: maskOf([Button.Up, Button.Start]) },
      { commands: 0, pad1: maskOf([Button.Left, Button.Start, Button.Select]), pad2: maskOf([Button.Down]) },
      { commands: 1, pad1: 0, pad2: 0 },
    ]);
  });

  it("reads an empty field for a port with no device, as in a one-player movie", () => {
    const text = fm2(["|0|....T...|||"]).replace("port1 1", "port1 0");
    expect(parseFm2(text).frames).toEqual([{ commands: 0, pad1: 0x08, pad2: 0 }]);
  });

  it("accepts CRLF line ends and stops at the header's length", () => {
    const text = fm2(["|0|.......A|........||", "|0|......B.|........||"], ["length 1"]).replace(/\n/g, "\r\n");
    expect(parseFm2(text).frames).toEqual([{ commands: 0, pad1: 0x01, pad2: 0 }]);
  });

  it.each([
    ["binary 1", "binary"],
    ["palFlag 1", "PAL"],
    ["savestate 0x1234", "save state"],
    ["FDS 1", "Famicom Disk System"],
  ])("refuses a movie with %s", (line, message) => {
    expect(() => parseFm2(fm2(["|0|........|........||"], [line]))).toThrow(message);
  });

  it("refuses a Zapper port, a short gamepad field and FDS commands", () => {
    expect(() => parseFm2(fm2(["|0|........|||"]).replace("port1 1", "port1 2"))).toThrow("port1 holds device 2");
    expect(() => parseFm2(fm2(["|0|.......|........||"]))).toThrow("line 13 port0: a gamepad field has 8 characters");
    expect(() => parseFm2(fm2(["|4|........|........||"]))).toThrow("FDS or VS");
  });

  it("refuses a header without version first or without romChecksum", () => {
    expect(() => parseFm2(`emuVersion 1\nversion 3\n|0|........|||\n`)).toThrow("first line must be the version");
    expect(() => parseFm2(fm2(["|0|........|........||"]).replace(/romChecksum.*\n/, ""))).toThrow("no romChecksum");
  });
});

describe("fm2ToMovie", () => {
  const log = ["|2|........|........||", "|0|........|........||", "|0|....T...|........||", "|0|....T...|........||", "|1|........|.......A||", "|0|........|........||"];

  it("keeps pad changes as runs, soft resets as events and power at frame 0 as the start", () => {
    const movie = fm2ToMovie(parseFm2(fm2(log)), { rom: ROM });
    expect(movie.core).toEqual({ name: "fceux", version: "22020" });
    expect(movie.start).toEqual({ kind: "power-on", batteryRam: null });
    expect(movie.frames).toBe(6);
    expect(movie.inputs).toEqual([
      { frame: 2, pad1: 0x08, pad2: 0 },
      { frame: 4, pad1: 0, pad2: 0x01 },
      { frame: 5, pad1: 0, pad2: 0 },
    ]);
    expect(movie.events).toEqual([{ frame: 4, kind: "reset" }]);
    expect(parseMovie(JSON.parse(serializeMovie(movie)))).toEqual(movie);
  });

  it("shifts every frame by positive leadFrames and drops blank frames for negative ones", () => {
    const later = fm2ToMovie(parseFm2(fm2(log)), { rom: ROM, leadFrames: 3 });
    expect(later.frames).toBe(9);
    expect(later.inputs[0].frame).toBe(5);
    expect(later.events).toEqual([{ frame: 7, kind: "reset" }]);
    const blankStart = log.slice(1);
    const earlier = fm2ToMovie(parseFm2(fm2(blankStart)), { rom: ROM, leadFrames: -1 });
    expect(earlier.frames).toBe(4);
    expect(earlier.inputs[0].frame).toBe(0);
  });

  it("refuses to drop a frame with input, and a power cycle after frame 0", () => {
    expect(() => fm2ToMovie(parseFm2(fm2(log)), { rom: ROM, leadFrames: -3 })).toThrow("frame 2, which has input");
    expect(() => fm2ToMovie(parseFm2(fm2(["|0|........|........||", "|2|........|........||"])), { rom: ROM })).toThrow("frame 1 powers");
  });
});
