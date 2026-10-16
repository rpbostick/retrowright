import { describe, expect, it } from "vitest";
import { JsnesCore } from "../core/jsnesCore";
import { NES_VIDEO } from "../core/types";
import { rgbaScreenHash, screenHash } from "../movie/screenHash";
import { buildInes, PAINT_BACKDROP_PROGRAM } from "../test/syntheticRom";
import { screenshotBytes, screenshotFileName } from "./screenshot";

describe("screenshotBytes", () => {
  it("holds the core's frame pixel for pixel: its hash is the frame's screenHash", () => {
    const core = new JsnesCore({ onFrame() {}, onAudioSample() {}, onBatteryRamWrite() {} });
    core.load(buildInes({ program: PAINT_BACKDROP_PROGRAM }));
    for (let frame = 0; frame < 10; frame++) core.frame();
    const pixels = core.picture();
    const bytes = screenshotBytes(pixels, core.video);
    expect(bytes).toHaveLength(256 * 240 * 4);
    expect(rgbaScreenHash(bytes)).toBe(screenHash(pixels));
    // Every pixel is opaque, and the first is the frame's own colour in RGBA order.
    expect(bytes.filter((_, index) => index % 4 === 3 && bytes[index] !== 255)).toHaveLength(0);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([pixels[0] & 0xff, (pixels[0] >>> 8) & 0xff, (pixels[0] >>> 16) & 0xff]);
  });

  it("tells one frame from another", () => {
    const frame = new Uint32Array(256 * 240);
    const other = frame.slice();
    other[1000] = 0x00ff00;
    expect(rgbaScreenHash(screenshotBytes(other, NES_VIDEO))).not.toBe(rgbaScreenHash(screenshotBytes(frame, NES_VIDEO)));
  });

  it("refuses a frame of another size than the core describes", () => {
    expect(() => screenshotBytes(new Uint32Array(240 * 160), NES_VIDEO)).toThrow("A 256x240 frame has 61440 pixels, got 38400.");
  });
});

describe("screenshotFileName", () => {
  it("names the game and the local time, without characters file systems refuse", () => {
    expect(screenshotFileName("Zelda: A/B?", new Date(2026, 9, 12, 9, 5, 7))).toBe("Zelda AB-2026-10-12_09-05-07.png");
    expect(screenshotFileName("???", new Date(2026, 0, 1, 0, 0, 0))).toBe("screenshot-2026-01-01_00-00-00.png");
  });
});
