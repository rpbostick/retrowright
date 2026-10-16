// Browsers can refuse storage outright: reading window.localStorage or
// window.indexedDB throws a SecurityError when cookies are blocked or in
// some private modes. Callers get undefined and tell the user what is lost.

export function browserLocalStorage(): Storage | undefined {
  try {
    const storage = window.localStorage;
    storage.getItem("retrowright.probe");
    return storage;
  } catch {
    return undefined;
  }
}

export function browserIndexedDb(): IDBFactory | undefined {
  try {
    return window.indexedDB ?? undefined;
  } catch {
    return undefined;
  }
}
