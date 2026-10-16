import { crc32, deflateSync } from "node:zlib";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../src/core/types";

// Deliberate: a short PNG and APNG writer on node:zlib instead of a dependency.
// Screenshots are one fixed size of opaque RGB; deflate and CRC-32, the parts
// worth a library, come from Node itself, and an APNG is the same chunks with
// three more.

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** Encodes a core frame (pixels 0x00BBGGRR) as an RGB PNG. */
export function encodeFramePng(pixels: Uint32Array): Buffer {
  if (pixels.length !== SCREEN_WIDTH * SCREEN_HEIGHT) throw new Error(`A frame has ${SCREEN_WIDTH * SCREEN_HEIGHT} pixels, got ${pixels.length}.`);
  return encodePng(SCREEN_WIDTH, SCREEN_HEIGHT, pixels);
}

/** Encodes a picture of any size, pixels 0x00BBGGRR row by row, as an RGB PNG. */
export function encodePng(width: number, height: number, pixels: Uint32Array): Buffer {
  return Buffer.concat([SIGNATURE, chunk("IHDR", headerOf(width, height)), chunk("IDAT", deflateSync(rowsOf(width, height, pixels))), chunk("IEND", new Uint8Array(0))]);
}

/**
 * Encodes pictures of one size as an animated PNG (APNG), each shown for
 * `delayMs`, looping. Browsers play it as an <img>, and a viewer without APNG
 * shows the first picture; it is the PNG above with acTL, fcTL and fdAT chunks.
 */
export function encodeAnimatedPng(width: number, height: number, frames: readonly Uint32Array[], delayMs: number): Buffer {
  if (frames.length === 0) throw new Error("An animated PNG needs at least one picture.");
  const control = Buffer.alloc(8);
  control.writeUInt32BE(frames.length, 0); // frames; 0 plays at offset 4 loops for ever
  const chunks = [SIGNATURE, chunk("IHDR", headerOf(width, height)), chunk("acTL", control)];
  let sequence = 0;
  frames.forEach((pixels, index) => {
    const frameControl = Buffer.alloc(26);
    frameControl.writeUInt32BE(sequence++, 0);
    frameControl.writeUInt32BE(width, 4);
    frameControl.writeUInt32BE(height, 8);
    frameControl.writeUInt16BE(delayMs, 20);
    frameControl.writeUInt16BE(1000, 22); // the delay is delayMs/1000 seconds; offsets, dispose and blend stay 0
    chunks.push(chunk("fcTL", frameControl));
    const data = deflateSync(rowsOf(width, height, pixels));
    if (index === 0) {
      chunks.push(chunk("IDAT", data));
    } else {
      const number = Buffer.alloc(4);
      number.writeUInt32BE(sequence++, 0);
      chunks.push(chunk("fdAT", Buffer.concat([number, data])));
    }
  });
  chunks.push(chunk("IEND", new Uint8Array(0)));
  return Buffer.concat(chunks);
}

function headerOf(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // colour type: RGB
  return header;
}

/** The picture as PNG scanlines: each row a filter byte (0, none) and its RGB bytes. */
function rowsOf(width: number, height: number, pixels: Uint32Array): Buffer {
  if (pixels.length !== width * height) throw new Error(`A ${width}×${height} picture has ${width * height} pixels, got ${pixels.length}.`);
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = pixels[y * width + x];
      const at = y * stride + 1 + x * 3;
      raw[at] = pixel & 0xff;
      raw[at + 1] = (pixel >>> 8) & 0xff;
      raw[at + 2] = (pixel >>> 16) & 0xff;
    }
  }
  return raw;
}
