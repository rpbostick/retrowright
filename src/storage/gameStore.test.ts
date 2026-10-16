import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { gameSaves, IndexedDbGameStore, MemoryGameStore, openGameStore, REPLACED_MESSAGE, romId, type GameStore } from "./gameStore";
import { buildInes } from "../test/syntheticRom";
import { openNewerVersion, openVersion1 } from "../test/otherTab";

function clock() {
  let time = 1000;
  return () => ++time;
}

const romA = () => buildInes({ program: [0x4c, 0x00, 0x80] });
const romB = () => buildInes({ program: [0xea, 0x4c, 0x00, 0x80] });
const STATE = { core: "test", data: { pc: 1 } };

const variants: Array<[string, () => Promise<GameStore>]> = [
  ["IndexedDB", () => IndexedDbGameStore.open(new IDBFactory(), clock())],
  ["memory (no IndexedDB)", async () => new MemoryGameStore(clock())],
];

for (const [label, makeStore] of variants) {
  describe(`${label} game store`, () => {
    it("lists games played most recently first, then unplayed ones newest added first, without their data", async () => {
      const store = await makeStore();
      const a = await store.putRom("a.nes", romA());
      const b = await store.putRom("b.nes", romB());
      const { game: c } = await store.addRom("c.nes", buildInes({ program: [0xa9, 1, 0x4c, 0x00, 0x80] }));
      const list = await store.listGames();
      expect(list.map((game) => game.fileName)).toEqual(["b.nes", "a.nes", "c.nes"]);
      expect(list[0]).not.toHaveProperty("data");
      expect(c.lastPlayedAt).toBeNull();
      expect((await store.getRom(a.id))?.data).toEqual(romA());
      expect(b.id).toBe(await romId(romB()));
    });

    it("names the save the card's picture comes from: the newest pictured slot or resume state", async () => {
      const store = await makeStore();
      const { game } = await store.addRom("a.nes", romA());
      expect(await gameSaves(store, game.id)).toEqual({ pictured: null, resumeAt: null, slots: [] });
      await store.putState(game.id, 3, STATE, "data:image/png;base64,SLOT3");
      await store.putState(game.id, 4, STATE, null);
      const slotOnly = await gameSaves(store, game.id);
      expect(slotOnly.pictured).toMatchObject({ kind: "slot", slot: 3 });
      expect(slotOnly.slots.map((record) => record.slot)).toEqual([3, 4]);
      expect((await store.listGames())[0].thumbnail).toBe("data:image/png;base64,SLOT3");
      await store.putResume(game.id, STATE, "data:image/png;base64,RESUME");
      const resumeNewest = await gameSaves(store, game.id);
      expect(resumeNewest.pictured).toMatchObject({ kind: "resume" });
      expect(resumeNewest.resumeAt).not.toBeNull();
      expect((await store.listGames())[0].thumbnail).toBe("data:image/png;base64,RESUME");
    });

    it("recognises a duplicate by its SHA-256 and keeps the game already there", async () => {
      const store = await makeStore();
      const first = await store.addRom("a.nes", romA());
      await store.renameGame(first.game.id, "Mine");
      const again = await store.addRom("a copy (USA).nes", romA());
      expect(first.duplicate).toBe(false);
      expect(again.duplicate).toBe(true);
      expect(again.game).toMatchObject({ id: first.game.id, fileName: "a.nes", title: "Mine" });
      expect(await store.listGames()).toHaveLength(1);
    });

    it("keeps where a patched ROM came from; a ROM already there keeps its own origin", async () => {
      const store = await makeStore();
      const { game: original } = await store.addRom("a.nes", romA());
      const origin = { romId: original.id, romTitle: "a", patchName: "hack.bps" };
      const patched = await store.addRom("a + hack.nes", romB(), origin);
      expect(patched.game.patchedFrom).toEqual(origin);
      expect(original.patchedFrom).toBeNull();
      const again = await store.addRom("a + other.nes", romB(), { ...origin, patchName: "other.ips" });
      expect(again).toMatchObject({ duplicate: true, game: { fileName: "a + hack.nes", patchedFrom: origin } });
      expect((await store.listGames()).find((game) => game.id === patched.game.id)?.patchedFrom).toEqual(origin);
      expect((await store.getRom(original.id))?.data).toEqual(romA());
    });

    it("marks a game played again without adding it twice", async () => {
      const store = await makeStore();
      await store.putRom("a.nes", romA());
      await store.putRom("b.nes", romB());
      await store.putRom("a again.nes", romA());
      expect((await store.listGames()).map((game) => game.fileName)).toEqual(["a.nes", "b.nes"]);
    });

    it("keeps every game: the library has no size limit", async () => {
      const store = await makeStore();
      for (let index = 0; index < 20; index++) {
        await store.addRom(`${index}.nes`, buildInes({ program: [0xa9, index, 0x4c, 0x00, 0x80] }));
      }
      expect(await store.listGames()).toHaveLength(20);
    });

    it("renames a game, and an empty name goes back to the file name's", async () => {
      const store = await makeStore();
      const { game } = await store.addRom("a.nes", romA());
      await store.renameGame(game.id, "  Adventure  ");
      expect((await store.listGames())[0].title).toBe("Adventure");
      await store.renameGame(game.id, " ");
      expect((await store.listGames())[0].title).toBeNull();
      await expect(store.renameGame("missing", "x")).rejects.toThrow("not in the library");
    });

    it("stars and unstars a game", async () => {
      const store = await makeStore();
      const { game } = await store.addRom("a.nes", romA());
      expect(game.favourite).toBe(false);
      await store.setFavourite(game.id, true);
      expect((await store.listGames())[0].favourite).toBe(true);
      await store.setFavourite(game.id, false);
      expect((await store.listGames())[0].favourite).toBe(false);
    });

    it("shows the player's own newest picture: a save state's, then the resume state's", async () => {
      const store = await makeStore();
      const { game } = await store.addRom("a.nes", romA());
      expect(game.thumbnail).toBeNull();
      await store.putState(game.id, 3, STATE, "data:image/png;base64,SLOT");
      expect((await store.listGames())[0].thumbnail).toBe("data:image/png;base64,SLOT");
      await store.putResume(game.id, STATE, "data:image/png;base64,LAST");
      const [listed] = await store.listGames();
      expect(listed.thumbnail).toBe("data:image/png;base64,LAST");
      expect(listed.resumeAt).toBeGreaterThan(1000);
      // A save without a picture keeps the picture there is.
      await store.putState(game.id, 4, STATE, null);
      expect((await store.listGames())[0].thumbnail).toBe("data:image/png;base64,LAST");
    });

    it("keeps a resume state apart from the eight slots", async () => {
      const store = await makeStore();
      const { game } = await store.addRom("a.nes", romA());
      await store.putResume(game.id, { core: "test", data: { pc: 7 } }, null);
      expect(await store.listStates(game.id)).toEqual([]);
      expect((await store.getResume(game.id))?.state.data).toEqual({ pc: 7 });
      expect(await store.getResume("other")).toBeUndefined();
    });

    it("removes a game and keeps its saves, which come back with it", async () => {
      const store = await makeStore();
      const a = await store.putRom("a.nes", romA());
      await store.putBatteryRam(a.id, new Uint8Array([1, 2, 3]));
      await store.putResume(a.id, STATE, "data:image/png;base64,LAST");
      await store.removeGame(a.id, { withSaves: false });
      expect(await store.listGames()).toEqual([]);
      expect(await store.getRom(a.id)).toBeUndefined();
      expect(await store.getBatteryRam(a.id)).toEqual(new Uint8Array([1, 2, 3]));
      const back = await store.addRom("a.nes", romA());
      expect(back.duplicate).toBe(false);
      expect(back.game.thumbnail).toBe("data:image/png;base64,LAST");
      expect(back.game.resumeAt).not.toBeNull();
    });

    it("removes a game with its saves", async () => {
      const store = await makeStore();
      const a = await store.putRom("a.nes", romA());
      await store.putBatteryRam(a.id, new Uint8Array([1, 2, 3]));
      await store.putState(a.id, 2, STATE, null);
      await store.putResume(a.id, STATE, null);
      await store.removeGame(a.id, { withSaves: true });
      expect(await store.getBatteryRam(a.id)).toBeUndefined();
      expect(await store.listStates(a.id)).toEqual([]);
      expect(await store.getResume(a.id)).toBeUndefined();
    });

    it("stores battery RAM per ROM", async () => {
      const store = await makeStore();
      const ram = new Uint8Array(0x2000).fill(7);
      await store.putBatteryRam("rom-1", ram);
      ram[0] = 99; // later changes to the caller's array must not leak in
      expect((await store.getBatteryRam("rom-1"))?.[0]).toBe(7);
      expect(await store.getBatteryRam("rom-2")).toBeUndefined();
    });

    it("stores save states per ROM and slot", async () => {
      const store = await makeStore();
      await store.putState("rom-1", 1, { core: "test", data: { pc: 1 } }, null);
      await store.putState("rom-1", 3, { core: "test", data: { pc: 3 } }, null);
      await store.putState("rom-2", 1, { core: "test", data: { pc: 99 } }, null);
      expect((await store.getState("rom-1", 3))?.state.data).toEqual({ pc: 3 });
      expect(await store.getState("rom-1", 2)).toBeUndefined();
      expect((await store.listStates("rom-1")).map((record) => record.slot)).toEqual([1, 3]);
    });

    it("keeps eight slots, each with its thumbnail and time", async () => {
      const store = await makeStore();
      await store.putState("rom-1", 8, { core: "test", data: { pc: 8 } }, "data:image/png;base64,AAAA");
      const [record] = await store.listStates("rom-1");
      expect(record).toMatchObject({ slot: 8, thumbnail: "data:image/png;base64,AAAA" });
      expect(record.savedAt).toBeGreaterThan(1000);
    });

    it("lists every ROM with saves, in the library or not, and reads all of one ROM's saves", async () => {
      const store = await makeStore();
      const { game } = await store.addRom("a.nes", romA());
      await store.putBatteryRam(game.id, new Uint8Array([1, 2]));
      await store.putState("gone", 4, STATE, null);
      await store.putResume("resumed", STATE, null);
      expect(await store.savedRomIds()).toEqual([game.id, "gone", "resumed"].sort());
      const set = await store.saveSet(game.id);
      expect(set.battery).toMatchObject({ romId: game.id, data: new Uint8Array([1, 2]) });
      expect(set.battery!.savedAt).toBeGreaterThan(1000);
      expect(set).toMatchObject({ states: [], resume: null });
      expect((await store.saveSet("gone")).states.map((state) => state.slot)).toEqual([4]);
    });

    it("merges imported saves: newer ones are written with their own time, older or equal ones are kept here", async () => {
      const store = await makeStore();
      const { game } = await store.addRom("a.nes", romA());
      await store.putState(game.id, 1, { core: "test", data: { here: 1 } }, null); // savedAt 1002 or so
      const imported = {
        romId: game.id,
        battery: { romId: game.id, data: new Uint8Array([9]), savedAt: 50_000 },
        states: [
          { romId: game.id, slot: 1 as const, state: { core: "test", data: { theirs: 1 } }, savedAt: 1, thumbnail: null },
          { romId: game.id, slot: 2 as const, state: { core: "test", data: { theirs: 2 } }, savedAt: 60_000, thumbnail: "data:image/png;base64,TWO" },
        ],
        resume: null,
      };
      expect(await store.mergeSaves(imported)).toEqual({ written: 2, keptHere: 1 });
      expect(await store.getBatteryRam(game.id)).toEqual(new Uint8Array([9]));
      expect((await store.getState(game.id, 1))?.state.data).toEqual({ here: 1 });
      expect(await store.getState(game.id, 2)).toMatchObject({ savedAt: 60_000, thumbnail: "data:image/png;base64,TWO" });
      expect((await store.listGames())[0].thumbnail).toBe("data:image/png;base64,TWO");
      // The same file again writes nothing.
      expect(await store.mergeSaves(imported)).toEqual({ written: 0, keptHere: 3 });
    });

    it("keeps imported saves for a game not in the library until its ROM is added", async () => {
      const store = await makeStore();
      const id = await romId(romA());
      const resume = { romId: id, state: STATE, savedAt: 70_000, thumbnail: "data:image/png;base64,RES" };
      expect(await store.mergeSaves({ romId: id, battery: null, states: [], resume })).toEqual({ written: 1, keptHere: 0 });
      expect(await store.listGames()).toEqual([]);
      const { game } = await store.addRom("a.nes", romA());
      expect(game).toMatchObject({ thumbnail: "data:image/png;base64,RES", resumeAt: 70_000 });
    });
  });
}

interface Version1Data {
  roms?: object[];
  battery?: object[];
  states?: object[];
}

/** Creates the database as the first version of the store left it: roms, battery and states, no library. */
async function createVersion1Database(factory: IDBFactory, data: Version1Data): Promise<void> {
  const db = await openVersion1(factory);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["roms", "battery", "states"], "readwrite");
    for (const record of data.roms ?? []) tx.objectStore("roms").put(record);
    for (const record of data.battery ?? []) tx.objectStore("battery").put(record);
    for (const record of data.states ?? []) tx.objectStore("states").put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe("the Recent list of the first version", () => {
  it("migrates into the library with its battery saves, slots and pictures", async () => {
    const factory = new IDBFactory();
    const a = romA();
    const b = romB();
    const idA = await romId(a);
    const idB = await romId(b);
    await createVersion1Database(factory, {
      roms: [
        { id: idA, name: "Final_Fantasy (USA).nes", size: a.length, lastPlayedAt: 5000, data: a },
        { id: idB, name: "b.nes", size: b.length, lastPlayedAt: 7000, data: b },
      ],
      battery: [{ romId: idA, data: new Uint8Array([9, 8, 7]), savedAt: 5000 }],
      states: [
        { romId: idA, slot: 1, state: { core: "test", data: { pc: 1 } }, savedAt: 4000, thumbnail: "data:image/png;base64,OLD" },
        { romId: idA, slot: 2, state: { core: "test", data: { pc: 2 } }, savedAt: 4500, thumbnail: "data:image/png;base64,NEW" },
        // Saved before slots had pictures: no thumbnail field at all.
        { romId: idB, slot: 1, state: { core: "test", data: { pc: 3 } }, savedAt: 6000 },
      ],
    });
    const store = await IndexedDbGameStore.open(factory);
    const games = await store.listGames();
    expect(games).toEqual([
      { id: idB, fileName: "b.nes", size: b.length, addedAt: 7000, lastPlayedAt: 7000, title: null, favourite: false, thumbnail: null, resumeAt: null, patchedFrom: null },
      {
        id: idA,
        fileName: "Final_Fantasy (USA).nes",
        size: a.length,
        addedAt: 5000,
        lastPlayedAt: 5000,
        title: null,
        favourite: false,
        thumbnail: "data:image/png;base64,NEW",
        resumeAt: null,
        patchedFrom: null,
      },
    ]);
    expect(await store.getRom(idA)).toEqual({ id: idA, name: "Final_Fantasy (USA).nes", size: a.length, data: a });
    expect(await store.getBatteryRam(idA)).toEqual(new Uint8Array([9, 8, 7]));
    expect((await store.listStates(idA)).map((record) => record.state.data)).toEqual([{ pc: 1 }, { pc: 2 }]);
    expect(await store.getState(idB, 1)).toEqual({ romId: idB, slot: 1, state: { core: "test", data: { pc: 3 } }, savedAt: 6000, thumbnail: null });
  });

  it("is refused, leaving the old data as it was, when a stored ROM is malformed", async () => {
    const factory = new IDBFactory();
    await createVersion1Database(factory, { roms: [{ id: "x", name: 42, size: 1, lastPlayedAt: 1, data: new Uint8Array(1) }] });
    await expect(IndexedDbGameStore.open(factory)).rejects.toThrow("stored ROM");
    // The failed upgrade left version 1 in place for a later version to read.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open("retrowright");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    expect(db.version).toBe(1);
    db.close();
  });
});

describe("stored save states", () => {
  it("refuse a thumbnail that is not an image", async () => {
    const factory = new IDBFactory();
    await createVersion1Database(factory, { states: [{ romId: "rom-1", slot: 1, state: { core: "test", data: {} }, savedAt: 5000, thumbnail: 42 }] });
    await expect(IndexedDbGameStore.open(factory)).rejects.toThrow("not an image");
  });

  it("refuse a record whose ROM id or slot is malformed", async () => {
    const badRom = new IDBFactory();
    await createVersion1Database(badRom, { states: [{ romId: 7, slot: 1, state: { core: "test", data: {} }, savedAt: 5000 }] });
    await expect(IndexedDbGameStore.open(badRom)).rejects.toThrow("ROM id");
    const badSlot = new IDBFactory();
    await createVersion1Database(badSlot, { states: [{ romId: "rom-1", slot: 9, state: { core: "test", data: {} }, savedAt: 5000 }] });
    await expect(IndexedDbGameStore.open(badSlot)).rejects.toThrow("slot 9");
  });
});

/** Overwrites a game's record through a second connection, as an older version or a damaged database would hold it. */
async function writeGameRecord(factory: IDBFactory, record: object): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open("retrowright", 2);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("games", "readwrite");
    tx.objectStore("games").put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe("a library entry stored before patching existed", () => {
  const before = { fileName: "a.nes", size: 1, addedAt: 5, lastPlayedAt: null, title: null, favourite: false, thumbnail: null, resumeAt: null };

  it("reads as added from a file", async () => {
    const factory = new IDBFactory();
    const store = await IndexedDbGameStore.open(factory, clock());
    const { game } = await store.addRom("a.nes", romA());
    await writeGameRecord(factory, { id: game.id, ...before });
    expect(await store.listGames()).toEqual([{ id: game.id, ...before, patchedFrom: null }]);
  });

  it("is refused when its origin is not a ROM and a patch", async () => {
    const factory = new IDBFactory();
    const store = await IndexedDbGameStore.open(factory, clock());
    const { game } = await store.addRom("a.nes", romA());
    await writeGameRecord(factory, { id: game.id, ...before, patchedFrom: { romId: "x", patchName: 3 } });
    await expect(store.listGames()).rejects.toThrow("The stored origin of a.nes is not a ROM and a patch");
  });
});

describe("a malformed library entry", () => {
  it("makes a save that updates it reject with the reason, not a bare abort", async () => {
    const factory = new IDBFactory();
    const store = await IndexedDbGameStore.open(factory, clock());
    const { game } = await store.addRom("a.nes", romA());
    await writeGameRecord(factory, { id: game.id, fileName: 42 });
    await expect(store.putState(game.id, 1, STATE, "data:image/png;base64,AA")).rejects.toThrow("A stored library entry is not in a form this version can read");
    await expect(store.putResume(game.id, STATE, null)).rejects.toThrow("A stored library entry is not in a form this version can read");
  });
});

const settled = (promise: Promise<unknown>) =>
  Promise.race([promise.then(() => true, () => true), new Promise((resolve) => setTimeout(() => resolve(false), 50))]);

describe("another tab holding the database", () => {
  it("at an older version blocks the open, which is reported and completes once that tab closes it", async () => {
    const factory = new IDBFactory();
    const oldTab = await openVersion1(factory);
    let blocked = 0;
    const opening = IndexedDbGameStore.open(factory, clock(), { onBlocked: () => blocked++ });
    expect(await settled(opening)).toBe(false);
    expect(blocked).toBe(1);
    oldTab.close();
    const store = await opening;
    await store.addRom("a.nes", romA());
    expect((await store.listGames()).map((game) => game.fileName)).toEqual(["a.nes"]);
  });

  it("at a newer version closes this connection, which is reported, and later actions say to reload", async () => {
    const factory = new IDBFactory();
    let replaced = 0;
    const store = await IndexedDbGameStore.open(factory, clock(), { onReplaced: () => replaced++ });
    // The newer tab's open is not blocked: this connection closes itself.
    const newer = await openNewerVersion(factory, 3);
    expect(newer.version).toBe(3);
    expect(replaced).toBe(1);
    await expect(store.listGames()).rejects.toThrow(REPLACED_MESSAGE);
    await expect(store.addRom("a.nes", romA())).rejects.toThrow(REPLACED_MESSAGE);
    newer.close();
  });

  it("is passed on by openGameStore", async () => {
    const factory = new IDBFactory();
    const oldTab = await openVersion1(factory);
    let blocked = 0;
    const opening = openGameStore(factory, { onBlocked: () => blocked++ });
    expect(await settled(opening)).toBe(false);
    expect(blocked).toBe(1);
    oldTab.close();
    expect((await opening).store.persistent).toBe(true);
  });
});

describe("openGameStore", () => {
  it("uses IndexedDB when the browser has it, and the data outlasts the store", async () => {
    const factory = new IDBFactory();
    const first = await openGameStore(factory);
    expect(first.problem).toBeUndefined();
    expect(first.store.persistent).toBe(true);
    await first.store.putRom("a.nes", romA());
    const second = await openGameStore(factory);
    expect((await second.store.listGames()).map((game) => game.fileName)).toEqual(["a.nes"]);
  });

  it("falls back to memory and says so when there is no IndexedDB", async () => {
    const { store, problem } = await openGameStore(undefined);
    expect(store.persistent).toBe(false);
    expect(problem).toContain("no IndexedDB");
    await store.putRom("a.nes", romA());
    expect(await store.listGames()).toHaveLength(1);
  });

  it("falls back to memory and says why when IndexedDB refuses to open", async () => {
    const refusing = {
      open() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    } as unknown as IDBFactory;
    const { store, problem } = await openGameStore(refusing);
    expect(store.persistent).toBe(false);
    expect(problem).toContain("The operation is insecure.");
  });
});
