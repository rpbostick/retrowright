// Tiny iNES images built in code, so no ROM file is ever needed by the tests.

export interface SyntheticRomOptions {
  mapper?: number;
  prgBanks?: number;
  chrBanks?: number;
  battery?: boolean;
  /** 6502 code placed at $8000; the reset and IRQ vectors point there, and NMI too unless nmiHandler is given. */
  program?: number[];
  /** 6502 code placed at $8100, with the NMI vector pointing there. */
  nmiHandler?: number[];
}

const NMI_HANDLER_ADDRESS = 0x8100;

/** LDA #$42 / STA $6000 / LDA #$17 / STA $7FFF / loop: JMP loop */
export const WRITE_BATTERY_RAM_PROGRAM = [
  0xa9, 0x42, 0x8d, 0x00, 0x60, 0xa9, 0x17, 0x8d, 0xff, 0x7f, 0x4c, 0x0a, 0x80,
];

/** loop: JMP loop */
export const IDLE_PROGRAM = [0x4c, 0x00, 0x80];

/**
 * Sets the backdrop colour to $16 (red) through $3F00, then idles, so the
 * picture differs from a core that has run no frame (all zeros):
 * LDA #$3F / STA $2006 / LDA #$00 / STA $2006 / LDA #$16 / STA $2007 / loop: JMP loop
 */
export const PAINT_BACKDROP_PROGRAM = [0xa9, 0x3f, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20, 0xa9, 0x16, 0x8d, 0x07, 0x20, 0x4c, 0x0f, 0x80];

/**
 * Reads pad 1 in a loop: $10 holds A (1 or 0) as last read, $11 adds it up
 * on every pass, $12 holds Start, and $13 counts passes since power-on or
 * reset. Inputs therefore leave a trace in RAM that a movie can check.
 */
export const READ_PAD_PROGRAM = [
  0xa9, 0x00, 0x85, 0x11, 0x85, 0x13, // LDA #0 / STA $11 / STA $13
  0xa9, 0x01, 0x8d, 0x16, 0x40, // loop: LDA #1 / STA $4016
  0xa9, 0x00, 0x8d, 0x16, 0x40, // LDA #0 / STA $4016
  0xad, 0x16, 0x40, 0x29, 0x01, 0x85, 0x10, // LDA $4016 / AND #1 / STA $10 (A)
  0x18, 0x65, 0x11, 0x85, 0x11, // CLC / ADC $11 / STA $11
  0xad, 0x16, 0x40, 0xad, 0x16, 0x40, // LDA $4016 (B) / LDA $4016 (Select)
  0xad, 0x16, 0x40, 0x29, 0x01, 0x85, 0x12, // LDA $4016 / AND #1 / STA $12 (Start)
  0xe6, 0x13, // INC $13
  0x4c, 0x06, 0x80, // JMP loop
];

/**
 * Reads all eight buttons of both pads in a loop into $00 and $01, then
 * copies them to $20 (pad 1) and $21 (pad 2) at once, so a byte read between
 * frames is always a whole read: A is bit 7, then B, Select, Start, Up, Down,
 * Left, and Right is bit 0.
 */
export const READ_BOTH_PADS_PROGRAM = [
  0xa9, 0x01, 0x8d, 0x16, 0x40, // loop: LDA #1 / STA $4016
  0xa9, 0x00, 0x8d, 0x16, 0x40, // LDA #0 / STA $4016
  0xa2, 0x08, // LDX #8
  0xad, 0x16, 0x40, 0x4a, 0x26, 0x00, // bit: LDA $4016 / LSR A / ROL $00
  0xad, 0x17, 0x40, 0x4a, 0x26, 0x01, // LDA $4017 / LSR A / ROL $01
  0xca, 0xd0, 0xf1, // DEX / BNE bit
  0xa5, 0x00, 0x85, 0x20, 0xa5, 0x01, 0x85, 0x21, // LDA $00 / STA $20 / LDA $01 / STA $21
  0x4c, 0x00, 0x80, // JMP loop
];

/**
 * Strobes pad 1, then reads one button a frame (waiting for each vertical
 * blank in between) into $00, and copies the eight to $20 once all are read,
 * in READ_BOTH_PADS_PROGRAM's bit order. So every pass spans eight frames:
 * $20 shows whether a pass keeps the buttons held at its strobe.
 */
export const READ_PAD_BIT_PER_FRAME_PROGRAM = [
  0xa9, 0x01, 0x8d, 0x16, 0x40, // loop: LDA #1 / STA $4016
  0xa9, 0x00, 0x8d, 0x16, 0x40, // LDA #0 / STA $4016
  0xa2, 0x08, // LDX #8
  0x2c, 0x02, 0x20, 0x10, 0xfb, // bit: BIT $2002 / BPL bit
  0xad, 0x16, 0x40, 0x4a, 0x26, 0x00, // LDA $4016 / LSR A / ROL $00
  0xca, 0xd0, 0xf2, // DEX / BNE bit
  0xa5, 0x00, 0x85, 0x20, // LDA $00 / STA $20
  0x4c, 0x00, 0x80, // JMP loop
];

/**
 * READ_BOTH_PADS_PROGRAM that also sets $22 to 1 on any pass where either pad
 * reads Left with Right or Up with Down, and never clears it after power-on,
 * so a check of $22 at the end covers every read before it.
 */
export const FLAG_OPPOSITES_PROGRAM = [
  0xa9, 0x00, 0x85, 0x22, // LDA #0 / STA $22
  0xa9, 0x01, 0x8d, 0x16, 0x40, // loop: LDA #1 / STA $4016
  0xa9, 0x00, 0x8d, 0x16, 0x40, // LDA #0 / STA $4016
  0xa2, 0x08, // LDX #8
  0xad, 0x16, 0x40, 0x4a, 0x26, 0x00, // bit: LDA $4016 / LSR A / ROL $00
  0xad, 0x17, 0x40, 0x4a, 0x26, 0x01, // LDA $4017 / LSR A / ROL $01
  0xca, 0xd0, 0xf1, // DEX / BNE bit
  0xa5, 0x00, 0x85, 0x20, 0xa5, 0x01, 0x85, 0x21, // LDA $00 / STA $20 / LDA $01 / STA $21
  0xa2, 0x01, // LDX #1
  0xb5, 0x00, 0x29, 0x03, 0xc9, 0x03, 0xf0, 0x08, // pad: LDA $00,X / AND #3 / CMP #3 / BEQ both
  0xb5, 0x00, 0x29, 0x0c, 0xc9, 0x0c, 0xd0, 0x04, // LDA $00,X / AND #$0C / CMP #$0C / BNE next
  0xa9, 0x01, 0x85, 0x22, // both: LDA #1 / STA $22
  0xca, 0x10, 0xe9, // next: DEX / BPL pad
  0x4c, 0x04, 0x80, // JMP loop
];

/**
 * Waits for two vertical blanks, turns on NMI and idles; NMI_READ_PAD_HANDLER
 * then does the work once a frame, as games do. Because nothing runs between
 * NMIs, RAM after a frame does not depend on how many CPU cycles each
 * emulator gives a frame, so two accurate emulators should agree byte for byte.
 */
export const NMI_IDLE_PROGRAM = [
  0x78, 0xd8, 0xa2, 0xff, 0x9a, // SEI / CLD / LDX #$FF / TXS
  0xa9, 0x00, 0x85, 0x11, 0x85, 0x12, // LDA #0 / STA $11 / STA $12
  0x2c, 0x02, 0x20, 0x10, 0xfb, // wait1: BIT $2002 / BPL wait1
  0x2c, 0x02, 0x20, 0x10, 0xfb, // wait2: BIT $2002 / BPL wait2
  0xa9, 0x80, 0x8d, 0x00, 0x20, // LDA #$80 / STA $2000 (NMI on)
  0x4c, 0x1a, 0x80, // loop: JMP loop
];

/** Reads pad 1 once per NMI: $10 holds A as last read, $11 adds it up, $12 counts NMIs. */
export const NMI_READ_PAD_HANDLER = [
  0x48, // PHA
  0xa9, 0x01, 0x8d, 0x16, 0x40, // LDA #1 / STA $4016
  0xa9, 0x00, 0x8d, 0x16, 0x40, // LDA #0 / STA $4016
  0xad, 0x16, 0x40, 0x29, 0x01, 0x85, 0x10, // LDA $4016 / AND #1 / STA $10 (A)
  0x18, 0x65, 0x11, 0x85, 0x11, // CLC / ADC $11 / STA $11
  0xe6, 0x12, // INC $12
  0x68, 0x40, // PLA / RTI
];

/**
 * Shows a RAM byte on screen: sets $00 to $0F (black), waits for two vertical
 * blanks, turns on NMI, then loops writing $00 to the backdrop colour at
 * $3F00, so a write to $00 changes the whole picture. With COUNT_NMI_HANDLER,
 * $01 counts frames. Rendering stays off, so the backdrop fills the screen
 * inside jsnes's black border (its top, bottom and left 8 pixels).
 */
export const SHOW_RAM_COLOUR_PROGRAM = [
  0x78, 0xd8, 0xa2, 0xff, 0x9a, // SEI / CLD / LDX #$FF / TXS
  0xa9, 0x0f, 0x85, 0x00, // LDA #$0F / STA $00
  0x2c, 0x02, 0x20, 0x10, 0xfb, // wait1: BIT $2002 / BPL wait1
  0x2c, 0x02, 0x20, 0x10, 0xfb, // wait2: BIT $2002 / BPL wait2
  0xa9, 0x80, 0x8d, 0x00, 0x20, // LDA #$80 / STA $2000 (NMI on)
  0xa9, 0x3f, 0x8d, 0x06, 0x20, // loop: LDA #$3F / STA $2006
  0xa9, 0x00, 0x8d, 0x06, 0x20, // LDA #$00 / STA $2006
  0xa5, 0x00, 0x8d, 0x07, 0x20, // LDA $00 / STA $2007
  0x4c, 0x18, 0x80, // JMP loop
];

/** INC $01 / RTI: one count a frame. */
export const COUNT_NMI_HANDLER = [0xe6, 0x01, 0x40];

export function buildInes(options: SyntheticRomOptions = {}): Uint8Array {
  const { mapper = 0, prgBanks = 1, chrBanks = 1, battery = false, program = IDLE_PROGRAM, nmiHandler } = options;
  const prgSize = prgBanks * 16 * 1024;
  const rom = new Uint8Array(16 + prgSize + chrBanks * 8 * 1024);
  rom.set([0x4e, 0x45, 0x53, 0x1a, prgBanks, chrBanks]);
  rom[6] = ((mapper & 0x0f) << 4) | (battery ? 0x02 : 0);
  rom[7] = mapper & 0xf0;
  rom.set(program, 16);
  // Vectors sit at the end of the last PRG bank ($FFFA-$FFFF).
  const vectors = 16 + prgSize - 6;
  for (let vector = 0; vector < 3; vector++) {
    rom[vectors + vector * 2] = 0x00;
    rom[vectors + vector * 2 + 1] = 0x80;
  }
  if (nmiHandler) {
    if (program.length > NMI_HANDLER_ADDRESS - 0x8000) throw new Error("The program runs into the NMI handler at $8100.");
    rom.set(nmiHandler, 16 + NMI_HANDLER_ADDRESS - 0x8000);
    rom[vectors] = NMI_HANDLER_ADDRESS & 0xff;
    rom[vectors + 1] = NMI_HANDLER_ADDRESS >> 8;
  }
  return rom;
}

/** Synthetic ROMs that committed example movies are recorded on, by file name. */
export const NAMED_SYNTHETIC_ROMS: Readonly<Record<string, () => Uint8Array>> = {
  "synthetic-read-pad.nes": () => buildInes({ program: READ_PAD_PROGRAM }),
};
