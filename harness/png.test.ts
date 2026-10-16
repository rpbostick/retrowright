import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodeAnimatedPng, encodePng } from "./png";

describe("encodePng", () => {
  it("writes the picture's own size and its pixels as RGB rows", () => {
    const png = encodePng(3, 2, Uint32Array.of(0x0000ff, 0x00ff00, 0xff0000, 0x010203, 0, 0xffffff));
    expect(png.readUInt32BE(16)).toBe(3);
    expect(png.readUInt32BE(20)).toBe(2);
    const idatLength = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 3, 2, 1, 0, 0, 0, 255, 255, 255]);
  });

  it("refuses a pixel count that does not match the size", () => {
    expect(() => encodePng(3, 2, new Uint32Array(5))).toThrow("A 3×2 picture has 6 pixels, got 5.");
  });
});

/** The chunks of a PNG after its 8-byte signature: type and data. */
function chunksOf(png: Buffer): { type: string; data: Buffer }[] {
  const chunks: { type: string; data: Buffer }[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    chunks.push({ type: png.toString("ascii", at + 4, at + 8), data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return chunks;
}

describe("encodeAnimatedPng", () => {
  it("writes acTL with the frame count, an fcTL per frame with its delay, the first frame as IDAT and the rest as fdAT, in sequence", () => {
    const frames = [Uint32Array.of(0x0000ff, 0), Uint32Array.of(0, 0x00ff00), Uint32Array.of(0xff0000, 0xff0000)];
    const chunks = chunksOf(encodeAnimatedPng(2, 1, frames, 50));
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "acTL", "fcTL", "IDAT", "fcTL", "fdAT", "fcTL", "fdAT", "IEND"]);
    expect(chunks[1].data.readUInt32BE(0)).toBe(3);
    expect(chunks[1].data.readUInt32BE(4)).toBe(0);
    const controls = chunks.filter((chunk) => chunk.type === "fcTL");
    // fcTL and fdAT share one sequence; the first frame's IDAT takes no number.
    expect(controls.map((chunk) => chunk.data.readUInt32BE(0))).toEqual([0, 1, 3]);
    expect(controls.every((chunk) => chunk.data.readUInt32BE(4) === 2 && chunk.data.readUInt32BE(8) === 1 && chunk.data.readUInt16BE(20) === 50 && chunk.data.readUInt16BE(22) === 1000)).toBe(true);
    const data = chunks.filter((chunk) => chunk.type === "fdAT");
    expect(data.map((chunk) => chunk.data.readUInt32BE(0))).toEqual([2, 4]);
    expect([...inflateSync(chunks[3].data)]).toEqual([0, 255, 0, 0, 0, 0, 0]);
    expect([...inflateSync(data[1].data.subarray(4))]).toEqual([0, 0, 0, 255, 0, 0, 255]);
  });

  it("refuses no frames", () => {
    expect(() => encodeAnimatedPng(2, 1, [], 50)).toThrow("at least one picture");
  });
});
