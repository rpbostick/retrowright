import type { VideoDescription } from "../core/types";
import { opaquePixels } from "../player/screenRenderer";

/** "<title>-<local date and time>.png", without characters file systems refuse. */
export function screenshotFileName(title: string, when: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}_${pad(when.getHours())}-${pad(when.getMinutes())}-${pad(when.getSeconds())}`;
  const safe = title.replace(/[\\/:*?"<>|]/g, "").trim() || "screenshot";
  return `${safe}-${stamp}.png`;
}

/** The frame as RGBA bytes, row by row: what the PNG holds, pixel for pixel. */
export function screenshotBytes(pixels: Uint32Array, video: VideoDescription): Uint8ClampedArray<ArrayBuffer> {
  if (pixels.length !== video.width * video.height) throw new Error(`A ${video.width}x${video.height} frame has ${video.width * video.height} pixels, got ${pixels.length}.`);
  const bytes = new Uint8ClampedArray(pixels.length * 4);
  opaquePixels(pixels, new Uint32Array(bytes.buffer));
  return bytes;
}

/**
 * Encodes the frame as a PNG at the core's own size (one PNG pixel per frame
 * pixel, no pixel aspect, no scanlines) with the browser's canvas encoder.
 */
export function encodeScreenshot(pixels: Uint32Array, video: VideoDescription): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.width;
  canvas.height = video.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("This browser cannot draw to a 2D canvas."));
  context.putImageData(new ImageData(screenshotBytes(pixels, video), video.width, video.height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the PNG."))), "image/png"));
}
