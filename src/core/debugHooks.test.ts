import { describe, expect, it, vi } from "vitest";
import { JsnesCore } from "./jsnesCore";
import { PrgBankMap, type JsnesMachine } from "./jsnesDebug";
import type { AccessKind, DebugStop } from "./types";
import { buildInes, WRITE_BATTERY_RAM_PROGRAM } from "../test/syntheticRom";

function makeCore() {
  const callbacks = { onFrame: vi.fn(), onAudioSample: vi.fn(), onBatteryRamWrite: vi.fn() };
  return { core: new JsnesCore(callbacks), callbacks };
}

const batteryRom = () => buildInes({ battery: true, program: WRITE_BATTERY_RAM_PROGRAM });

/** The CPU methods the hooks replace; none is an own property of jsnes's CPU while hooks are off. */
const WRAPPED = ["emulate", "load", "write", "push", "pull", "_takeBranch", "loadFromCartridge"];
function ownCpuMethods(core: JsnesCore): string[] {
  const cpu = (core as unknown as { nes: { cpu: object } }).nes.cpu;
  return WRAPPED.filter((name) => Object.hasOwn(cpu, name));
}

type Access = [Exclude<AccessKind, "execute">, number, number, number];

describe("JsnesCore debug hooks", () => {
  it("calls the execute hook with each instruction's address, starting at the reset vector", () => {
    const { core } = makeCore();
    const pcs: number[] = [];
    core.setDebugHooks({ onInstruction: (state) => void pcs.push(state.pc) });
    core.load(batteryRom());
    core.frame();
    // LDA #$42 at $8000, STA $6000 at $8002, LDA #$17 at $8005, STA $7FFF at $8007, JMP at $800A.
    expect(pcs.slice(0, 7)).toEqual([0x8000, 0x8002, 0x8005, 0x8007, 0x800a, 0x800a, 0x800a]);
    expect(new Set(pcs.slice(4))).toEqual(new Set([0x800a]));
  });

  it("passes the registers as they stand before the instruction", () => {
    const { core } = makeCore();
    const states: { pc: number; a: number; cycle: number; scanline: number }[] = [];
    core.setDebugHooks({ onInstruction: ({ pc, a, cycle, scanline }) => void states.push({ pc, a, cycle, scanline }) });
    core.load(batteryRom());
    core.frame();
    expect(states[1].pc).toBe(0x8002);
    expect(states[1].a).toBe(0x42);
    expect(states[3].a).toBe(0x17);
    // LDA immediate takes 2 cycles, STA absolute 4.
    expect(states[2].cycle - states[1].cycle).toBe(4);
    expect(states[1].cycle - states[0].cycle).toBe(2);
    for (const { scanline } of states) expect(scanline).toBeGreaterThanOrEqual(-1);
    for (const { scanline } of states) expect(scanline).toBeLessThanOrEqual(260);
  });

  it("reports data writes in the watched range with their value and instruction, and no fetches", () => {
    const { core } = makeCore();
    const accesses: Access[] = [];
    core.setDebugHooks({ onAccess: (...access) => void accesses.push(access), accessRanges: [[0x6000, 0x7fff]] });
    core.load(batteryRom());
    core.frame();
    expect(accesses).toEqual([
      ["write", 0x6000, 0x42, 0x8002],
      ["write", 0x7fff, 0x17, 0x8007],
    ]);
  });

  it("leaves operand and opcode fetches out of a watch on the program itself", () => {
    const { core } = makeCore();
    const accesses: Access[] = [];
    core.setDebugHooks({ onAccess: (...access) => void accesses.push(access), accessRanges: [[0x8000, 0xffff]] });
    // Immediate operands (LDA #$42) are read through jsnes's load too.
    core.load(batteryRom());
    core.frame();
    expect(accesses).toEqual([]);

    // LDA $8010 / BEQ +0 (taken, with a dummy read of $8005) / loop: JMP loop
    core.load(buildInes({ program: [0xad, 0x10, 0x80, 0xf0, 0x00, 0x4c, 0x05, 0x80] }));
    core.frame();
    expect(accesses).toEqual([["read", 0x8010, 0x00, 0x8000]]);
  });

  it("matches a watch on work RAM in its mirrors, and sees stack pushes and pulls", () => {
    const { core } = makeCore();
    const accesses: Access[] = [];
    // LDA #$5A / STA $0857 (a mirror of $0057) / PHA / PLA / loop: JMP loop
    const program = [0xa9, 0x5a, 0x8d, 0x57, 0x08, 0x48, 0x68, 0x4c, 0x07, 0x80];
    core.setDebugHooks({ onAccess: (...access) => void accesses.push(access), accessRanges: [[0x0057, 0x0057], [0x0100, 0x01ff]] });
    core.load(buildInes({ program }));
    core.frame();
    expect(accesses[0]).toEqual(["write", 0x0857, 0x5a, 0x8002]);
    const stackAddress = accesses[1][1];
    expect(stackAddress & 0xff00).toBe(0x0100);
    expect(accesses.slice(1)).toEqual([
      ["write", stackAddress, 0x5a, 0x8005],
      ["read", stackAddress, 0x5a, 0x8006],
    ]);
  });

  it("finishes the frame when a hook asks to stop, then names the first hit with its CPU state", () => {
    const { core, callbacks } = makeCore();
    const stops: DebugStop[] = [];
    let accessCalls = 0;
    core.setDebugHooks({
      onAccess: (kind, address) => {
        accessCalls++;
        return kind === "write" && address === 0x6000;
      },
      accessRanges: [[0x6000, 0x7fff]],
      onStop: (stop) => void stops.push(stop),
    });
    core.load(batteryRom());
    core.frame();
    expect(callbacks.onFrame).toHaveBeenCalledTimes(1);
    // The frame ran past the hit: the later write to $7FFF happened too.
    expect(accessCalls).toBe(2);
    expect(core.peek(0x7fff)).toBe(0x17);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ kind: "write", address: 0x6000, value: 0x42, state: { pc: 0x8002, a: 0x42 } });
    core.frame();
    expect(stops).toHaveLength(1);
  });

  it("stops on an execute hit at the instruction's address", () => {
    const { core } = makeCore();
    const stops: DebugStop[] = [];
    core.setDebugHooks({ onInstruction: (state) => state.pc === 0x8007, onStop: (stop) => void stops.push(stop) });
    core.load(batteryRom());
    core.frame();
    expect(stops).toEqual([expect.objectContaining({ kind: "execute", address: 0x8007, value: null, state: expect.objectContaining({ pc: 0x8007, a: 0x17 }) })]);
  });

  it("installs its wrappers only while hooks are set", () => {
    const { core } = makeCore();
    core.load(batteryRom());
    expect(ownCpuMethods(core)).toEqual([]);
    const pcs: number[] = [];
    core.setDebugHooks({ onInstruction: (state) => void pcs.push(state.pc), onAccess: () => {} });
    expect(ownCpuMethods(core)).toEqual(["emulate", "load", "write", "push", "pull", "_takeBranch"]);
    core.frame();
    const seen = pcs.length;
    expect(seen).toBeGreaterThan(1000);
    core.setDebugHooks(null);
    expect(ownCpuMethods(core)).toEqual([]);
    core.frame();
    expect(pcs).toHaveLength(seen);
  });

  it("moves the hooks onto the new machine after reset and loadState", () => {
    const { core } = makeCore();
    const pcs: number[] = [];
    core.load(batteryRom());
    const state = core.saveState();
    core.setDebugHooks({ onInstruction: (now) => void pcs.push(now.pc) });
    core.frame();
    pcs.length = 0;
    core.reset();
    core.frame();
    expect(pcs.slice(0, 2)).toEqual([0x8000, 0x8002]);
    pcs.length = 0;
    core.loadState(state);
    core.frame();
    expect(pcs.slice(0, 2)).toEqual([0x8000, 0x8002]);
    core.setDebugHooks(null);
    expect(ownCpuMethods(core)).toEqual([]);
  });

  it("keeps hooks out of save states", () => {
    const plain = makeCore().core;
    const hooked = makeCore().core;
    hooked.setDebugHooks({ onInstruction: () => {}, onAccess: () => {} });
    for (const core of [plain, hooked]) {
      core.load(batteryRom());
      for (let frame = 0; frame < 3; frame++) core.frame();
    }
    expect(hooked.saveState()).toEqual(plain.saveState());
  });

  it("refuses an access range outside the CPU address space", () => {
    const { core } = makeCore();
    expect(() => core.setDebugHooks({ onAccess: () => {}, accessRanges: [[0x8000, 0x10000]] })).toThrow("not a range");
    expect(() => core.setDebugHooks({ onAccess: () => {}, accessRanges: [[0x200, 0x100]] })).toThrow("not a range");
  });
});

/** An image whose every 16 KB bank starts with the same program and differs from the others at $x100. */
function bankedRom(mapper: number, prgBanks: number, program: number[]): Uint8Array {
  const rom = buildInes({ mapper, prgBanks, program });
  for (let bank = 0; bank < prgBanks; bank++) {
    rom.set(program, 16 + bank * 0x4000);
    rom.set(program, 16 + bank * 0x4000 + 0x2000);
    rom[16 + bank * 0x4000 + 0x100] = bank + 1;
    rom[16 + bank * 0x4000 + 0x2100] = bank + 0x81;
  }
  return rom;
}

/** UxROM: LDA #$02 / STA $8000 (bank 2 into $8000-$BFFF) / loop: JMP loop */
const SWITCH_TO_BANK_2 = [0xa9, 0x02, 0x8d, 0x00, 0x80, 0x4c, 0x05, 0x80];

describe("JsnesCore.romOffset", () => {
  it("maps NROM's PRG to its ROM offsets and RAM and registers to null", () => {
    const { core } = makeCore();
    core.load(batteryRom());
    expect(core.romOffset(0x8000)).toBe(0);
    expect(core.romOffset(0xbfff)).toBe(0x3fff);
    // A 16 KB NROM image appears at both $8000 and $C000.
    expect(core.romOffset(0xc000)).toBe(0);
    expect(core.romOffset(0xfffc)).toBe(0x3ffc);
    for (const address of [0x0000, 0x07ff, 0x2002, 0x4016, 0x6000, 0x7fff]) expect(core.romOffset(address)).toBeNull();
    expect(() => core.romOffset(0x10000)).toThrow("outside");
  });

  it("follows a UxROM bank switch through loadRomBank, and a save state brings it back", () => {
    const rom = bankedRom(2, 4, SWITCH_TO_BANK_2);
    const { core } = makeCore();
    core.load(rom);
    expect(core.romOffset(0x8000)).toBe(0);
    expect(core.romOffset(0xc000)).toBe(3 * 0x4000);
    core.frame();
    expect(core.romOffset(0x8000)).toBe(2 * 0x4000);
    expect(core.romOffset(0xa123)).toBe(2 * 0x4000 + 0x2123);
    expect(core.romOffset(0xc000)).toBe(3 * 0x4000);

    const { core: other } = makeCore();
    other.load(rom);
    other.loadState(core.saveState());
    expect(other.romOffset(0x8000)).toBe(2 * 0x4000);
    other.reset();
    expect(other.romOffset(0x8000)).toBe(0);
  });

  it("refuses to wrap a mapper twice, so a reused mapper cannot stack wrappers", () => {
    const { core } = makeCore();
    core.load(batteryRom());
    const machine = (core as unknown as { nes: JsnesMachine }).nes;
    expect(() => new PrgBankMap().attach(machine)).toThrow("already wrapped");
    // loadState makes a new mapper, which is wrapped afresh.
    core.loadState(core.saveState());
    expect(core.romOffset(0x8000)).toBe(0);
  });

  it("follows an MMC3 8 KB bank switch through load8kRomBank", () => {
    // LDA #$06 / STA $8000 (select R6, the $8000 slot) / LDA #$05 / STA $8001 / loop: JMP loop
    const rom = bankedRom(4, 4, [0xa9, 0x06, 0x8d, 0x00, 0x80, 0xa9, 0x05, 0x8d, 0x01, 0x80, 0x4c, 0x0a, 0x80]);
    const { core } = makeCore();
    core.load(rom);
    expect(core.romOffset(0x8000)).toBe(0);
    expect(core.romOffset(0xa000)).toBe(0x2000);
    expect(core.romOffset(0xe000)).toBe(7 * 0x2000);
    core.frame();
    expect(core.romOffset(0x8000)).toBe(5 * 0x2000);
    expect(core.romOffset(0xa000)).toBe(0x2000);
  });
});

describe("JsnesCore.pokeRom", () => {
  it("writes a PRG byte where it is mapped, mirrors included, and keeps it through reset", () => {
    const { core } = makeCore();
    const rom = batteryRom();
    core.load(rom);
    core.pokeRom(0x8100, 0x55);
    // A 16 KB NROM image appears at both $8000 and $C000.
    expect(core.peek(0x8100)).toBe(0x55);
    expect(core.peek(0xc100)).toBe(0x55);
    core.reset();
    expect(core.peek(0x8100)).toBe(0x55);
    // The caller's ROM is left as it was, and loading a ROM starts without the change.
    expect(rom[16 + 0x100]).toBe(0);
    core.load(rom);
    expect(core.peek(0x8100)).toBe(0);
  });

  it("refuses addresses below the cartridge's ROM and values that are not bytes", () => {
    const { core } = makeCore();
    core.load(batteryRom());
    expect(() => core.pokeRom(0x6000, 1)).toThrow("not cartridge ROM");
    expect(() => core.pokeRom(0x0010, 1)).toThrow("not cartridge ROM");
    expect(() => core.pokeRom(0x8000, 256)).toThrow("not a byte");
    expect(() => core.pokeRom(0x8000, 1.5)).toThrow("not a byte");
  });

  it("holds when its bank is switched out and back in", () => {
    const { core } = makeCore();
    core.load(bankedRom(2, 4, SWITCH_TO_BANK_2));
    core.frame();
    expect(core.peek(0x8100)).toBe(3);
    core.pokeRom(0x8100, 0x55);
    // Reset maps bank 0 again; the program's first frame switches bank 2 back in through loadRomBank.
    core.reset();
    expect(core.peek(0x8100)).toBe(1);
    core.frame();
    expect(core.peek(0x8100)).toBe(0x55);
  });

  it("holds through a save state made before the change, whose bank still matches", () => {
    const { core } = makeCore();
    core.load(bankedRom(2, 4, SWITCH_TO_BANK_2));
    core.frame();
    const before = core.saveState();
    core.pokeRom(0x8100, 0x55);
    core.loadState(before);
    expect(core.peek(0x8100)).toBe(0x55);
    expect(core.romOffset(0x8000)).toBe(2 * 0x4000);
    const after = core.saveState();
    core.loadState(after);
    expect(core.peek(0x8100)).toBe(0x55);
  });
});

describe("JsnesCore.ppuSnapshot", () => {
  // Nametable $2000 = tile 1; palette $3F00 = $16, $3F01 = $2A; OAM byte 0 = 7.
  const PPU_PROGRAM = [
    0xa9, 0x20, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20, 0xa9, 0x01, 0x8d, 0x07, 0x20,
    0xa9, 0x3f, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20, 0xa9, 0x16, 0x8d, 0x07, 0x20, 0xa9, 0x2a, 0x8d, 0x07, 0x20,
    0xa9, 0x00, 0x8d, 0x03, 0x20, 0xa9, 0x07, 0x8d, 0x04, 0x20,
    0x4c, 0x2d, 0x80,
  ];
  const TILE_1 = [0xff, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0xff, 0x00, 0x7e, 0x42, 0x42, 0x42, 0x42, 0x7e, 0x00];
  const TILE_1FF = [0x18, 0x3c, 0x7e, 0xff, 0xff, 0x7e, 0x3c, 0x18, 0, 0, 0, 0, 0, 0, 0, 0];

  function ppuRom(): Uint8Array {
    const rom = buildInes({ program: PPU_PROGRAM });
    const chr = 16 + 0x4000;
    rom.set(TILE_1, chr + 0x10);
    // The last tile of the second pattern table.
    rom.set(TILE_1FF, chr + 0x1ff0);
    return rom;
  }

  it("returns pattern tables, mirrored nametables, OAM and palette indices of the sizes the NES has", () => {
    const { core } = makeCore();
    core.load(ppuRom());
    core.frame();
    const snapshot = core.ppuSnapshot();
    expect(snapshot.patterns).toHaveLength(0x2000);
    expect(snapshot.nametables).toHaveLength(0x1000);
    expect(snapshot.oam).toHaveLength(0x100);
    expect(snapshot.palette).toHaveLength(32);

    expect([...snapshot.patterns.slice(0x10, 0x20)]).toEqual(TILE_1);
    expect([...snapshot.patterns.slice(0x1ff0)]).toEqual(TILE_1FF);
    expect(snapshot.nametables[0]).toBe(1);
    // buildInes sets horizontal mirroring: $2400 shows $2000, $2800 does not.
    expect(snapshot.nametables[0x400]).toBe(1);
    expect(snapshot.nametables[0x800]).toBe(0);
    expect(snapshot.oam[0]).toBe(7);
    expect(snapshot.palette[0]).toBe(0x16);
    expect(snapshot.palette[1]).toBe(0x2a);
    // $3F10 is the backdrop too.
    expect(snapshot.palette[16]).toBe(0x16);
  });

  it("gives copies, not jsnes's own arrays", () => {
    const { core } = makeCore();
    core.load(ppuRom());
    core.frame();
    const first = core.ppuSnapshot();
    first.patterns[0x10] = 0;
    first.palette[0] = 0;
    expect(core.ppuSnapshot().patterns[0x10]).toBe(0xff);
    expect(core.ppuSnapshot().palette[0]).toBe(0x16);
  });

  it("colours() gives the colour picture() draws for the backdrop's palette index", () => {
    // Palette $3F00 = $16, address back to $0000, background rendering on ($2001 = $0A), then loop.
    const backdropProgram = [
      0xa9, 0x3f, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20, 0xa9, 0x16, 0x8d, 0x07, 0x20,
      0xa9, 0x00, 0x8d, 0x06, 0x20, 0x8d, 0x06, 0x20, 0xa9, 0x0a, 0x8d, 0x01, 0x20,
      0x4c, 0x1c, 0x80,
    ];
    const { core } = makeCore();
    core.load(buildInes({ program: backdropProgram }));
    core.frame();
    core.frame();
    const colours = core.colours();
    expect(colours).toHaveLength(64);
    // A pixel mid-screen: jsnes leaves the picture's top line black.
    expect(core.picture()[120 * 256 + 128] & 0xffffff).toBe(colours[0x16]);
    expect(colours[0x16]).not.toBe(colours[0x2a]);
  });
});
