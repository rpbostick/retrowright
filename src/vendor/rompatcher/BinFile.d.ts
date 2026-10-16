// Types for the parts of Rom Patcher JS's BinFile that src/patch uses.

declare class BinFile {
  /** Deliberate: a typed array source is read through its whole buffer, so pass one that owns its buffer. */
  constructor(source: Uint8Array | ArrayBuffer | number);
  readonly fileSize: number;
  readonly _u8array: Uint8Array;
  hashCRC32(start?: number, len?: number): number;
}

export default BinFile;
