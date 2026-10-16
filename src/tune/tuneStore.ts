import { parseTunables, withCurrentKeys, type Tunables, type TunedValues } from "./tunables";

// The tunables file loaded for each ROM, and the values tuned for it, kept in
// the browser under the ROM's SHA-256. The page bundles no tunables file: one
// is loaded in the Tune panel or found beside the ROM (src/ui/gameFiles.ts).
// Both live under "retrowright." keys, so they travel with the settings in a backup.

const fileKey = (romSha256: string) => `retrowright.tunables.${romSha256}`;

/** The tunables file kept for a ROM; null with none, and a problem to show when the kept one cannot be read. */
export function storedTunables(storage: Storage | undefined, romSha256: string): { tunables: Tunables | null; problem: string | null } {
  const text = storage?.getItem(fileKey(romSha256));
  if (!text) return { tunables: null, problem: null };
  try {
    const tunables = parseTunables(JSON.parse(text), "The tunables file kept for this game");
    if (tunables.romSha256 !== romSha256) throw new Error("The tunables file kept for this game is for another ROM.");
    return { tunables, problem: null };
  } catch (error) {
    return { tunables: null, problem: error instanceof Error ? error.message : String(error) };
  }
}

/** Keeps a tunables file for the ROM it names. */
export function storeTunables(storage: Storage | undefined, tunables: Tunables): void {
  storage?.setItem(fileKey(tunables.romSha256), JSON.stringify(tunables));
}

const storageKey = (romSha256: string) => `retrowright.tune.${romSha256}`;

/**
 * The values kept for this ROM, the defaults where none is kept. A kept value
 * outside its range, or a list that cannot be read, is dropped with a problem
 * to show, so a damaged entry never reaches the game.
 */
export function loadTunedValues(storage: Storage | undefined, tunables: Tunables): { values: TunedValues; problem: string | null } {
  const values: TunedValues = Object.fromEntries(tunables.values.map((value) => [value.key, value.default]));
  const text = storage?.getItem(storageKey(tunables.romSha256));
  if (!text) return { values, problem: null };
  let kept: unknown;
  try {
    kept = JSON.parse(text);
  } catch {
    return { values, problem: "The tuned values kept for this game could not be read; the defaults are back." };
  }
  const dropped: string[] = [];
  const current = typeof kept === "object" && kept !== null ? withCurrentKeys(tunables, kept as Record<string, unknown>) : {};
  for (const value of tunables.values) {
    const tuned = current[value.key];
    if (tuned === undefined) continue;
    if (Number.isInteger(tuned) && (tuned as number) >= value.min && (tuned as number) <= value.max) values[value.key] = tuned as number;
    else dropped.push(value.name);
  }
  return { values, problem: dropped.length ? `Kept values out of range were dropped: ${dropped.join(", ")}.` : null };
}

export function saveTunedValues(storage: Storage | undefined, romSha256: string, values: TunedValues): void {
  storage?.setItem(storageKey(romSha256), JSON.stringify(values));
}
