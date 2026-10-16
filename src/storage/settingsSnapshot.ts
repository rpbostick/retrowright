// The page's settings (key bindings, theme, touch controls, the library's view
// and sort) live in localStorage under keys starting "retrowright.". A backup
// carries them as the raw strings: each module checks its own value when it
// reads it, so a value from another version falls back there, with its message.

const PREFIX = "retrowright.";
/** Written only to check that localStorage works; not a setting. */
const PROBE_KEY = "retrowright.probe";

export type Settings = Record<string, string>;

export function isSettingKey(key: string): boolean {
  return key.startsWith(PREFIX) && key !== PROBE_KEY;
}

export function settingsSnapshot(storage: Storage): Settings {
  const settings: Settings = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key === null || !isSettingKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) settings[key] = value;
  }
  return settings;
}

export function restoreSettings(storage: Storage, settings: Settings): void {
  for (const [key, value] of Object.entries(settings)) {
    if (!isSettingKey(key)) throw new Error(`${JSON.stringify(key)} is not a retrowright setting.`);
    storage.setItem(key, value);
  }
}
