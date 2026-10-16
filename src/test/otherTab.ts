// Connections another tab on the same origin holds to the store's database.

/** A connection at version 1, as a tab of the first version holds it open. */
export function openVersion1(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open("retrowright", 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore("roms", { keyPath: "id" });
      open.result.createObjectStore("battery", { keyPath: "romId" });
      open.result.createObjectStore("states", { keyPath: ["romId", "slot"] });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

/** A connection at a later version than this build's, as a tab of a newer build opens it; rejects if this build blocks it. */
export function openNewerVersion(factory: IDBFactory, version: number): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open("retrowright", version);
    open.onblocked = () => reject(new Error("the newer version was blocked"));
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
