// The Storage API: a browser may clear a page's IndexedDB when space runs low
// (and Safari after seven days without a visit) unless the page's storage is
// persistent. navigator.storage.persist() asks for that; some browsers grant
// it silently by their own rules, Firefox asks the player.

/**
 * not-asked: the page has not asked yet (it asks after the first save).
 * asking: the browser has not answered (Firefox shows the player a prompt).
 * unsupported: the browser has no navigator.storage.persist.
 */
export type Persistence = "not-asked" | "asking" | "granted" | "denied" | "unsupported";

export type StorageApi = Pick<StorageManager, "persist" | "persisted" | "estimate">;

export function browserStorageApi(): StorageApi | undefined {
  return typeof navigator !== "undefined" ? navigator.storage : undefined;
}

/** Where the page stands before it asks: granted already, never askable, or not asked yet. */
export async function currentPersistence(api: StorageApi | undefined): Promise<Persistence> {
  if (typeof api?.persist !== "function") return "unsupported";
  return typeof api.persisted === "function" && (await api.persisted()) ? "granted" : "not-asked";
}

export async function requestPersistence(api: StorageApi | undefined): Promise<Persistence> {
  if (typeof api?.persist !== "function") return "unsupported";
  return (await api.persist()) ? "granted" : "denied";
}

export interface StorageUse {
  usage: number;
  quota: number;
}

/** Null when the browser cannot say (no navigator.storage.estimate, or an estimate without numbers). */
export async function storageUse(api: StorageApi | undefined): Promise<StorageUse | null> {
  if (typeof api?.estimate !== "function") return null;
  const { usage, quota } = await api.estimate();
  if (typeof usage !== "number" || typeof quota !== "number") return null;
  return { usage, quota };
}

const UNITS = ["bytes", "KB", "MB", "GB", "TB"];

/** Decimal units, as browsers and operating systems show disk space. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  if (unit === 0) return `${value} ${value === 1 ? "byte" : "bytes"}`;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}

export function storageUseText(use: StorageUse): string {
  return `${formatBytes(use.usage)} used of about ${formatBytes(use.quota)} this browser allows the page`;
}

/** Shown instead of PERSISTENCE_TEXT when the page keeps its data in memory alone: no answer of the browser's would keep it. */
export const MEMORY_ONLY_TEXT = "This browser is not keeping the page's data, so your saves are gone when the page closes. Export them before you leave to keep a copy.";

export const PERSISTENCE_TEXT: Record<Persistence, string> = {
  "not-asked": "The page asks the browser to keep your saves after your first save.",
  asking: "Asking the browser to keep your saves…",
  granted: "This browser has agreed to keep your saves: it will not clear them to make room.",
  denied:
    "This browser has not agreed to keep your saves, so it could clear them, for example when space runs low or after weeks without a visit. Export your saves now and then to keep a copy.",
  unsupported: "This browser cannot be asked to keep your saves, so it could clear them. Export your saves now and then to keep a copy.",
};
