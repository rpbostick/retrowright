import { JsnesCore } from "../src/core/jsnesCore";
import type { EmulatorCore } from "../src/core/types";
import { BATTLE_RNG_STATE } from "../src/games/ff1/memoryMap";
import type { Movie } from "../src/movie/format";
import { bootMovie, MovieRunner } from "../src/movie/runner";

// Power-on RAM contents differ between emulators and consoles; a TAS made on
// FCEUX starts from FCEUX's. These put a jsnes core in another start state
// before the first frame, for measuring which start keeps a TAS in step.

const WORK_RAM_BYTES = 0x800;

/** "jsnes" keeps jsnes's own power-on RAM; the others overwrite it. */
export const WORK_RAM_FILLS = ["jsnes", "zeros", "fceux"] as const;
export type WorkRamFill = (typeof WORK_RAM_FILLS)[number];

/** FCEUX's FCEU_MemoryRand: despite the name, a fixed pattern of four $00 then four $FF. */
export function fceuxPowerOnPattern(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index & 4 ? 0xff : 0x00));
}

export function initialWorkRam(fill: Exclude<WorkRamFill, "jsnes">): Uint8Array {
  return fill === "zeros" ? new Uint8Array(WORK_RAM_BYTES) : fceuxPowerOnPattern(WORK_RAM_BYTES);
}

/**
 * EmulatorCore has no call to write work RAM, so this goes through a save
 * state and relies on jsnes's state shape (cpu.mem, the whole CPU address
 * space). It throws for any other core rather than guess at its layout.
 */
export function fillWorkRam(core: EmulatorCore, bytes: Uint8Array): void {
  const state = core.saveState();
  const data = state.data as { cpu?: { mem?: { [index: number]: number } } };
  if (core.name !== "jsnes" || !data.cpu?.mem) throw new Error(`Cannot fill work RAM on ${core.name}: only jsnes's save state is known to hold cpu.mem.`);
  for (let address = 0; address < bytes.length; address++) data.cpu.mem[address] = bytes[address];
  core.loadState(state);
}

export interface TasStart {
  fill: WorkRamFill;
  /** Final Fantasy's battle RNG state ($688A) at power-on, in otherwise cleared battery RAM. */
  battleRng: number;
}

/** A jsnes core booted where `movie` starts, then put in `start`, with a runner for the movie. */
export function bootAt(rom: Uint8Array, movie: Movie, start: TasStart, onFrame: (pixels: Uint32Array) => void = () => {}): { core: EmulatorCore; runner: MovieRunner } {
  const core = new JsnesCore({ onFrame, onAudioSample() {}, onBatteryRamWrite() {} });
  bootMovie(core, rom, movie.start);
  if (start.fill !== "jsnes") fillWorkRam(core, initialWorkRam(start.fill));
  const battery = core.batteryRam();
  if (!battery) throw new Error("Final Fantasy has battery RAM; the core reported none.");
  battery[BATTLE_RNG_STATE - 0x6000] = start.battleRng;
  core.restoreBatteryRam(battery);
  return { core, runner: new MovieRunner(core, movie) };
}
