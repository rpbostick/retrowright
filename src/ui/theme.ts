export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "retrowright.theme";
const THEMES: readonly Theme[] = ["system", "light", "dark"];

export function loadTheme(storage: Storage | undefined): Theme {
  const saved = storage?.getItem(STORAGE_KEY);
  return THEMES.find((theme) => theme === saved) ?? "system";
}

export function saveTheme(storage: Storage | undefined, theme: Theme): void {
  storage?.setItem(STORAGE_KEY, theme);
}

/** "system" leaves the choice to prefers-color-scheme in styles.css. */
export function applyTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}
