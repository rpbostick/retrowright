import { NES_RAM_RANGES, readValue, type ValueSize } from "./ramSearch";

// A RAM watch list, kept per ROM (by SHA-256) in localStorage. The key starts
// "retrowright.", so a whole backup carries it with the other settings.

export type WatchFormat = "hex" | "decimal" | "signed";

export const WATCH_FORMATS: readonly WatchFormat[] = ["hex", "decimal", "signed"];

export interface Watch {
  address: number;
  name: string;
  size: ValueSize;
  format: WatchFormat;
}

export type LoadedWatches = { watches: Watch[]; problem?: string };

const STORAGE_PREFIX = "retrowright.watches.v1.";

function storageKey(romSha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(romSha256)) throw new Error(`${JSON.stringify(romSha256)} is not a ROM's SHA-256.`);
  return STORAGE_PREFIX + romSha256;
}

/** Whether a value of `size` bytes at `address` lies inside one RAM range the tools read. */
export function isWatchableAddress(address: number, size: ValueSize): boolean {
  return Number.isInteger(address) && NES_RAM_RANGES.some(([first, last]) => address >= first && address + size - 1 <= last);
}

function isWatch(value: unknown): value is Watch {
  if (typeof value !== "object" || value === null) return false;
  const { address, name, size, format } = value as Record<string, unknown>;
  return (
    typeof name === "string" &&
    (size === 1 || size === 2) &&
    WATCH_FORMATS.includes(format as WatchFormat) &&
    typeof address === "number" &&
    isWatchableAddress(address, size)
  );
}

/** `storage` is undefined when the browser blocks localStorage. */
export function loadWatches(storage: Storage | undefined, romSha256: string): LoadedWatches {
  const key = storageKey(romSha256);
  const raw = storage?.getItem(key);
  if (raw === null || raw === undefined) return { watches: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed) || !parsed.every(isWatch)) {
    return { watches: [], problem: "The saved watch list for this game could not be read, so it starts empty." };
  }
  return { watches: parsed.map(({ address, name, size, format }) => ({ address, name, size, format })) };
}

export function saveWatches(storage: Storage | undefined, romSha256: string, watches: readonly Watch[]): void {
  const key = storageKey(romSha256);
  storage?.setItem(key, JSON.stringify(watches));
}

/** "$0048", "$6100": CPU addresses as FCEUX and the memory map notes write them. */
export function formatAddress(address: number): string {
  return `$${address.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** The value as the watch shows it: hex with a digit pair per byte, or decimal, unsigned or signed. */
export function formatWatchValue(peek: (address: number) => number, watch: Watch): string {
  if (watch.format === "hex") {
    const value = readValue(peek, watch.address, { size: watch.size, signed: false });
    return `$${value.toString(16).toUpperCase().padStart(watch.size * 2, "0")}`;
  }
  return String(readValue(peek, watch.address, { size: watch.size, signed: watch.format === "signed" }));
}
