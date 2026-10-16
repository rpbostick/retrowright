// Types for the parts of Rom Patcher JS's BPS module that src/patch uses.

import type BinFile from "./BinFile.js";

/** type 0 source read, 1 target read (with its bytes), 2 source copy and 3 target copy (each with its signed relative offset). */
interface BPSAction {
  type: number;
  length: number;
  bytes?: number[];
  relativeOffset?: number;
}

declare class BPS {
  actions: BPSAction[];
  sourceSize: number;
  targetSize: number;
  metaData: string;
  sourceChecksum: number;
  targetChecksum: number;
  patchChecksum: number;
  static readonly MAGIC: string;
  static fromFile(file: BinFile): BPS;
  static buildFromRoms(original: BinFile, modified: BinFile, deltaMode?: boolean): BPS;
  apply(romFile: BinFile, validate?: boolean): BinFile;
  calculateFileChecksum(): number;
  export(fileName?: string): BinFile;
}

export default BPS;
