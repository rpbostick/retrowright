import { createHash } from "node:crypto";
import { parseInes } from "../src/rom/ines";

const INES_HEADER_BYTES = 16;
const TRAINER_BYTES = 512;

/**
 * FCEUX's romChecksum: MD5 of PRG-ROM then CHR-ROM, without the iNES header
 * or trainer, so two dumps that differ only in header bytes match. Node's
 * crypto is used because Web Crypto has no MD5.
 */
export function fceuxRomMd5(rom: Uint8Array): string {
  const parsed = parseInes(rom);
  if (!parsed.ok) throw new Error(parsed.error);
  const start = INES_HEADER_BYTES + (parsed.header.trainer ? TRAINER_BYTES : 0);
  const content = rom.subarray(start, start + parsed.header.prgRomBytes + parsed.header.chrRomBytes);
  return createHash("md5").update(content).digest("hex");
}
