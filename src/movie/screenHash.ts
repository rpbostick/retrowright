/**
 * A short, synchronous digest of one frame's picture, the same in the page and
 * in Node. Deliberate: FNV-1a rather than SHA-256, because crypto.subtle is
 * asynchronous and a hash per frame must not stall the frame loop; a checkpoint
 * needs change detection, not collision resistance. The prefix names the
 * algorithm so a later change of it reads as a different hash, not a failure.
 * Only the colour bits are hashed: cores may differ in the alpha byte.
 */
export function screenHash(pixels: Uint32Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < pixels.length; index++) {
    const pixel = pixels[index];
    hash = Math.imul(hash ^ (pixel & 0xff), 0x01000193);
    hash = Math.imul(hash ^ ((pixel >>> 8) & 0xff), 0x01000193);
    hash = Math.imul(hash ^ ((pixel >>> 16) & 0xff), 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * screenHash() of a picture given as RGBA bytes (a decoded image's
 * ImageData), so a saved screenshot can be checked against the frame.
 */
export function rgbaScreenHash(bytes: ArrayLike<number>): string {
  if (bytes.length % 4 !== 0) throw new Error(`RGBA bytes come in fours, got ${bytes.length}.`);
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 4) {
    hash = Math.imul(hash ^ bytes[index], 0x01000193);
    hash = Math.imul(hash ^ bytes[index + 1], 0x01000193);
    hash = Math.imul(hash ^ bytes[index + 2], 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
