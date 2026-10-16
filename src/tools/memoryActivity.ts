import type { DebugHooks } from "../core/types";
import { NES_RAM_RANGES } from "./ramSearch";

/** How many observations a change, read or write stays highlighted for: about half a second at 60 a second. */
export const HIGHLIGHT_TICKS = 30;

const NEVER = -0x7fffffff;
const WORK_RAM_END = 0x2000;

/** Work RAM repeats every 2 KB up to $1FFF; the viewer shows $0000-$07FF, so a mirror counts as its original. */
function canonical(address: number): number {
  return address < WORK_RAM_END ? address & 0x7ff : address;
}

export interface Activity {
  changed: boolean;
  read: boolean;
  written: boolean;
}

/**
 * What the memory viewer highlights: bytes whose value changed between
 * observations (one per animation frame), and bytes the game read or wrote,
 * from the access hooks. Each mark stays for HIGHLIGHT_TICKS observations.
 */
export class MemoryActivity {
  private tick = 0;
  private readonly lastChanged = new Int32Array(0x10000).fill(NEVER);
  private readonly lastRead = new Int32Array(0x10000).fill(NEVER);
  private readonly lastWritten = new Int32Array(0x10000).fill(NEVER);
  private readonly values = new Int16Array(0x10000).fill(-1);

  /** Hooks that mark reads and writes in work and cartridge RAM; set them on the player only while the viewer shows. */
  readonly hooks: DebugHooks = {
    accessRanges: NES_RAM_RANGES,
    onAccess: (kind, address) => {
      (kind === "write" ? this.lastWritten : this.lastRead)[canonical(address)] = this.tick;
    },
  };

  /** Compares RAM with the last observation, marking the bytes that changed, and starts the next tick. */
  observe(peek: (address: number) => number): void {
    this.tick++;
    for (const [first, last] of NES_RAM_RANGES) {
      for (let address = first; address <= last; address++) {
        const value = peek(address);
        const before = this.values[address];
        if (before !== -1 && before !== value) this.lastChanged[address] = this.tick;
        this.values[address] = value;
      }
    }
  }

  activity(address: number): Activity {
    const recent = (marks: Int32Array) => this.tick - marks[canonical(address)] < HIGHLIGHT_TICKS;
    return { changed: recent(this.lastChanged), read: recent(this.lastRead), written: recent(this.lastWritten) };
  }
}
