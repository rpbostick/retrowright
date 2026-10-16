// A tunables file names the bytes in a patched ROM that set how it plays, so
// they can be changed live while playing. A game's build tools write it beside
// the ROM; the page finds it at run time (src/ui/gameFiles.ts) and shows the
// Tune panel for a ROM whose SHA-256 has one.

export const TUNABLES_FORMAT = "retrowright-tunables";
export const TUNABLES_VERSION = 1;

export interface Tunable {
  key: string;
  /** Keys the value was saved under before it was renamed: values kept or written under one load as this key. */
  formerKeys?: string[];
  name: string;
  /** One plain sentence on what the value does. */
  description: string;
  /** Where the byte is in the .nes file, header included. */
  romOffset: number;
  /** Where the game reads it, for EmulatorCore.pokeRom. */
  cpuAddress: number;
  min: number;
  max: number;
  default: number;
  /** For a byte that picks one of a few ways rather than an amount: the name of each value from min to max. Absent for an amount. */
  choices?: string[];
}

export interface Tunables {
  format: typeof TUNABLES_FORMAT;
  version: typeof TUNABLES_VERSION;
  /** The patched ROM the offsets belong to. */
  romSha256: string;
  patch: string;
  values: Tunable[];
}

/** Values by Tunable.key. */
export type TunedValues = Record<string, number>;

function isByte(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xff;
}

/** Checks a parsed tunables file and throws, naming `source`, when it is not one this page reads. */
export function parseTunables(data: unknown, source: string): Tunables {
  const fail = (problem: string): never => {
    throw new Error(`${source} is not a tunables file this page reads: ${problem}.`);
  };
  if (typeof data !== "object" || data === null) return fail("it is not a JSON object");
  const file = data as Partial<Tunables>;
  if (file.format !== TUNABLES_FORMAT) fail(`its format is ${JSON.stringify(file.format)}, not "${TUNABLES_FORMAT}"`);
  if (file.version !== TUNABLES_VERSION) fail(`its version is ${JSON.stringify(file.version)}, not ${TUNABLES_VERSION}`);
  if (typeof file.romSha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.romSha256)) fail("romSha256 is not a SHA-256 in lower-case hex");
  if (typeof file.patch !== "string") fail("patch is not a file name");
  if (!Array.isArray(file.values) || file.values.length === 0) fail("values is not a list of tunables");
  const keys = new Set<string>();
  for (const value of file.values!) {
    const where = `value ${JSON.stringify(value?.key)}`;
    if (typeof value?.key !== "string" || keys.has(value.key)) fail(`${where} has no key of its own`);
    keys.add(value.key);
    if (typeof value.name !== "string" || typeof value.description !== "string") fail(`${where} has no name or description`);
    if (!Number.isInteger(value.romOffset) || value.romOffset < 16) fail(`${where} has no ROM offset past the header`);
    if (!Number.isInteger(value.cpuAddress) || value.cpuAddress < 0x8000 || value.cpuAddress > 0xffff) fail(`${where} has no CPU address in $8000-$FFFF`);
    if (![value.min, value.max, value.default].every(isByte) || value.min > value.default || value.default > value.max) fail(`${where} needs bytes min <= default <= max`);
    if (value.choices !== undefined && (!Array.isArray(value.choices) || value.choices.length !== value.max - value.min + 1 || !value.choices.every((choice) => typeof choice === "string"))) {
      fail(`${where} has choices that do not name each value from min to max`);
    }
    if (value.formerKeys !== undefined && (!Array.isArray(value.formerKeys) || !value.formerKeys.every((former) => typeof former === "string"))) fail(`${where} has formerKeys that are not a list of keys`);
  }
  const current = new Set(file.values!.map((value) => value.key));
  const formers = file.values!.flatMap((value) => value.formerKeys ?? []);
  const clash = formers.find((former, index) => current.has(former) || formers.indexOf(former) !== index);
  if (clash !== undefined) fail(`the former key ${JSON.stringify(clash)} is a key in use or the former key of two values`);
  return file as Tunables;
}

/** The tunable a saved key names: its own key, or one it had before a rename; undefined when none. */
export function tunableForKey(tunables: Tunables, key: string): Tunable | undefined {
  return tunables.values.find((value) => value.key === key) ?? tunables.values.find((value) => value.formerKeys?.includes(key));
}

/** Saved values under the keys in use: a value saved under a former key comes under the key it has now. */
export function withCurrentKeys(tunables: Tunables, saved: Record<string, unknown>): Record<string, unknown> {
  const current: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(saved)) {
    const tunable = tunableForKey(tunables, key);
    // A value saved under the key in use wins over one under a former key.
    if (tunable && (key === tunable.key || !(tunable.key in current))) current[tunable.key] = value;
    else if (!tunable) current[key] = value;
  }
  return current;
}

export function defaultValues(tunables: Tunables): TunedValues {
  return Object.fromEntries(tunables.values.map((value) => [value.key, value.default]));
}

/** The values that differ from the defaults, in the file's order. */
export function changedValues(tunables: Tunables, values: TunedValues): Tunable[] {
  return tunables.values.filter((value) => values[value.key] !== value.default);
}

/** "push 12, brake 7": what a tuned version changes, for its name in the library. */
export function changeSummary(tunables: Tunables, values: TunedValues): string {
  const changed = changedValues(tunables, values);
  return changed.length === 0 ? "defaults" : changed.map((value) => `${value.name.toLowerCase()} ${shownValue(value, values[value.key])}`).join(", ");
}

/** A value as the Tune section shows it: the choice's name, or the number. */
export function shownValue(tunable: Tunable, value: number): string {
  return tunable.choices ? tunable.choices[value - tunable.min] : String(value);
}

/**
 * The ROM with the tuned bytes written in. Throws when the ROM is not the one
 * the file was made for (its bytes at the offsets are not the defaults) or a
 * value is missing or out of its range, so a version is never saved wrong.
 */
export function tunedRom(rom: Uint8Array, tunables: Tunables, values: TunedValues): Uint8Array {
  const tuned = rom.slice();
  for (const value of tunables.values) {
    if (rom[value.romOffset] !== value.default) {
      throw new Error(`This ROM has ${rom[value.romOffset]} at offset ${value.romOffset} where ${tunables.patch} has ${value.name} ${value.default}; it is not the ROM the tunables are for.`);
    }
    const tuning = values[value.key];
    if (!Number.isInteger(tuning) || tuning < value.min || tuning > value.max) throw new Error(`${value.name} must be ${value.min} to ${value.max}, not ${tuning}.`);
    tuned[value.romOffset] = tuning;
  }
  return tuned;
}
