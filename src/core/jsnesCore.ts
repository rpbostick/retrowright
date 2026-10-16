import { Controller, NES } from "jsnes";
import type { ButtonKey } from "jsnes";
import { parseInes } from "../rom/ines";
import { CpuHookSet, PrgBankMap, ppuSnapshot, type JsnesMachine } from "./jsnesDebug";
import { PadLatch, type JsnesPadMachine } from "./jsnesPads";
import {
  AUDIO_SAMPLE_RATE,
  Button,
  NES_VIDEO,
  type CoreCallbacks,
  type DebugHooks,
  type EmulatorCore,
  type Player,
  type PpuSnapshot,
  type SaveState,
} from "./types";

const CORE_NAME = "jsnes";
const CORE_VERSION = "2.1.0";
const CORE_ID = `${CORE_NAME}-${CORE_VERSION}`;
const BATTERY_RAM_START = 0x6000;
const BATTERY_RAM_SIZE = 0x2000;
const PRG_BANK_SIZE = 0x4000;

const BUTTON_KEYS: Record<Button, ButtonKey> = {
  [Button.A]: Controller.BUTTON_A,
  [Button.B]: Controller.BUTTON_B,
  [Button.Select]: Controller.BUTTON_SELECT,
  [Button.Start]: Controller.BUTTON_START,
  [Button.Up]: Controller.BUTTON_UP,
  [Button.Down]: Controller.BUTTON_DOWN,
  [Button.Left]: Controller.BUTTON_LEFT,
  [Button.Right]: Controller.BUTTON_RIGHT,
};

/**
 * A copy of a jsnes state that keeps, uncopied, each plain array whose
 * counterpart in the live machine (`live`, walked alongside) is a typed
 * array: jsnes made those afresh in toJSON and copies them in fromJSON.
 */
function copyUnshared(value: unknown, live: unknown): unknown {
  const liveAt = (key: string | number) => (live !== null && typeof live === "object" ? (live as Record<string | number, unknown>)[key] : undefined);
  if (Array.isArray(value)) {
    if (ArrayBuffer.isView(live)) return value;
    return value.map((item, index) => copyUnshared(item, liveAt(index)));
  }
  if (value !== null && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = copyUnshared(item, liveAt(key));
    return copy;
  }
  return value;
}

export class JsnesCore implements EmulatorCore {
  readonly name = CORE_NAME;
  readonly version = CORE_VERSION;
  readonly video = NES_VIDEO;
  private readonly nes: NES;
  private hasBattery = false;
  private loaded = false;
  private readonly banks = new PrgBankMap();
  private hooks: CpuHookSet | null = null;
  private readonly pads = new PadLatch();
  /** Bytes written by pokeRom since the ROM was loaded, by PRG offset. */
  private readonly romPokes = new Map<number, number>();

  constructor(callbacks: CoreCallbacks) {
    this.nes = new NES({
      onFrame: callbacks.onFrame,
      onAudioSample: callbacks.onAudioSample,
      onBatteryRamWrite: () => callbacks.onBatteryRamWrite(),
      sampleRate: AUDIO_SAMPLE_RATE,
    });
  }

  load(rom: Uint8Array): void {
    const parsed = parseInes(rom);
    if (!parsed.ok) throw new Error(parsed.error);
    this.nes.loadROM(rom);
    this.hasBattery = parsed.header.battery;
    this.loaded = true;
    this.romPokes.clear();
    this.attachToMachine();
  }

  frame(): void {
    this.requireLoaded();
    this.nes.frame();
    const stop = this.hooks?.takeStop();
    if (stop) this.hooks!.hooks.onStop?.(stop);
  }

  /**
   * jsnes's reloadROM builds a new CPU with zeroed memory, which would wipe
   * cartridge RAM; a real Reset keeps it, so the battery RAM is carried over.
   */
  reset(): void {
    this.requireLoaded();
    const kept = this.batteryRam();
    this.nes.reloadROM();
    this.attachToMachine();
    if (kept) this.restoreBatteryRam(kept);
  }

  buttonDown(player: Player, button: Button): void {
    this.pads.set(player, BUTTON_KEYS[button], true);
  }

  buttonUp(player: Player, button: Button): void {
    this.pads.set(player, BUTTON_KEYS[button], false);
  }

  batteryRam(): Uint8Array | null {
    this.requireLoaded();
    if (!this.hasBattery) return null;
    return Uint8Array.from(this.memory().slice(BATTERY_RAM_START, BATTERY_RAM_START + BATTERY_RAM_SIZE));
  }

  /**
   * jsnes 2.1.0 has no public call for this. Its mappers keep cartridge RAM
   * at $6000-$7FFF of `cpu.mem` (Mapper0.write stores there before calling
   * onBatteryRamWrite), and Mapper0.loadBatteryRam would copy a saved image
   * into that range, but ROM.batteryRam is only a boolean flag so that path
   * never runs. Writing the range after loadROM, before the first frame, has
   * the same effect. MMC5 (mapper 5) also banks PRG-RAM in its own array;
   * only its first 8 KB bank is covered this way.
   */
  restoreBatteryRam(data: Uint8Array): void {
    this.requireLoaded();
    if (!this.hasBattery) throw new Error("This game has no battery-backed RAM to restore.");
    if (data.length !== BATTERY_RAM_SIZE) {
      throw new Error(`Battery RAM must be ${BATTERY_RAM_SIZE} bytes, got ${data.length}.`);
    }
    const memory = this.memory();
    for (let offset = 0; offset < BATTERY_RAM_SIZE; offset++) {
      memory[BATTERY_RAM_START + offset] = data[offset];
    }
  }

  // Deliberate: both directions copy. jsnes's toJSON returns its plain
  // arrays (controller state, and others) by reference and fromJSON adopts
  // them, so without a copy a kept state would change as the game runs.
  saveState(): SaveState {
    this.requireLoaded();
    return { core: CORE_ID, data: structuredClone(this.nes.toJSON()) };
  }

  loadState(state: SaveState): void {
    this.requireLoaded();
    if (state.core !== CORE_ID) {
      throw new Error(`This save state was made by ${state.core}, not ${CORE_ID}.`);
    }
    this.nes.fromJSON(structuredClone(state.data) as ReturnType<NES["toJSON"]>);
    this.attachToMachine();
  }

  /**
   * saveState and loadState for a tool that keeps many states and loads each
   * several times (the search bot): the same state, made in about 60% of the
   * time and loaded in about a twentieth, as measured on a mapper 0 game).
   * It still never shares an array with the running machine. jsnes's toJSON
   * turns each typed array into a new plain array and fromJSON copies a plain
   * array into its typed array in place, so those arrays, nearly all of a
   * state's size, need no clone; every other array and object in the state is
   * copied, as saveState copies it all. src/core/jsnesCore.test.ts checks it
   * on a synthetic mapper 0 ROM; it has also been checked on a mapper 0 game
   * and an MMC3 (mapper 4) build, and another mapper's state is not tested.
   */
  saveStateQuick(): SaveState {
    this.requireLoaded();
    return { core: CORE_ID, data: copyUnshared(this.nes.toJSON(), this.nes) };
  }

  loadStateQuick(state: SaveState): void {
    this.requireLoaded();
    if (state.core !== CORE_ID) {
      throw new Error(`This save state was made by ${state.core}, not ${CORE_ID}.`);
    }
    this.nes.fromJSON(copyUnshared(state.data, this.nes) as ReturnType<NES["toJSON"]>);
    this.attachToMachine();
  }

  /**
   * jsnes draws each frame into ppu.buffer (the array onFrame receives) and
   * clears it only when the next frame starts, so between frames it holds the
   * last picture. The buffer is part of jsnes's save state, so a loaded state
   * brings back the picture it was saved on.
   */
  picture(): Uint32Array {
    this.requireLoaded();
    return Uint32Array.from(this.machine().ppu.buffer);
  }

  /**
   * jsnes keeps work RAM at cpu.mem[$0000-$07FF] and the cartridge's RAM and
   * current PRG banks at cpu.mem[$6000-$FFFF] (its mappers copy banks there),
   * which is what its own Mapper0.load returns for those ranges.
   */
  peek(address: number): number {
    this.requireLoaded();
    if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
      throw new RangeError(`Address ${address} is outside the CPU address space $0000-$FFFF.`);
    }
    if (address < 0x2000) return this.memory()[address & 0x7ff];
    if (address >= 0x6000) return this.memory()[address];
    throw new RangeError(`$${address.toString(16).toUpperCase()} is a register or open bus; peek reads RAM and cartridge space only.`);
  }

  /** jsnes keeps work RAM and cartridge RAM in cpu.mem, as peek reads them; a write there is what the CPU's own store leaves. */
  poke(address: number, value: number): void {
    this.requireLoaded();
    if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`${value} is not a byte (0-255).`);
    if (Number.isInteger(address) && address >= 0 && address < 0x2000) this.memory()[address & 0x7ff] = value;
    else if (Number.isInteger(address) && address >= BATTERY_RAM_START && address < BATTERY_RAM_START + BATTERY_RAM_SIZE) this.memory()[address] = value;
    else throw new RangeError(`$${address.toString(16).toUpperCase()} is not RAM; poke writes $0000-$1FFF and $6000-$7FFF.`);
  }

  setDebugHooks(hooks: DebugHooks | null): void {
    const next = hooks ? new CpuHookSet(hooks) : null;
    this.hooks?.remove();
    this.hooks = next;
    if (next && this.loaded) next.install(this.machine());
  }

  romOffset(address: number): number | null {
    this.requireLoaded();
    return this.banks.romOffset(address);
  }

  /**
   * jsnes keeps the PRG in 16 KB banks in rom.rom and its mappers copy the
   * banks in use into cpu.mem at $8000-$FFFF, again on each bank switch. So
   * the byte goes into its bank and into every slot that maps it now. reset
   * builds rom.rom afresh from the loaded file and loadState brings back the
   * state's cpu.mem, so both write the kept bytes again.
   */
  pokeRom(address: number, value: number): void {
    this.requireLoaded();
    if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`${value} is not a byte (0-255).`);
    const offset = this.banks.romOffset(address);
    if (offset === null) throw new RangeError(`$${address.toString(16).toUpperCase()} is not cartridge ROM; pokeRom writes PRG ROM at $8000-$FFFF.`);
    this.romPokes.set(offset, value);
    this.writeRomByte(offset, value);
  }

  ppuSnapshot(): PpuSnapshot {
    this.requireLoaded();
    return ppuSnapshot(this.machine().ppu);
  }

  /** The 64 NES colours in picture()'s format, so a tool can colour a ppuSnapshot's palette indices as the picture does. */
  colours(): Uint32Array {
    const table = this.machine().ppu.palTable;
    return Uint32Array.from({ length: 64 }, (_, index) => table.getEntry(index));
  }

  /**
   * jsnes's loadROM, reloadROM and fromJSON each build a new CPU, PPU and
   * mapper, so the bank map, the pad latch and any hooks move onto the new ones.
   */
  private attachToMachine(): void {
    const machine = this.machine();
    this.banks.attach(machine, new Set(this.romPokes.keys()));
    this.pads.attach(this.nes as unknown as JsnesPadMachine);
    for (const [offset, value] of this.romPokes) this.writeRomByte(offset, value);
    if (this.hooks) {
      this.hooks.remove();
      this.hooks.install(machine);
    }
  }

  private writeRomByte(offset: number, value: number): void {
    const machine = this.machine();
    machine.rom.rom[Math.floor(offset / PRG_BANK_SIZE)][offset % PRG_BANK_SIZE] = value;
    for (const address of this.banks.addressesOf(offset)) machine.cpu.mem[address] = value;
  }

  private machine(): JsnesMachine {
    return this.nes as unknown as JsnesMachine;
  }

  private memory(): number[] | Uint8Array {
    return this.machine().cpu.mem;
  }

  private requireLoaded(): void {
    if (!this.loaded) throw new Error("No game is loaded.");
  }
}
