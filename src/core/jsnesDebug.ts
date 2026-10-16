import type { AccessKind, CpuState, DebugHooks, DebugStop, PpuSnapshot } from "./types";

// Debug hooks for jsnes 2.1.0, added from outside by replacing methods on the
// CPU and mapper instances, as jsnes's own Game Genie swaps loadFromCartridge.
// The CPU wrappers exist only while hooks are set, so a plain run pays nothing.

/** The parts of jsnes's CPU the hooks read or wrap; its typings leave them out. */
export interface JsnesCpu {
  mem: number[] | Uint8Array;
  REG_ACC: number;
  REG_X: number;
  REG_Y: number;
  REG_SP: number;
  /** One less than the address of the next opcode. */
  REG_PC: number;
  F_INTERRUPT: number;
  irqRequested: boolean;
  irqType: number;
  nmiImmediate: boolean;
  instrBusCycles: number;
  _cpuCycleBase: number;
  getStatus(): number;
  emulate(): number;
  load(address: number): number;
  write(address: number, value: number): void;
  push(value: number): void;
  pull(): number;
  /** Runs a taken branch, with its dummy reads; jsnes's opaddr is REG_PC. */
  _takeBranch(opaddr: number, target: number): number;
  loadFromCartridge(address: number): number;
}

export interface JsnesPpu {
  vramMem: number[] | Uint8Array;
  vramMirrorTable: number[] | Uint16Array;
  spriteMem: number[] | Uint8Array;
  scanline: number;
  curX: number;
  buffer: ArrayLike<number>;
  /** The 64 NES colours as 0x00BBGGRR, what the picture's pixels are made of. */
  palTable: { getEntry(index: number): number };
}

export interface JsnesMapper {
  loadRomBank(bank: number, address: number): void;
  load8kRomBank(bank8k: number, address: number): void;
}

export interface JsnesMachine {
  cpu: JsnesCpu;
  ppu: JsnesPpu;
  mmap: JsnesMapper | null;
  rom: { romCount: number; rom: (number[] | Uint8Array)[] };
}

const PRG_START = 0x8000;
const SLOT_SIZE = 0x2000;
const PRG_BANK_SIZE = 0x4000;
const SLOTS = 4;
/** jsnes's irqType for reset; 0 is a normal IRQ (cpu.js IRQ_NORMAL, IRQ_RESET). */
const IRQ_NORMAL = 0;
const IRQ_RESET = 2;
const INTERRUPT_CYCLES = 7;
/** jsnes counts the 20 vertical-blank lines from 0 and starts the picture at 21. */
const JSNES_PRE_RENDER_LINE = 20;
const JSNES_LINES_BEFORE_PICTURE = 21;
const VBLANK_FIRST_LINE = 241;
const CPU_METHODS = ["emulate", "load", "write", "push", "pull", "_takeBranch"] as const;
/** Mappers whose loadRomBank and load8kRomBank a PrgBankMap has wrapped. */
const WRAPPED_MAPPERS = new WeakSet<JsnesMapper>();

/**
 * Which 8 KB of PRG ROM sits in each CPU slot $8000, $A000, $C000 and $E000.
 * jsnes's mappers copy banks into cpu.mem and keep no record, so the map
 * wraps loadRomBank and load8kRomBank on the mapper instance (load32kRomBank
 * goes through loadRomBank). jsnes loads the first banks inside loadROM and
 * restores a save state's banks with cpu.mem, both before a wrapper can be
 * in place, so after either the map is seeded by matching each slot's bytes
 * against the ROM's banks. Two byte-identical banks match the lower one.
 */
export class PrgBankMap {
  private readonly offsets: (number | null)[] = new Array<number | null>(SLOTS).fill(null);

  /**
   * Starts tracking a freshly created mapper; its banks are already in
   * cpu.mem. `ignored` names PRG offsets left out of the seeding match: bytes
   * changed in the ROM after a save state was made, which the state's copy
   * in cpu.mem does not have yet.
   */
  attach(machine: JsnesMachine, ignored: ReadonlySet<number> = new Set()): void {
    const mapper = machine.mmap;
    if (!mapper) throw new Error("jsnes has no mapper; load a ROM first.");
    // jsnes 2.1.0 makes a new mapper on each load and loadState; one that reused it would stack a wrapper per call.
    if (WRAPPED_MAPPERS.has(mapper)) throw new Error("This jsnes mapper's bank loads are already wrapped; jsnes reused a mapper.");
    WRAPPED_MAPPERS.add(mapper);
    const { rom } = machine;
    const offsets = this.offsets;
    const loadRomBank = mapper.loadRomBank;
    const load8kRomBank = mapper.load8kRomBank;
    mapper.loadRomBank = function (this: JsnesMapper, bank: number, address: number) {
      loadRomBank.call(this, bank, address);
      const start = (bank % rom.romCount) * PRG_BANK_SIZE;
      offsets[slotOf(address)] = start;
      offsets[slotOf(address) + 1] = start + SLOT_SIZE;
    };
    mapper.load8kRomBank = function (this: JsnesMapper, bank8k: number, address: number) {
      load8kRomBank.call(this, bank8k, address);
      offsets[slotOf(address)] = (Math.floor(bank8k / 2) % rom.romCount) * PRG_BANK_SIZE + (bank8k % 2) * SLOT_SIZE;
    };
    for (let slot = 0; slot < SLOTS; slot++) offsets[slot] = matchingOffset(machine, slot, ignored);
  }

  /** The CPU addresses where a PRG offset is mapped now: none, one, or more when a bank is mirrored. */
  addressesOf(offset: number): number[] {
    const addresses: number[] = [];
    this.offsets.forEach((start, slot) => {
      if (start !== null && offset >= start && offset < start + SLOT_SIZE) addresses.push(PRG_START + slot * SLOT_SIZE + offset - start);
    });
    return addresses;
  }

  romOffset(address: number): number | null {
    if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
      throw new RangeError(`Address ${address} is outside the CPU address space $0000-$FFFF.`);
    }
    if (address < PRG_START) return null;
    const slot = slotOf(address);
    const start = this.offsets[slot];
    if (start === null) throw new Error(`The PRG bank at $${(PRG_START + slot * SLOT_SIZE).toString(16).toUpperCase()} matches no bank of the ROM.`);
    return start + (address % SLOT_SIZE);
  }
}

function slotOf(address: number): number {
  return (address - PRG_START) >> 13;
}

function matchingOffset(machine: JsnesMachine, slot: number, ignored: ReadonlySet<number>): number | null {
  const mem = machine.cpu.mem;
  const base = PRG_START + slot * SLOT_SIZE;
  for (let bank = 0; bank < machine.rom.romCount; bank++) {
    const data = machine.rom.rom[bank];
    for (let half = 0; half < 2; half++) {
      const start = bank * PRG_BANK_SIZE + half * SLOT_SIZE;
      let index = 0;
      while (index < SLOT_SIZE && (mem[base + index] === data[half * SLOT_SIZE + index] || ignored.has(start + index))) index++;
      if (index === SLOT_SIZE) return bank * PRG_BANK_SIZE + half * SLOT_SIZE;
    }
  }
  return null;
}

/**
 * The hooks installed on one jsnes CPU. Where they go (jsnes 2.1.0, cpu.js):
 * the execute hook runs before the opcode fetch in emulate, with PC =
 * REG_PC + 1; data hooks wrap load, write, push and pull, the only paths for
 * data reads and writes but one: OAM DMA ($4014) copies 256 bytes out of
 * cpu.mem directly, so its reads of the sprite page are not reported.
 * loadDirect, load16bit and loadFromCartridge carry
 * operand and opcode fetches and are left alone. load also carries two
 * fetch-side reads, which are filtered out: immediate operands and a taken
 * branch's dummy reads. Indexed addressing's dummy reads stay in, as reads
 * of the data address's page.
 */
export class CpuHookSet {
  private readonly mask = new Uint8Array(0x10000);
  private stop: DebugStop | null = null;
  /** The address of the instruction running now; accesses report it. */
  private pc = 0;
  private installedOn: JsnesCpu | null = null;

  constructor(readonly hooks: DebugHooks) {
    const ranges = hooks.accessRanges;
    if (!ranges) {
      this.mask.fill(1);
      return;
    }
    for (const [first, last] of ranges) {
      if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last > 0xffff || first > last) {
        throw new RangeError(`Access range [${first}, ${last}] is not a range of CPU addresses $0000-$FFFF.`);
      }
      for (let address = first; address <= last; address++) {
        this.mask[address] = 1;
        // Work RAM repeats every 2 KB up to $1FFF.
        if (address < 0x2000) for (let mirror = address & 0x7ff; mirror < 0x2000; mirror += 0x800) this.mask[mirror] = 1;
      }
    }
  }

  install(machine: JsnesMachine): void {
    if (this.installedOn) throw new Error("These hooks are already installed.");
    const { cpu, ppu } = machine;
    for (const name of CPU_METHODS) {
      if (Object.hasOwn(cpu, name)) throw new Error(`jsnes's cpu.${name} is already replaced on this instance.`);
    }
    const { onInstruction, onAccess } = this.hooks;
    if (!onInstruction && !onAccess) return;
    this.installedOn = cpu;
    const state = (pc: number, cycle: number): CpuState => cpuState(cpu, ppu, pc, cycle);

    const emulate = cpu.emulate;
    const beforeInstruction = (pc: number, cycle: number) => {
      this.pc = pc;
      if (onInstruction) {
        const now = state(pc, cycle);
        if (onInstruction(now) === true) this.hit("execute", pc, null, now);
      }
    };
    cpu.emulate = () => {
      // An NMI taken at once runs no instruction.
      if (cpu.nmiImmediate) return emulate.call(cpu);
      if (cpu.irqRequested) return this.emulateAfterInterrupt(cpu, emulate, beforeInstruction);
      beforeInstruction(cpu.REG_PC + 1, cpu._cpuCycleBase);
      return emulate.call(cpu);
    };

    if (!onAccess) return;
    const mask = this.mask;
    const access = (kind: Exclude<AccessKind, "execute">, address: number, value: number) => {
      if (onAccess(kind, address, value, this.pc) === true) this.hit(kind, address, value, state(this.pc, cpu._cpuCycleBase + cpu.instrBusCycles));
    };
    const { load, write, push, pull, _takeBranch: takeBranch } = cpu;
    let branching = false;
    cpu.load = (address) => {
      const value = load.call(cpu, address);
      // An immediate operand is read through load at the instruction's address + 1.
      if (mask[address] && !branching && address !== ((this.pc + 1) & 0xffff)) access("read", address, value);
      return value;
    };
    cpu.write = (address, value) => {
      write.call(cpu, address, value);
      if (mask[address]) access("write", address, value);
    };
    cpu.push = (value) => {
      const address = 0x100 | cpu.REG_SP;
      push.call(cpu, value);
      if (mask[address]) access("write", address, value);
    };
    cpu.pull = () => {
      const value = pull.call(cpu);
      const address = 0x100 | cpu.REG_SP;
      if (mask[address]) access("read", address, value);
      return value;
    };
    // A taken branch's dummy reads of the code after it also go through load.
    cpu._takeBranch = (opaddr, target) => {
      branching = true;
      try {
        return takeBranch.call(cpu, opaddr, target);
      } finally {
        branching = false;
      }
    };
  }

  /**
   * Deletes the instance methods so the prototype's apply again, last added
   * first so V8 can step back through the shapes it made rather than turning
   * the CPU object into a slower dictionary.
   */
  remove(): void {
    const cpu = this.installedOn;
    if (!cpu) return;
    for (const name of [...CPU_METHODS].reverse()) {
      if (Object.hasOwn(cpu, name)) delete (cpu as Partial<JsnesCpu>)[name];
    }
    this.installedOn = null;
  }

  /** The first hit that asked to stop since the last call, if any. */
  takeStop(): DebugStop | null {
    const stop = this.stop;
    this.stop = null;
    return stop;
  }

  private hit(kind: AccessKind, address: number, value: number | null, state: CpuState): void {
    if (!this.stop) this.stop = { kind, address, value, state };
  }

  /**
   * jsnes services a pending IRQ or reset inside emulate, before the fetch,
   * which moves PC to the vector. So the execute hook waits for the opcode
   * fetch itself: the loadFromCartridge call made with no bus cycle yet in
   * this instruction, at REG_PC + 1. Interrupts are rare, so the fetch is
   * only watched for these calls; Game Genie's own loadFromCartridge swap is
   * put back as it was.
   */
  private emulateAfterInterrupt(cpu: JsnesCpu, emulate: () => number, beforeInstruction: (pc: number, cycle: number) => void): number {
    const taken = cpu.irqType === IRQ_RESET || (cpu.irqType === IRQ_NORMAL && cpu.F_INTERRUPT === 0);
    const cycle = cpu._cpuCycleBase + (taken ? INTERRUPT_CYCLES : 0);
    const ownLoader = Object.hasOwn(cpu, "loadFromCartridge");
    const loader = cpu.loadFromCartridge;
    const restore = () => {
      if (ownLoader) cpu.loadFromCartridge = loader;
      else delete (cpu as Partial<JsnesCpu>).loadFromCartridge;
    };
    let watching = true;
    cpu.loadFromCartridge = (address) => {
      if (cpu.instrBusCycles === 0 && address === cpu.REG_PC + 1) {
        watching = false;
        restore();
        beforeInstruction(address, cycle);
      }
      return loader.call(cpu, address);
    };
    try {
      return emulate.call(cpu);
    } finally {
      if (watching) restore();
    }
  }
}

function cpuState(cpu: JsnesCpu, ppu: JsnesPpu, pc: number, cycle: number): CpuState {
  const line = ppu.scanline;
  return {
    pc,
    a: cpu.REG_ACC,
    x: cpu.REG_X,
    y: cpu.REG_Y,
    p: cpu.getStatus(),
    sp: cpu.REG_SP,
    cycle,
    scanline: line < JSNES_PRE_RENDER_LINE ? line + VBLANK_FIRST_LINE : line - JSNES_LINES_BEFORE_PICTURE,
    dot: ppu.curX,
  };
}

/**
 * jsnes keeps pattern tables at vramMem[$0000-$1FFF] (mappers copy CHR banks
 * there), nametables at $2000-$2FFF behind vramMirrorTable, and palette RAM
 * at $3F00-$3F1F as the colour indices written ($3F10 and its kin are stored
 * at both addresses). Its imgPalette and sprPalette are RGB, so they are not used.
 */
export function ppuSnapshot(ppu: JsnesPpu): PpuSnapshot {
  const nametables = new Uint8Array(0x1000);
  for (let index = 0; index < nametables.length; index++) nametables[index] = ppu.vramMem[ppu.vramMirrorTable[0x2000 + index]];
  const palette = new Uint8Array(32);
  for (let index = 0; index < palette.length; index++) palette[index] = ppu.vramMem[0x3f00 + index] & 0x3f;
  return {
    patterns: Uint8Array.from(ppu.vramMem.slice(0, 0x2000)),
    nametables,
    oam: Uint8Array.from(ppu.spriteMem),
    palette,
  };
}
