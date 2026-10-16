import type { ViewValue } from "../movie/expectations";

/** One documented RAM location, for the table each memory map carries. */
export interface AddressNote {
  address: string;
  meaning: string;
  source: string;
  /** How it was checked against the running game, or null if it was not. */
  verified: string | null;
}

/** A readable view of one game's state, built from EmulatorCore.peek. */
export interface GameMemoryMap {
  id: string;
  title: string;
  /**
   * SHA-256 of the ROM without its 16-byte iNES header: headers of the same
   * dump differ between collections, the PRG and CHR data do not.
   */
  romContentSha256: readonly string[];
  addresses: readonly AddressNote[];
  read(peek: (address: number) => number): ViewValue;
  /** What a CPU address holds, for reports of differing memory; null where the map says nothing. */
  nameAddress(address: number): string | null;
}
