// What a game brings to the developer console: values it names (read and
// written by name with get and set) and commands of its own. A game's table
// comes from its memory map (src/games/<game>/) or from a game profile found
// for it at run time (gameProfile.ts), so the console's code holds no game's
// addresses.

/** The open game's memory as the console's commands reach it. */
export interface ConsoleMemory {
  peek(address: number): number;
  /** Writes RAM; throws for an address that is not RAM, or while a movie records or plays. */
  poke(address: number, value: number): void;
  /** The 32 palette entries the PPU holds now, as NES colour indices; null when the core cannot show them. */
  palette(): Uint8Array | null;
}

export interface NamedValue {
  name: string;
  /** One plain sentence: what the value is, and its unit where it has one. */
  description: string;
  min: number;
  max: number;
  read(memory: ConsoleMemory): number;
  /** Absent for a value that can be read but not set. */
  write?(memory: ConsoleMemory, value: number): void;
  /** The value as it reads, e.g. "1 (B taps)"; the number alone when absent. */
  show?(value: number): string;
}

/** Resolves once the game has run that many more frames. */
export type FrameWaiter = (frames: number) => Promise<void>;

export interface GameCommand {
  name: string;
  /** The command as typed, e.g. "warp <world>-<level>". */
  usage: string;
  /** One or two plain sentences for help. */
  help: string;
  /** The answer to show; throws, with a plain sentence, when it cannot be done. */
  run(args: readonly string[], memory: ConsoleMemory, wait: FrameWaiter): string | Promise<string>;
}

export interface GameConsoleTable {
  /** The game, as help names it. */
  title: string;
  values: readonly NamedValue[];
  commands: readonly GameCommand[];
}

export interface RamValueSpec {
  name: string;
  description: string;
  address: number;
  /** Little-endian bytes; 1 by default. */
  bytes?: 1 | 2 | 3;
  /** Added to the stored number to show it, e.g. 1 for a count the game keeps from 0. */
  shownOffset?: number;
  /** A one-byte value read as -128 to 127. */
  signed?: boolean;
  min?: number;
  max?: number;
  readOnly?: boolean;
}

/** A value kept in RAM as `bytes` little-endian bytes at `address`. */
export function ramValue(spec: RamValueSpec): NamedValue {
  const bytes = spec.bytes ?? 1;
  const offset = spec.shownOffset ?? 0;
  if (spec.signed && bytes !== 1) throw new Error(`${spec.name}: only a one-byte value can be signed.`);
  const lowest = (spec.signed ? -0x80 : 0) + offset;
  const highest = (spec.signed ? 0x7f : 256 ** bytes - 1) + offset;
  const value: NamedValue = {
    name: spec.name,
    description: spec.description,
    min: spec.min ?? lowest,
    max: spec.max ?? highest,
    read(memory) {
      let stored = 0;
      for (let byte = 0; byte < bytes; byte++) stored += memory.peek(spec.address + byte) * 256 ** byte;
      if (spec.signed && stored >= 0x80) stored -= 0x100;
      return stored + offset;
    },
  };
  if (!spec.readOnly) {
    value.write = (memory, shown) => {
      let stored = shown - offset;
      if (spec.signed && stored < 0) stored += 0x100;
      for (let byte = 0; byte < bytes; byte++) memory.poke(spec.address + byte, Math.floor(stored / 256 ** byte) % 256);
    };
  }
  return value;
}
