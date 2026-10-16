import { describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { JsnesCore } from "../core/jsnesCore";
import { buildInes, PAINT_BACKDROP_PROGRAM, WRITE_BATTERY_RAM_PROGRAM } from "../test/syntheticRom";
import { BACKUP_FORMAT, BACKUP_VERSION, buildBackup, parseBackup, restoreBackup, restoreSummary, serializeBackup } from "./backup";
import { IndexedDbGameStore, MemoryGameStore, romId } from "./gameStore";
import { settingsSnapshot } from "./settingsSnapshot";

describe("restoreSummary", () => {
  it("says one save kept here was kept as it was, and several as they were", () => {
    const report = { savesWritten: 0, savesKeptHere: 1, gamesAdded: 0, waitingForRom: 0, settingsRestored: false };
    expect(restoreSummary(report)).toBe("Imported 0 saves. 1 save was kept as it was here, being as new or newer.");
    expect(restoreSummary({ ...report, savesKeptHere: 2 })).toBe("Imported 0 saves. 2 saves were kept as they were here, being as new or newer.");
  });
});

function clock(start: number) {
  let time = start;
  return () => ++time;
}

const romA = () => buildInes({ battery: true, program: WRITE_BATTERY_RAM_PROGRAM });
const romB = () => buildInes({ program: PAINT_BACKDROP_PROGRAM });
const STATE = { core: "test", data: { pc: 1 } };

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

/** Writes the backup as the page downloads it and reads it back as an import does. */
const throughFile = (backup: Awaited<ReturnType<typeof buildBackup>>) => parseBackup(JSON.parse(serializeBackup(backup)));

describe("backup file", () => {
  it("carries every save, thumbnails and settings to another browser, where they wait for their ROM", async () => {
    const here = await IndexedDbGameStore.open(new IDBFactory(), clock(1000));
    const { game } = await here.addRom("Final_Fantasy (USA).nes", romA());
    await here.renameGame(game.id, "FF");
    await here.putBatteryRam(game.id, new Uint8Array([1, 2, 3]));
    await here.putState(game.id, 2, STATE, "data:image/webp;base64,SLOT2");
    await here.putResume(game.id, STATE, "data:image/webp;base64,LAST");
    const settings = settingsSnapshot(memoryStorage({ "retrowright.theme": "dark", "retrowright.probe": "", other: "x" }));
    expect(settings).toEqual({ "retrowright.theme": "dark" });

    const file = throughFile(await buildBackup(here, { includeRoms: false, settings, now: 5000 }));
    expect(file).toMatchObject({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: 5000, games: [{ sha256: game.id, title: "FF", rom: null }] });

    const there = await IndexedDbGameStore.open(new IDBFactory(), clock(90_000));
    const thereSettings = memoryStorage();
    const report = await restoreBackup(there, file, thereSettings);
    expect(report).toEqual({ savesWritten: 3, savesKeptHere: 0, gamesAdded: 0, waitingForRom: 1, settingsRestored: true });
    expect(restoreSummary(report)).toBe("Imported 3 saves, restored the settings. Saves for 1 game not in the library wait until you add its ROM.");
    expect(thereSettings.getItem("retrowright.theme")).toBe("dark");
    expect(await there.listGames()).toEqual([]);

    // Adding the same ROM there brings its saves, with the picture of the newest.
    const { game: added } = await there.addRom("ff.nes", romA());
    expect(added.thumbnail).toBe("data:image/webp;base64,LAST");
    expect(await there.getBatteryRam(added.id)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await there.getState(added.id, 2)).toMatchObject({ thumbnail: "data:image/webp;base64,SLOT2", state: STATE });
  });

  it("includes ROMs only when asked, and adds them with their titles and favourites", async () => {
    const here = new MemoryGameStore(clock(1000));
    const { game } = await here.addRom("a.nes", romA());
    await here.renameGame(game.id, "Mine");
    await here.setFavourite(game.id, true);
    expect((await buildBackup(here, { includeRoms: false, settings: null, now: 1 })).games[0].rom).toBeNull();

    const file = throughFile(await buildBackup(here, { includeRoms: true, settings: null, now: 1 }));
    const there = new MemoryGameStore(clock(1000));
    const report = await restoreBackup(there, file, undefined);
    expect(report).toMatchObject({ gamesAdded: 1, waitingForRom: 0, settingsRestored: false });
    expect(await there.listGames()).toMatchObject([{ id: game.id, fileName: "a.nes", title: "Mine", favourite: true }]);
    expect((await there.getRom(game.id))?.data).toEqual(romA());
  });

  it("backs up one game alone, without the page's settings", async () => {
    const here = new MemoryGameStore(clock(1000));
    const { game: a } = await here.addRom("a.nes", romA());
    const { game: b } = await here.addRom("b.nes", romB());
    await here.putState(a.id, 1, STATE, null);
    await here.putState(b.id, 1, STATE, null);
    const file = await buildBackup(here, { gameIds: [b.id], includeRoms: false, settings: null, now: 1 });
    expect(file.games.map((game) => game.sha256)).toEqual([b.id]);
    expect(file.saves.map((saves) => saves.sha256)).toEqual([b.id]);
    expect(file.settings).toBeNull();
  });

  it("refuses a file of a newer format version with a message saying so", () => {
    const newer = { format: BACKUP_FORMAT, version: BACKUP_VERSION + 1, exportedAt: 1, games: [], saves: [], settings: null };
    expect(() => parseBackup(newer)).toThrow(
      `This backup was made by a newer version of retrowright (backup format ${BACKUP_VERSION + 1}); this page reads format ${BACKUP_VERSION}.`,
    );
  });

  it("refuses other files and damaged entries, naming the problem", () => {
    const valid = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: 1, games: [], saves: [], settings: null };
    expect(() => parseBackup({ format: "retrowright-movie", version: 1 })).toThrow('format must be "retrowright-backup"');
    expect(() => parseBackup({ ...valid, version: 0 })).toThrow("version 0 is not supported");
    expect(() => parseBackup({ ...valid, saves: [{ sha256: "a".repeat(64), battery: null, resume: null, states: [{ slot: 9, savedAt: 1, thumbnail: null, state: STATE }] }] })).toThrow(
      "saves[0].states[0].slot must be one of slots 1 to 8",
    );
    expect(() => parseBackup({ ...valid, settings: { "someone.else": "1" } })).toThrow("not a retrowright setting");
    expect(() => parseBackup({ ...valid, games: [{ sha256: "XYZ", fileName: "a.nes", title: null, favourite: false, rom: null }] })).toThrow("games[0].sha256");
  });

  it("refuses a ROM whose bytes do not match its SHA-256", async () => {
    const file = parseBackup({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: 1,
      games: [{ sha256: await romId(romB()), fileName: "a.nes", title: null, favourite: false, rom: btoa("not the rom") }],
      saves: [],
      settings: null,
    });
    await expect(restoreBackup(new MemoryGameStore(), file, undefined)).rejects.toThrow("does not match its SHA-256");
  });

  it("carries a real jsnes save state through the file: it loads there onto the same picture", async () => {
    const callbacks = { onFrame: vi.fn(), onAudioSample: vi.fn(), onBatteryRamWrite: vi.fn() };
    const core = new JsnesCore(callbacks);
    core.load(romB());
    for (let frame = 0; frame < 30; frame++) core.frame();
    const here = new MemoryGameStore(clock(1000));
    const { game } = await here.addRom("b.nes", romB());
    await here.putState(game.id, 1, core.saveState(), null);
    for (let frame = 0; frame < 10; frame++) core.frame();
    const expected = core.picture();

    const there = new MemoryGameStore(clock(1000));
    await restoreBackup(there, throughFile(await buildBackup(here, { includeRoms: true, settings: null, now: 1 })), undefined);
    const other = new JsnesCore(callbacks);
    other.load((await there.getRom(game.id))!.data);
    other.loadState((await there.getState(game.id, 1))!.state);
    for (let frame = 0; frame < 10; frame++) other.frame();
    expect(other.picture()).toEqual(expected);
  });
});
