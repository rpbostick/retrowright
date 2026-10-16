// A RAM search in the manner of FCEUX's and BizHawk's: every address starts
// as a candidate, and each step keeps those whose value compares as asked
// with its value at the last step or with a given number. It reads memory
// through a peek function alone, so it runs in Node against a replayed movie
// as it does in the page.

/** An inclusive range of CPU addresses. */
export type AddressRange = readonly [first: number, last: number];

/** Work RAM and cartridge RAM: the NES memory a game keeps its state in. */
export const NES_RAM_RANGES: readonly AddressRange[] = [
  [0x0000, 0x07ff],
  [0x6000, 0x7fff],
];

export type ValueSize = 1 | 2;

/** How a candidate's value is read: 1 or 2 bytes (little-endian, as the 6502 stores them), signed or not. */
export interface ValueFormat {
  size: ValueSize;
  signed: boolean;
}

export type Comparison = "equal" | "notEqual" | "greater" | "less" | "changed" | "unchanged";

export const COMPARISONS: readonly Comparison[] = ["equal", "notEqual", "greater", "less", "changed", "unchanged"];

/**
 * One filter step. Changed and unchanged always compare with the value at the
 * last step; the others compare with `value` when it is given, and with the
 * last step's value otherwise.
 */
export type SearchStep = { comparison: "changed" | "unchanged" } | { comparison: "equal" | "notEqual" | "greater" | "less"; value?: number };

export interface Candidate {
  address: number;
  value: number;
  /** The value at the last step (or at the reset). */
  previous: number;
}

/** The smallest and largest value a format can hold. */
export function valueBounds({ size, signed }: ValueFormat): { min: number; max: number } {
  const span = size === 1 ? 0x100 : 0x10000;
  return signed ? { min: -span / 2, max: span / 2 - 1 } : { min: 0, max: span - 1 };
}

/** The value at `address` in `format`, from `peek`. */
export function readValue(peek: (address: number) => number, address: number, { size, signed }: ValueFormat): number {
  const raw = size === 1 ? peek(address) : peek(address) | (peek(address + 1) << 8);
  const span = size === 1 ? 0x100 : 0x10000;
  return signed && raw >= span / 2 ? raw - span : raw;
}

interface SearchState {
  addresses: Int32Array;
  previous: Int32Array;
}

export class RamSearch {
  private format: ValueFormat;
  private state: SearchState;
  /** States before each step, newest last, for undo. */
  private readonly history: SearchState[] = [];

  constructor(
    private readonly peek: (address: number) => number,
    format: ValueFormat,
    private readonly ranges: readonly AddressRange[] = NES_RAM_RANGES,
  ) {
    this.format = { ...format };
    this.state = this.fullState();
  }

  get valueFormat(): ValueFormat {
    return { ...this.format };
  }

  get count(): number {
    return this.state.addresses.length;
  }

  /** Steps that undo can take back. */
  get steps(): number {
    return this.history.length;
  }

  /** Every address is a candidate again, its value now the one compared with; a new format applies from here. */
  reset(format: ValueFormat = this.format): void {
    this.format = { ...format };
    this.history.length = 0;
    this.state = this.fullState();
  }

  /** Keeps the candidates the step holds for, and makes their values now the ones the next step compares with. Returns how many are left. */
  filter(step: SearchStep): number {
    const given = "value" in step ? step.value : undefined;
    if (given !== undefined) this.checkValue(given);
    const test = comparator(step.comparison);
    const { addresses, previous } = this.state;
    const keptAddresses: number[] = [];
    const keptValues: number[] = [];
    for (let index = 0; index < addresses.length; index++) {
      const address = addresses[index];
      const value = readValue(this.peek, address, this.format);
      if (test(value, given ?? previous[index])) {
        keptAddresses.push(address);
        keptValues.push(value);
      }
    }
    this.history.push(this.state);
    this.state = { addresses: Int32Array.from(keptAddresses), previous: Int32Array.from(keptValues) };
    return this.count;
  }

  /** Takes back the last step; false when there is none. */
  undo(): boolean {
    const last = this.history.pop();
    if (!last) return false;
    this.state = last;
    return true;
  }

  /** The candidates with their values now, up to `limit` of them, lowest address first. */
  candidates(limit = Infinity): Candidate[] {
    const { addresses, previous } = this.state;
    const shown = Math.min(limit, addresses.length);
    const result: Candidate[] = [];
    for (let index = 0; index < shown; index++) {
      const address = addresses[index];
      result.push({ address, value: readValue(this.peek, address, this.format), previous: previous[index] });
    }
    return result;
  }

  private fullState(): SearchState {
    const addresses: number[] = [];
    // A 2-byte value starts at every address whose second byte is in the same range.
    const tail = this.format.size - 1;
    for (const [first, last] of this.ranges) for (let address = first; address <= last - tail; address++) addresses.push(address);
    const previous = addresses.map((address) => readValue(this.peek, address, this.format));
    return { addresses: Int32Array.from(addresses), previous: Int32Array.from(previous) };
  }

  private checkValue(value: number): void {
    const { min, max } = valueBounds(this.format);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new RangeError(`${value} is not a ${this.format.size}-byte ${this.format.signed ? "signed" : "unsigned"} value (${min} to ${max}).`);
    }
  }
}

function comparator(comparison: Comparison): (value: number, against: number) => boolean {
  switch (comparison) {
    case "equal":
    case "unchanged":
      return (value, against) => value === against;
    case "notEqual":
    case "changed":
      return (value, against) => value !== against;
    case "greater":
      return (value, against) => value > against;
    case "less":
      return (value, against) => value < against;
  }
}
