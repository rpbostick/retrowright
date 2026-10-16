import { describe, expect, it } from "vitest";
import { fm2ToMovie, type Fm2Header, type Fm2Movie } from "../src/movie/fm2";
import { sha256Hex } from "../src/storage/gameStore";
import { buildInes, NMI_IDLE_PROGRAM } from "../src/test/syntheticRom";
import { baselineSignatures, compare } from "./tasSweepCompare";

/**
 * Reads pad 1 once per NMI and, while A is held, adds one to $28, which
 * Final Fantasy's map reads as the world map's scroll Y; so the signature
 * follows the input, as a game's state does, and not the frame count.
 */
const NMI_A_SCROLLS_HANDLER = [
  0x48, // PHA
  0xa9, 0x01, 0x8d, 0x16, 0x40, // LDA #1 / STA $4016
  0xa9, 0x00, 0x8d, 0x16, 0x40, // LDA #0 / STA $4016
  0xad, 0x16, 0x40, 0x29, 0x01, // LDA $4016 / AND #1 (A)
  0xf0, 0x02, // BEQ skip
  0xe6, 0x28, // INC $28
  0x68, 0x40, // skip: PLA / RTI
];

const rom = buildInes({ battery: true, program: NMI_IDLE_PROGRAM, nmiHandler: NMI_A_SCROLLS_HANDLER });
const romInfo = { name: "a-scrolls.nes", sha256: await sha256Hex(rom) };

/** 60 frames, A held on frames 20-29 and 40-44; the first frames press nothing, so a lead of -1 can drop one. */
const fm2: Fm2Movie = {
  header: { emuVersion: 22020 } as Fm2Header,
  frames: Array.from({ length: 60 }, (_, frame) => ({ commands: 0, pad1: (frame >= 20 && frame < 30) || (frame >= 40 && frame < 45) ? 0x01 : 0, pad2: 0 })),
};

// Zeros: jsnes's own power-on RAM has $2D bit 0 set, which would read the standard map's scroll instead.
const start = { fill: "zeros", battleRng: 0 } as const;
const baseline = baselineSignatures(rom, fm2ToMovie(fm2, { rom: romInfo }), start, 60, 1);

describe("tas:sweep's compare", () => {
  it("has a baseline that follows the input", () => {
    expect(new Set(baseline.values()).size).toBe(16);
  });

  for (const lead of [1, -1]) {
    it(`compares a start with lead ${lead} at its frame f ${lead > 0 ? "+" : "-"} 1 against the baseline's frame f, and finds it in step`, () => {
      const movie = fm2ToMovie(fm2, { rom: romInfo, leadFrames: lead });
      expect(compare(rom, movie, { ...start, lead }, baseline, 1)).toEqual({ inStepTo: 60, difference: null });
    });

    it(`finds the same lead-${lead} movie out of step when compared frame for frame`, () => {
      const movie = fm2ToMovie(fm2, { rom: romInfo, leadFrames: lead });
      const result = compare(rom, movie, { ...start, lead: 0 }, baseline, 1);
      expect(result.difference).toMatch(/^frame (20|21|40|41|45|46): /);
      expect(result.inStepTo).toBeGreaterThanOrEqual(19);
    });
  }
});
