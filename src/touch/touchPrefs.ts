export interface TouchPrefs {
  /** False after the menu turned the controls off: a touch then no longer brings them back. */
  enabled: boolean;
  /** Each control's size against the layout's, from SIZE_RANGE. */
  size: number;
  /** The controls' opacity, from OPACITY_RANGE. */
  opacity: number;
  /** A short vibration on each press, where the browser has navigator.vibrate. */
  vibrate: boolean;
}

export const SIZE_RANGE = { min: 0.8, max: 1.3, step: 0.05 } as const;
export const OPACITY_RANGE = { min: 0.3, max: 1, step: 0.05 } as const;

export const DEFAULT_TOUCH_PREFS: TouchPrefs = { enabled: true, size: 1, opacity: 0.85, vibrate: false };

const STORAGE_KEY = "retrowright.touch";

export interface LoadedTouchPrefs {
  prefs: TouchPrefs;
  /** Said to the player when saved settings could not be read and the defaults are used instead. */
  problem?: string;
}

const inRange = (value: unknown, range: { min: number; max: number }): value is number => typeof value === "number" && value >= range.min && value <= range.max;

function readPrefs(value: unknown): TouchPrefs | null {
  if (typeof value !== "object" || value === null) return null;
  const prefs = value as Partial<TouchPrefs>;
  if (typeof prefs.enabled !== "boolean" || !inRange(prefs.size, SIZE_RANGE) || !inRange(prefs.opacity, OPACITY_RANGE) || typeof prefs.vibrate !== "boolean") return null;
  return { enabled: prefs.enabled, size: prefs.size, opacity: prefs.opacity, vibrate: prefs.vibrate };
}

export function loadTouchPrefs(storage: Storage | undefined): LoadedTouchPrefs {
  const raw = storage?.getItem(STORAGE_KEY);
  if (raw === null || raw === undefined) return { prefs: DEFAULT_TOUCH_PREFS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const prefs = readPrefs(parsed);
  if (!prefs) return { prefs: DEFAULT_TOUCH_PREFS, problem: "Saved touch control settings could not be read, so the defaults are in use." };
  return { prefs };
}

export function saveTouchPrefs(storage: Storage | undefined, prefs: TouchPrefs): void {
  storage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
