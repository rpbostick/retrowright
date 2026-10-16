// iNES / NES 2.0 header parsing. See https://www.nesdev.org/wiki/INES and
// https://www.nesdev.org/wiki/NES_2.0

export const HEADER_SIZE = 16;
const TRAINER_SIZE = 512;
const PRG_BANK = 16 * 1024;
const CHR_BANK = 8 * 1024;

/**
 * Mapper numbers jsnes 2.1.0 implements (its src/mappers/index.js, which the
 * package does not export). A test loads a synthetic ROM for every mapper
 * number into jsnes and checks this list against what jsnes accepts.
 */
export const SUPPORTED_MAPPERS: ReadonlySet<number> = new Set([
  0, 1, 2, 3, 4, 5, 7, 9, 11, 34, 38, 66, 71, 79, 94, 118, 119, 140, 180, 240,
  241,
]);

export interface InesHeader {
  format: "iNES" | "NES 2.0";
  mapper: number;
  prgRomBytes: number;
  chrRomBytes: number;
  battery: boolean;
  trainer: boolean;
  mirroring: "horizontal" | "vertical" | "four-screen";
}

export type InesResult =
  | { ok: true; header: InesHeader }
  | { ok: false; error: string };

function sizeFromExponent(byte: number): number {
  const exponent = byte >> 2;
  const multiplier = byte & 0x03;
  return 2 ** exponent * (multiplier * 2 + 1);
}

/** Parses the header and checks the file is long enough and playable here. */
export function parseInes(data: Uint8Array): InesResult {
  if (data.length < HEADER_SIZE) {
    return { ok: false, error: `The file is too short to be an NES ROM (${data.length} bytes).` };
  }
  if (data[0] !== 0x4e || data[1] !== 0x45 || data[2] !== 0x53 || data[3] !== 0x1a) {
    return { ok: false, error: "This is not an NES ROM: the file does not start with the iNES signature \"NES\\x1A\"." };
  }

  const flags6 = data[6];
  const flags7 = data[7];
  const isNes2 = (flags7 & 0x0c) === 0x08;
  let mapper: number;
  let prgRomBytes: number;
  let chrRomBytes: number;

  if (isNes2) {
    mapper = (flags6 >> 4) | (flags7 & 0xf0) | ((data[8] & 0x0f) << 8);
    const prgMsb = data[9] & 0x0f;
    const chrMsb = data[9] >> 4;
    prgRomBytes = prgMsb === 0x0f ? sizeFromExponent(data[4]) : ((prgMsb << 8) | data[4]) * PRG_BANK;
    chrRomBytes = chrMsb === 0x0f ? sizeFromExponent(data[5]) : ((chrMsb << 8) | data[5]) * CHR_BANK;
  } else {
    mapper = (flags6 >> 4) | (flags7 & 0xf0);
    // Old dumps carry junk such as "DiskDude!" in bytes 7-15, which makes the
    // upper mapper nibble junk too. Deliberate: the same rule as jsnes (any of
    // bytes 8-15 set), so the mapper named here is the one the core will use.
    if (data.subarray(8, 16).some((byte) => byte !== 0)) {
      mapper &= 0x0f;
    }
    prgRomBytes = data[4] * PRG_BANK;
    chrRomBytes = data[5] * CHR_BANK;
  }

  const trainer = (flags6 & 0x04) !== 0;
  const header: InesHeader = {
    format: isNes2 ? "NES 2.0" : "iNES",
    mapper,
    prgRomBytes,
    chrRomBytes,
    battery: (flags6 & 0x02) !== 0,
    trainer,
    mirroring: (flags6 & 0x08) !== 0 ? "four-screen" : (flags6 & 0x01) !== 0 ? "vertical" : "horizontal",
  };

  if (prgRomBytes === 0) {
    return { ok: false, error: "The ROM header says it has no program data." };
  }
  const expected = HEADER_SIZE + (trainer ? TRAINER_SIZE : 0) + prgRomBytes + chrRomBytes;
  if (data.length < expected) {
    return {
      ok: false,
      error: `The ROM is truncated: its header needs ${expected} bytes but the file has ${data.length}.`,
    };
  }
  if (!SUPPORTED_MAPPERS.has(mapper)) {
    return {
      ok: false,
      error: `This game uses mapper ${mapper}, which the emulator does not support yet.`,
    };
  }
  return { ok: true, header };
}
