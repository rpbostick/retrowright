// The emulator core as the UI sees it. jsnes is one implementation; later
// cores (our own CPU, PPU or APU) implement the same interface and are checked
// against it, so nothing outside src/core/ imports jsnes.

export const SCREEN_WIDTH = 256;
export const SCREEN_HEIGHT = 240;
export const AUDIO_SAMPLE_RATE = 48000;
/** NTSC NES frame rate: 1789773 CPU cycles per second / 29780.5 per frame. */
export const NES_FRAME_RATE = 60.0988;

/**
 * What a core's picture is: the player and the page size and pace it from
 * this alone, so another system's core brings its own numbers.
 */
export interface VideoDescription {
  /** The frame onFrame and picture() give, in pixels. */
  readonly width: number;
  readonly height: number;
  /**
   * The shape of one pixel on the system's own screen, as width:height:
   * 8:7 for the NES on an NTSC television, 1:1 for square pixels.
   */
  readonly pixelAspect: { readonly width: number; readonly height: number };
  /** Emulated frames per second. */
  readonly frameRate: number;
}

export const NES_VIDEO: VideoDescription = {
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  pixelAspect: { width: 8, height: 7 },
  frameRate: NES_FRAME_RATE,
};

export enum Button {
  A = "A",
  B = "B",
  Select = "Select",
  Start = "Start",
  Up = "Up",
  Down = "Down",
  Left = "Left",
  Right = "Right",
}

export const BUTTONS: readonly Button[] = [
  Button.Up,
  Button.Down,
  Button.Left,
  Button.Right,
  Button.B,
  Button.A,
  Button.Select,
  Button.Start,
];

export type Player = 1 | 2;

/** An opaque, structured-clone-safe snapshot of the whole machine. */
export type SaveState = { readonly core: string; readonly data: unknown };

export interface CoreCallbacks {
  /** One frame of the core's video size, each pixel 0xAABBGGRR (little-endian RGBA bytes). */
  onFrame(pixels: Uint32Array): void;
  onAudioSample(left: number, right: number): void;
  /** Called whenever the game writes its battery-backed cartridge RAM. */
  onBatteryRamWrite(): void;
}

/** The CPU as it stands before an instruction runs. */
export interface CpuState {
  /** The address of the instruction about to run. */
  pc: number;
  a: number;
  x: number;
  y: number;
  /** The status register, NV-BDIZC. */
  p: number;
  sp: number;
  /** CPU cycles since power-on. */
  cycle: number;
  /** -1 is the pre-render line, 0-239 the visible picture, 240 the post-render line, 241-260 vertical blank. */
  scanline: number;
  dot: number;
}

export type AccessKind = "execute" | "read" | "write";

/**
 * Tool hooks into the running CPU. A hook that returns true stops emulation
 * at the end of the current frame, not mid-instruction: the frame finishes
 * and onStop names the first hit.
 */
export interface DebugHooks {
  /** Called before each instruction; return true to stop after this frame. */
  onInstruction?(state: CpuState): boolean | void;
  /**
   * Called for data reads and writes in the ranges given (stack pushes and
   * pulls included); operand and opcode fetches belong to execution and are
   * left out, as FCEUX and Mesen do. pc is the instruction's address. In
   * JsnesCore, OAM DMA's reads of the sprite page ($4014) are not reported.
   */
  onAccess?(kind: Exclude<AccessKind, "execute">, address: number, value: number, pc: number): boolean | void;
  /**
   * Inclusive [first, last] CPU address ranges onAccess watches; a range in
   * work RAM also matches its mirrors. Without it, every address is watched.
   */
  accessRanges?: readonly (readonly [number, number])[];
  /** Called once at the end of a frame in which a hook returned true, with its first hit. */
  onStop?(stop: DebugStop): void;
}

/** The first hook hit that asked to stop, with the CPU state of its instruction. */
export interface DebugStop {
  kind: AccessKind;
  /** The instruction's address for "execute", the data address otherwise. */
  address: number;
  /** The byte read or written; null for "execute". */
  value: number | null;
  state: CpuState;
}

/** Copies of what the PPU sees now, in the NES's own terms rather than a core's colours. */
export interface PpuSnapshot {
  /** Both pattern tables, $0000-$1FFF of PPU memory (8192 bytes). */
  patterns: Uint8Array;
  /** The four nametables at $2000, $2400, $2800 and $2C00 after mirroring, attributes included (4096 bytes). */
  nametables: Uint8Array;
  /** Sprite memory (256 bytes). */
  oam: Uint8Array;
  /** The 32 palette entries at $3F00-$3F1F as NES colour indices 0-63. */
  palette: Uint8Array;
}

export interface EmulatorCore {
  /** The implementation, e.g. "jsnes"; recorded in movies. */
  readonly name: string;
  /** Its version, e.g. "2.1.0"; a save state only loads into the same name and version. */
  readonly version: string;
  /** Its picture's size, pixel shape and frame rate. */
  readonly video: VideoDescription;
  /** Throws when the ROM cannot run on this core. */
  load(rom: Uint8Array): void;
  /** Runs one frame of emulation and emits its picture and samples. */
  frame(): void;
  reset(): void;
  buttonDown(player: Player, button: Button): void;
  buttonUp(player: Player, button: Button): void;
  /** A copy of the battery-backed RAM, or null when the cartridge has none. */
  batteryRam(): Uint8Array | null;
  restoreBatteryRam(data: Uint8Array): void;
  saveState(): SaveState;
  loadState(state: SaveState): void;
  /**
   * A copy of the picture of the last frame run, in onFrame's format; after
   * loadState, the picture of the frame the state was saved on.
   */
  picture(): Uint32Array;
  /**
   * Reads one byte of the CPU address space without the side effects a CPU
   * read can have: work RAM $0000-$1FFF (mirrored every 2 KB) and the
   * cartridge at $6000-$FFFF. Throws for $2000-$5FFF, where reads reach
   * PPU and APU registers that change state when read.
   */
  peek(address: number): number;
  /**
   * Writes one byte of RAM as a CPU write would leave it, for the console:
   * work RAM $0000-$1FFF (mirrored every 2 KB) and cartridge RAM
   * $6000-$7FFF. Throws elsewhere: registers change state when written, and
   * ROM is pokeRom's. Optional: a core without it still plays.
   */
  poke?(address: number, value: number): void;
  /**
   * Sets the tools' hooks, or removes them with null. Hooks are kept across
   * load, reset and loadState, and are never part of a save state or movie.
   * Optional, like the two below: a core without them still plays and replays.
   */
  setDebugHooks?(hooks: DebugHooks | null): void;
  /** The PRG ROM offset mapped at a CPU address now, or null for RAM and registers. */
  romOffset?(address: number): number | null;
  /**
   * Writes one byte of PRG ROM at a CPU address $8000-$FFFF, into the ROM's
   * own data as well as where it is mapped now, so the change holds when its
   * bank is switched out and back, after reset and after loadState, until
   * another ROM is loaded. Throws below $8000. For live tuning of a game.
   */
  pokeRom?(address: number, value: number): void;
  ppuSnapshot?(): PpuSnapshot;
}
