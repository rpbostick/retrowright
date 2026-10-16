// Types for the parts of Rom Patcher JS's IPS module that src/patch uses.

import type BinFile from "./BinFile.js";

declare class IPS {
  static readonly MAGIC: string;
  static fromFile(file: BinFile): IPS;
  static buildFromRoms(original: BinFile, modified: BinFile): IPS;
  apply(romFile: BinFile): BinFile;
  export(fileName?: string): BinFile;
}

export default IPS;
