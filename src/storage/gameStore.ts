import type { SaveState } from "../core/types";

// Everything kept in the browser: the library of ROMs the player added, battery
// RAM, save states and each game's resume state. Saves are keyed by the ROM's
// SHA-256, so removing a game and adding the same file again brings its saves
// back (unless they were removed with it).

export const STATE_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type StateSlot = (typeof STATE_SLOTS)[number];

export interface RomRecord {
  id: string;
  /** The file name the ROM was added under. */
  name: string;
  size: number;
  data: Uint8Array;
}

/** Where a patched ROM came from: the library entry it was made from, and the patch file. */
export interface PatchOrigin {
  /** The SHA-256 of the ROM the patch was applied to. */
  romId: string;
  /** That ROM's title in the library when the patch was applied. */
  romTitle: string;
  patchName: string;
}

/** A game in the library, without its ROM data. */
export interface GameRecord {
  id: string;
  fileName: string;
  size: number;
  addedAt: number;
  /** Null until the game is first played. */
  lastPlayedAt: number | null;
  /** The player's own title, or null for the one made from the file name. */
  title: string | null;
  favourite: boolean;
  /**
   * The player's own picture of the game: the newest thumbnail of its resume
   * state and save states, or null before there is one. Never cover art.
   */
  thumbnail: string | null;
  /** When the resume state was saved, or null when there is none. */
  resumeAt: number | null;
  /** Null for a ROM added as a file; entries stored before patching existed have none. */
  patchedFrom: PatchOrigin | null;
}

export interface StateRecord {
  romId: string;
  slot: StateSlot;
  state: SaveState;
  savedAt: number;
  /**
   * A small picture of the frame when the state was saved, as a data: URL.
   * Null for states saved before thumbnails existed.
   */
  thumbnail: string | null;
}

/** The state a game was left in when its tab was hidden or closed; apart from the eight slots. */
export interface ResumeRecord {
  romId: string;
  state: SaveState;
  savedAt: number;
  thumbnail: string | null;
}

export interface BatteryRecord {
  romId: string;
  data: Uint8Array;
  savedAt: number;
}

/** Every save of one ROM, whether or not the game is in the library. */
export interface SaveSet {
  romId: string;
  battery: BatteryRecord | null;
  states: StateRecord[];
  resume: ResumeRecord | null;
}

/** How many saves an import wrote, and how many it left because the one here was as new or newer. */
export interface MergeCount {
  written: number;
  keptHere: number;
}

export interface AddResult {
  game: GameRecord;
  /** True when the library already held a ROM with the same SHA-256; the game there is kept as it was. */
  duplicate: boolean;
}

export interface GameStore {
  /** False when the browser gives no IndexedDB: data lasts for this page only. */
  readonly persistent: boolean;
  /** `patchedFrom` is kept with a new game; a ROM already in the library keeps its own. */
  addRom(fileName: string, data: Uint8Array, patchedFrom?: PatchOrigin): Promise<AddResult>;
  /** Adds the ROM if it is new and marks it played now. */
  putRom(fileName: string, data: Uint8Array): Promise<RomRecord>;
  getRom(id: string): Promise<RomRecord | undefined>;
  markPlayed(id: string): Promise<void>;
  /** Played most recently first, then never-played games, newest added first. */
  listGames(): Promise<GameRecord[]>;
  /** A blank title goes back to the one made from the file name. */
  renameGame(id: string, title: string): Promise<void>;
  setFavourite(id: string, favourite: boolean): Promise<void>;
  removeGame(id: string, options: { withSaves: boolean }): Promise<void>;
  getBatteryRam(romId: string): Promise<Uint8Array | undefined>;
  putBatteryRam(romId: string, data: Uint8Array): Promise<void>;
  getState(romId: string, slot: StateSlot): Promise<StateRecord | undefined>;
  putState(romId: string, slot: StateSlot, state: SaveState, thumbnail: string | null): Promise<void>;
  listStates(romId: string): Promise<StateRecord[]>;
  getResume(romId: string): Promise<ResumeRecord | undefined>;
  putResume(romId: string, state: SaveState, thumbnail: string | null): Promise<void>;
  /** Every ROM id with a battery save, a save state or a resume state, sorted. */
  savedRomIds(): Promise<string[]>;
  saveSet(romId: string): Promise<SaveSet>;
  /**
   * Writes each imported save that is newer than the one kept here (or where
   * there is none), keeping its own time, and gives the game, if it is in the
   * library, the picture and resume time of the merged saves.
   */
  mergeSaves(imported: SaveSet): Promise<MergeCount>;
}

/**
 * A Uint8Array from any realm: IndexedDB hands back arrays made by its own
 * structured clone, which in a test page (jsdom) is not the page's Uint8Array,
 * so instanceof would refuse good data.
 */
function isBytes(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === "[object Uint8Array]";
}

function readThumbnail(value: unknown, what: string): string | null {
  const thumbnail = value ?? null;
  if (thumbnail !== null && (typeof thumbnail !== "string" || !thumbnail.startsWith("data:image/"))) {
    throw new Error(`The stored thumbnail of ${what} is not an image.`);
  }
  return thumbnail;
}

function isStateSlot(value: unknown): value is StateSlot {
  return (STATE_SLOTS as readonly unknown[]).includes(value);
}

/**
 * Records stored before thumbnails existed have no thumbnail field; they read
 * as having none. Any other shape is refused rather than shown wrongly.
 */
function readStateRecord(value: unknown): StateRecord | undefined {
  if (value === undefined) return undefined;
  const record = value as Partial<StateRecord> | null;
  if (typeof record !== "object" || record === null || typeof record.savedAt !== "number" || typeof record.state !== "object" || record.state === null) {
    throw new Error("A stored save state is not in a form this version can read.");
  }
  if (typeof record.romId !== "string") throw new Error(`A stored save state has no ROM id (found ${JSON.stringify(record.romId)}).`);
  if (!isStateSlot(record.slot)) throw new Error(`A stored save state is in slot ${JSON.stringify(record.slot)}, which is not one of slots 1 to 8.`);
  const thumbnail = readThumbnail(record.thumbnail, `slot ${record.slot}`);
  return { romId: record.romId, slot: record.slot, state: record.state, savedAt: record.savedAt, thumbnail };
}

function readResumeRecord(value: unknown): ResumeRecord | undefined {
  if (value === undefined) return undefined;
  const record = value as Partial<ResumeRecord> | null;
  if (typeof record !== "object" || record === null || typeof record.romId !== "string" || typeof record.savedAt !== "number" || typeof record.state !== "object" || record.state === null) {
    throw new Error("A stored resume state is not in a form this version can read.");
  }
  return { romId: record.romId, state: record.state, savedAt: record.savedAt, thumbnail: readThumbnail(record.thumbnail, "a resume state") };
}

function readBatteryRecord(value: unknown, romId: string): BatteryRecord | undefined {
  if (value === undefined) return undefined;
  const record = value as Partial<BatteryRecord> | null;
  if (typeof record !== "object" || record === null || !isBytes(record.data)) throw new Error(`Stored battery RAM for ${romId} is not a byte array.`);
  if (typeof record.savedAt !== "number") throw new Error(`Stored battery RAM for ${romId} has no save time.`);
  return { romId, data: record.data, savedAt: record.savedAt };
}

/** What merging an imported save set writes, and the saves the ROM has afterwards. */
interface MergePlan {
  battery: BatteryRecord | null;
  states: StateRecord[];
  resume: ResumeRecord | null;
  count: MergeCount;
  after: SaveSet;
}

/** Deliberate: equal times count as the same save, so importing one file twice writes nothing the second time. */
function planMerge(here: SaveSet, imported: SaveSet): MergePlan {
  const count: MergeCount = { written: 0, keptHere: 0 };
  const take = <T extends { savedAt: number }>(mine: T | null | undefined, theirs: T | null): T | null => {
    if (theirs === null) return null;
    if (mine && mine.savedAt >= theirs.savedAt) {
      count.keptHere++;
      return null;
    }
    count.written++;
    return theirs;
  };
  const battery = take(here.battery, imported.battery);
  const resume = take(here.resume, imported.resume);
  const states = imported.states.map((state) => take(here.states.find((mine) => mine.slot === state.slot), state)).filter((state) => state !== null);
  const afterStates = STATE_SLOTS.map((slot) => states.find((state) => state.slot === slot) ?? here.states.find((state) => state.slot === slot)).filter(
    (state) => state !== undefined,
  );
  return {
    battery,
    states,
    resume,
    count,
    after: { romId: here.romId, battery: battery ?? here.battery, states: afterStates, resume: resume ?? here.resume },
  };
}

/** The game's picture and resume time once its saves have been merged; a game with no pictured save keeps its own picture. */
function mergedSummary(game: GameRecord, after: SaveSet): Pick<GameRecord, "thumbnail" | "resumeAt"> {
  const summary = saveSummary(after.resume ?? undefined, after.states);
  return { thumbnail: summary.thumbnail ?? game.thumbnail, resumeAt: summary.resumeAt };
}

/** A record stored before patching existed has no patchedFrom field and reads as added from a file. */
function readPatchOrigin(value: unknown, fileName: string): PatchOrigin | null {
  if (value === undefined || value === null) return null;
  const origin = value as Partial<PatchOrigin>;
  if (typeof origin !== "object" || typeof origin.romId !== "string" || typeof origin.romTitle !== "string" || typeof origin.patchName !== "string") {
    throw new Error(`The stored origin of ${fileName} is not a ROM and a patch: ${JSON.stringify(value)?.slice(0, 200)}`);
  }
  return { romId: origin.romId, romTitle: origin.romTitle, patchName: origin.patchName };
}

function readGameRecord(value: unknown): GameRecord {
  const record = value as Partial<GameRecord> | null;
  const nullableNumber = (field: unknown) => field === null || typeof field === "number";
  if (
    typeof record !== "object" ||
    record === null ||
    typeof record.id !== "string" ||
    typeof record.fileName !== "string" ||
    typeof record.size !== "number" ||
    typeof record.addedAt !== "number" ||
    !nullableNumber(record.lastPlayedAt) ||
    !(record.title === null || typeof record.title === "string") ||
    typeof record.favourite !== "boolean" ||
    !nullableNumber(record.resumeAt)
  ) {
    throw new Error(`A stored library entry is not in a form this version can read: ${JSON.stringify(record)?.slice(0, 200)}`);
  }
  return {
    id: record.id,
    fileName: record.fileName,
    size: record.size,
    addedAt: record.addedAt,
    lastPlayedAt: record.lastPlayedAt!,
    title: record.title!,
    favourite: record.favourite,
    thumbnail: readThumbnail(record.thumbnail, record.fileName),
    resumeAt: record.resumeAt!,
    patchedFrom: readPatchOrigin(record.patchedFrom, record.fileName),
  };
}

/** A ROM record as the first version stored it, in its Recent list of eight. */
interface Version1Rom {
  id: string;
  name: string;
  size: number;
  lastPlayedAt: number;
  data: Uint8Array;
}

function readVersion1Rom(value: unknown): Version1Rom {
  const record = value as Partial<Version1Rom> | null;
  if (
    typeof record !== "object" ||
    record === null ||
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.size !== "number" ||
    typeof record.lastPlayedAt !== "number" ||
    !isBytes(record.data)
  ) {
    throw new Error(`A stored ROM from the Recent list is not in a form this version can read (id ${JSON.stringify(record?.id)}).`);
  }
  return record as Version1Rom;
}

function readRomData(value: unknown, id: string): Uint8Array {
  const record = value as { data?: unknown } | undefined;
  if (!isBytes(record?.data)) throw new Error(`The stored ROM ${id} is not a byte array.`);
  return record.data;
}

/** The save a game's picture comes from: its resume state or one of its slots. */
export type PicturedSave = { kind: "resume"; savedAt: number } | { kind: "slot"; slot: StateSlot; savedAt: number };

/**
 * The newest of a game's saves that has a picture. The library card shows
 * this save's picture, and opening the card offers this save first, so the
 * two must come from this one function.
 */
export function picturedSave(resume: ResumeRecord | undefined, states: StateRecord[]): (PicturedSave & { thumbnail: string }) | null {
  const candidates = [
    ...states.map((record) => ({ kind: "slot" as const, slot: record.slot, savedAt: record.savedAt, thumbnail: record.thumbnail })),
    ...(resume ? [{ kind: "resume" as const, savedAt: resume.savedAt, thumbnail: resume.thumbnail }] : []),
  ];
  const pictured = candidates.filter((save): save is typeof save & { thumbnail: string } => save.thumbnail !== null);
  return pictured.sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}

/** The newest picture among a game's saves, and when its resume state was saved. */
function saveSummary(resume: ResumeRecord | undefined, states: StateRecord[]): Pick<GameRecord, "thumbnail" | "resumeAt"> {
  return { thumbnail: picturedSave(resume, states)?.thumbnail ?? null, resumeAt: resume?.savedAt ?? null };
}

/** What opening a game can start from: the pictured save first, then the rest. */
export interface GameSaves {
  pictured: PicturedSave | null;
  resumeAt: number | null;
  slots: StateRecord[];
}

export async function gameSaves(store: GameStore, id: string): Promise<GameSaves> {
  const [resume, slots] = await Promise.all([store.getResume(id), store.listStates(id)]);
  const newest = picturedSave(resume, slots);
  const pictured: PicturedSave | null =
    newest && (newest.kind === "resume" ? { kind: "resume", savedAt: newest.savedAt } : { kind: "slot", slot: newest.slot, savedAt: newest.savedAt });
  return { pictured, resumeAt: resume?.savedAt ?? null, slots };
}

function newGame(
  id: string,
  fileName: string,
  size: number,
  addedAt: number,
  saves: Pick<GameRecord, "thumbnail" | "resumeAt">,
  patchedFrom: PatchOrigin | null = null,
): GameRecord {
  return { id, fileName, size, addedAt, lastPlayedAt: null, title: null, favourite: false, ...saves, patchedFrom };
}

/** Played most recently first, then never-played games, newest added first. */
export function byLastPlayed(a: GameRecord, b: GameRecord): number {
  return (b.lastPlayedAt ?? -Infinity) - (a.lastPlayedAt ?? -Infinity) || b.addedAt - a.addedAt;
}

function libraryOrder(games: GameRecord[]): GameRecord[] {
  return [...games].sort(byLastPlayed);
}

function cleanTitle(title: string): string | null {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function notInLibrary(id: string): Error {
  return new Error(`The game ${id.slice(0, 12)}… is not in the library.`);
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const romId = sha256Hex;

const DB_NAME = "retrowright";
/** 1: roms (the Recent list), battery, states. 2: the library (games), roms hold only data, resume. */
const DB_VERSION = 2;
const ROMS = "roms";
const GAMES = "games";
const BATTERY = "battery";
const STATES = "states";
const RESUME = "resume";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
  });
}

/**
 * Calls `each` for every record of a store, then `after`, inside the
 * transaction. An error thrown by either goes to `fail`: thrown from a
 * request's handler it would only abort the transaction, and the reason
 * would be lost.
 */
function forEachRecord(store: IDBObjectStore, each: (cursor: IDBCursorWithValue) => void, after: () => void, fail: (error: unknown) => void): void {
  const cursorRequest = store.openCursor();
  cursorRequest.onsuccess = () => {
    try {
      const cursor = cursorRequest.result;
      if (!cursor) {
        after();
        return;
      }
      each(cursor);
      cursor.continue();
    } catch (error) {
      fail(error);
    }
  };
}

/**
 * Turns the first version's Recent list into the library: each ROM becomes a
 * game played at its old time, with the newest picture among its slots, and
 * its ROM record keeps only the data. Battery RAM and slots stay where they
 * are, keyed by the same SHA-256. A record that cannot be read goes to
 * `fail`, which aborts the upgrade and leaves version 1 untouched.
 */
function migrateVersion1(tx: IDBTransaction, fail: (error: unknown) => void): void {
  const games = new Map<string, GameRecord>();
  const statesByRom = new Map<string, StateRecord[]>();
  forEachRecord(
    tx.objectStore(ROMS),
    (cursor) => {
      const old = readVersion1Rom(cursor.value);
      games.set(old.id, { ...newGame(old.id, old.name, old.size, old.lastPlayedAt, { thumbnail: null, resumeAt: null }), lastPlayedAt: old.lastPlayedAt });
      cursor.update({ id: old.id, data: old.data });
    },
    () =>
      forEachRecord(
        tx.objectStore(STATES),
        (cursor) => {
          const record = readStateRecord(cursor.value)!;
          statesByRom.set(record.romId, [...(statesByRom.get(record.romId) ?? []), record]);
        },
        () => {
          for (const game of games.values()) tx.objectStore(GAMES).put({ ...game, ...saveSummary(undefined, statesByRom.get(game.id) ?? []) });
        },
        fail,
      ),
    fail,
  );
}

export const BLOCKED_MESSAGE = "retrowright is open in another tab with an older version. Close that tab to continue.";
export const REPLACED_MESSAGE = "A newer version of retrowright was opened in another tab. Reload this page.";

/** What happens to the database while this page holds it, told to the page. */
export interface StoreEvents {
  /** Another tab holds an older version open; the open carries on by itself once that tab closes it. */
  onBlocked?(): void;
  /** Another tab opened a newer version; this page's connection is closed. */
  onReplaced?(): void;
}

export class IndexedDbGameStore implements GameStore {
  readonly persistent = true;
  private replaced = false;

  /**
   * Deliberate: the connection closes itself on versionchange, so this build
   * never blocks a newer one opened in another tab.
   */
  constructor(
    private readonly connection: IDBDatabase,
    private readonly now: () => number = Date.now,
    events: StoreEvents = {},
  ) {
    connection.onversionchange = () => {
      connection.close();
      this.replaced = true;
      events.onReplaced?.();
    };
  }

  /** The connection, or the reason it is gone: a closed one would only say "the database connection is closing". */
  private get db(): IDBDatabase {
    if (this.replaced) throw new Error(REPLACED_MESSAGE);
    return this.connection;
  }

  static async open(factory: IDBFactory, now: () => number = Date.now, events: StoreEvents = {}): Promise<IndexedDbGameStore> {
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onblocked = () => events.onBlocked?.();
    let upgradeError: unknown = null;
    open.onupgradeneeded = (event) => {
      const db = open.result;
      const tx = open.transaction!;
      if (event.oldVersion < 1) {
        db.createObjectStore(ROMS, { keyPath: "id" });
        db.createObjectStore(BATTERY, { keyPath: "romId" });
        db.createObjectStore(STATES, { keyPath: ["romId", "slot"] });
      }
      if (event.oldVersion < 2) {
        db.createObjectStore(GAMES, { keyPath: "id" });
        db.createObjectStore(RESUME, { keyPath: "romId" });
        if (event.oldVersion === 1) {
          migrateVersion1(tx, (error) => {
            upgradeError = error;
            tx.abort();
          });
        }
      }
    };
    try {
      return new IndexedDbGameStore(await request(open), now, events);
    } catch (error) {
      throw upgradeError ?? error;
    }
  }

  async addRom(fileName: string, data: Uint8Array, patchedFrom?: PatchOrigin): Promise<AddResult> {
    const id = await romId(data);
    const tx = this.db.transaction([ROMS, GAMES, STATES, RESUME], "readwrite");
    const stored = await request(tx.objectStore(GAMES).get(id));
    if (stored !== undefined) {
      await done(tx);
      return { game: readGameRecord(stored), duplicate: true };
    }
    // Saves kept from an earlier time in the library give the game its picture back.
    const resume = readResumeRecord(await request(tx.objectStore(RESUME).get(id)));
    const states = await Promise.all(STATE_SLOTS.map((slot) => request(tx.objectStore(STATES).get([id, slot]))));
    const game = newGame(id, fileName, data.length, this.now(), saveSummary(resume, states.map(readStateRecord).filter((record) => record !== undefined)), patchedFrom);
    tx.objectStore(ROMS).put({ id, data });
    tx.objectStore(GAMES).put(game);
    await done(tx);
    return { game, duplicate: false };
  }

  async putRom(fileName: string, data: Uint8Array): Promise<RomRecord> {
    const { game } = await this.addRom(fileName, data);
    await this.markPlayed(game.id);
    return { id: game.id, name: game.fileName, size: game.size, data };
  }

  async getRom(id: string): Promise<RomRecord | undefined> {
    const tx = this.db.transaction([ROMS, GAMES]);
    const [rom, game] = await Promise.all([request(tx.objectStore(ROMS).get(id)), request(tx.objectStore(GAMES).get(id))]);
    if (game === undefined) return undefined;
    const record = readGameRecord(game);
    return { id, name: record.fileName, size: record.size, data: readRomData(rom, id) };
  }

  async markPlayed(id: string): Promise<void> {
    await this.updateGame(id, () => ({ lastPlayedAt: this.now() }));
  }

  async listGames(): Promise<GameRecord[]> {
    const all = await request(this.db.transaction(GAMES).objectStore(GAMES).getAll());
    return libraryOrder(all.map(readGameRecord));
  }

  async renameGame(id: string, title: string): Promise<void> {
    await this.updateGame(id, () => ({ title: cleanTitle(title) }));
  }

  async setFavourite(id: string, favourite: boolean): Promise<void> {
    await this.updateGame(id, () => ({ favourite }));
  }

  async removeGame(id: string, { withSaves }: { withSaves: boolean }): Promise<void> {
    const tx = this.db.transaction([ROMS, GAMES, BATTERY, STATES, RESUME], "readwrite");
    tx.objectStore(ROMS).delete(id);
    tx.objectStore(GAMES).delete(id);
    if (withSaves) {
      tx.objectStore(BATTERY).delete(id);
      for (const slot of STATE_SLOTS) tx.objectStore(STATES).delete([id, slot]);
      tx.objectStore(RESUME).delete(id);
    }
    await done(tx);
  }

  async getBatteryRam(romId: string): Promise<Uint8Array | undefined> {
    return readBatteryRecord(await request(this.db.transaction(BATTERY).objectStore(BATTERY).get(romId)), romId)?.data;
  }

  async putBatteryRam(romId: string, data: Uint8Array): Promise<void> {
    const tx = this.db.transaction(BATTERY, "readwrite");
    tx.objectStore(BATTERY).put({ romId, data, savedAt: this.now() });
    await done(tx);
  }

  async getState(romId: string, slot: StateSlot): Promise<StateRecord | undefined> {
    return readStateRecord(await request(this.db.transaction(STATES).objectStore(STATES).get([romId, slot])));
  }

  async putState(romId: string, slot: StateSlot, state: SaveState, thumbnail: string | null): Promise<void> {
    const tx = this.db.transaction([STATES, GAMES], "readwrite");
    tx.objectStore(STATES).put({ romId, slot, state, savedAt: this.now(), thumbnail } satisfies StateRecord);
    const failure = thumbnail !== null ? this.updateGameIn(tx, romId, () => ({ thumbnail })) : null;
    await doneOrFailure(tx, failure);
  }

  async listStates(romId: string): Promise<StateRecord[]> {
    const states = this.db.transaction(STATES).objectStore(STATES);
    const records = await Promise.all(STATE_SLOTS.map((slot) => request(states.get([romId, slot]))));
    return records.map(readStateRecord).filter((record): record is StateRecord => record !== undefined);
  }

  async getResume(romId: string): Promise<ResumeRecord | undefined> {
    return readResumeRecord(await request(this.db.transaction(RESUME).objectStore(RESUME).get(romId)));
  }

  /**
   * Deliberate: the transaction starts before the first await. This runs from
   * pagehide, and a page being closed only finishes work already queued.
   */
  async putResume(romId: string, state: SaveState, thumbnail: string | null): Promise<void> {
    const tx = this.db.transaction([RESUME, GAMES], "readwrite");
    const savedAt = this.now();
    tx.objectStore(RESUME).put({ romId, state, savedAt, thumbnail } satisfies ResumeRecord);
    const failure = this.updateGameIn(tx, romId, (game) => ({ resumeAt: savedAt, thumbnail: thumbnail ?? game.thumbnail }));
    await doneOrFailure(tx, failure);
  }

  async savedRomIds(): Promise<string[]> {
    const tx = this.db.transaction([BATTERY, STATES, RESUME]);
    const [battery, states, resume] = await Promise.all([
      request(tx.objectStore(BATTERY).getAllKeys()),
      request(tx.objectStore(STATES).getAllKeys()),
      request(tx.objectStore(RESUME).getAllKeys()),
    ]);
    // A state's key is [romId, slot].
    const ids = [...battery, ...states.map((key) => (key as [string, number])[0]), ...resume].map(String);
    return [...new Set(ids)].sort();
  }

  async saveSet(romId: string): Promise<SaveSet> {
    return this.readSaveSet(this.db.transaction([BATTERY, STATES, RESUME]), romId);
  }

  async mergeSaves(imported: SaveSet): Promise<MergeCount> {
    const tx = this.db.transaction([BATTERY, STATES, RESUME, GAMES], "readwrite");
    const here = await this.readSaveSet(tx, imported.romId);
    const plan = planMerge(here, imported);
    if (plan.battery) tx.objectStore(BATTERY).put(plan.battery satisfies BatteryRecord);
    for (const state of plan.states) tx.objectStore(STATES).put(state satisfies StateRecord);
    if (plan.resume) tx.objectStore(RESUME).put(plan.resume satisfies ResumeRecord);
    const failure = plan.count.written > 0 ? this.updateGameIn(tx, imported.romId, (game) => mergedSummary(game, plan.after)) : null;
    await doneOrFailure(tx, failure);
    return plan.count;
  }

  private async readSaveSet(tx: IDBTransaction, romId: string): Promise<SaveSet> {
    const [battery, resume, ...states] = await Promise.all([
      request(tx.objectStore(BATTERY).get(romId)),
      request(tx.objectStore(RESUME).get(romId)),
      ...STATE_SLOTS.map((slot) => request(tx.objectStore(STATES).get([romId, slot]))),
    ]);
    return {
      romId,
      battery: readBatteryRecord(battery, romId) ?? null,
      states: states.map(readStateRecord).filter((record) => record !== undefined),
      resume: readResumeRecord(resume) ?? null,
    };
  }

  private async updateGame(id: string, change: (game: GameRecord) => Partial<GameRecord>): Promise<void> {
    const tx = this.db.transaction(GAMES, "readwrite");
    const stored = await request(tx.objectStore(GAMES).get(id));
    if (stored === undefined) {
      tx.abort();
      throw notInLibrary(id);
    }
    const game = readGameRecord(stored);
    tx.objectStore(GAMES).put({ ...game, ...change(game) });
    await done(tx);
  }

  /**
   * Updates a game in a transaction already open; a save for a game not in the
   * library (removed meanwhile) changes nothing there. Await the transaction
   * with `doneOrFailure`: a malformed record aborts it, and the abort alone
   * would not say why.
   */
  private updateGameIn(tx: IDBTransaction, id: string, change: (game: GameRecord) => Partial<GameRecord>): UpdateFailure {
    const failure: UpdateFailure = { error: null };
    const games = tx.objectStore(GAMES);
    const get = games.get(id);
    get.onsuccess = () => {
      try {
        if (get.result === undefined) return;
        const game = readGameRecord(get.result);
        games.put({ ...game, ...change(game) });
      } catch (error) {
        failure.error = error;
        tx.abort();
      }
    };
    return failure;
  }
}

interface UpdateFailure {
  error: unknown;
}

async function doneOrFailure(tx: IDBTransaction, failure: UpdateFailure | null): Promise<void> {
  try {
    await done(tx);
  } catch (error) {
    throw failure?.error ?? error;
  }
}

/** Used when IndexedDB is missing or refuses to open (some private modes). */
export class MemoryGameStore implements GameStore {
  readonly persistent = false;
  private readonly roms = new Map<string, Uint8Array>();
  private readonly games = new Map<string, GameRecord>();
  private readonly battery = new Map<string, BatteryRecord>();
  private readonly states = new Map<string, StateRecord>();
  private readonly resume = new Map<string, ResumeRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  async addRom(fileName: string, data: Uint8Array, patchedFrom?: PatchOrigin): Promise<AddResult> {
    const id = await romId(data);
    const stored = this.games.get(id);
    if (stored) return { game: { ...stored }, duplicate: true };
    const game = newGame(id, fileName, data.length, this.now(), saveSummary(this.resume.get(id), await this.listStates(id)), patchedFrom);
    this.roms.set(id, data.slice());
    this.games.set(id, game);
    return { game: { ...game }, duplicate: false };
  }

  async putRom(fileName: string, data: Uint8Array): Promise<RomRecord> {
    const { game } = await this.addRom(fileName, data);
    await this.markPlayed(game.id);
    return { id: game.id, name: game.fileName, size: game.size, data };
  }

  async getRom(id: string): Promise<RomRecord | undefined> {
    const game = this.games.get(id);
    const data = this.roms.get(id);
    return game && data && { id, name: game.fileName, size: game.size, data: data.slice() };
  }

  async markPlayed(id: string): Promise<void> {
    this.updateGame(id, { lastPlayedAt: this.now() });
  }

  async listGames(): Promise<GameRecord[]> {
    return libraryOrder([...this.games.values()].map((game) => ({ ...game })));
  }

  async renameGame(id: string, title: string): Promise<void> {
    this.updateGame(id, { title: cleanTitle(title) });
  }

  async setFavourite(id: string, favourite: boolean): Promise<void> {
    this.updateGame(id, { favourite });
  }

  async removeGame(id: string, { withSaves }: { withSaves: boolean }): Promise<void> {
    this.roms.delete(id);
    this.games.delete(id);
    if (withSaves) {
      this.battery.delete(id);
      for (const slot of STATE_SLOTS) this.states.delete(`${id}/${slot}`);
      this.resume.delete(id);
    }
  }

  async getBatteryRam(romId: string): Promise<Uint8Array | undefined> {
    return this.battery.get(romId)?.data.slice();
  }

  async putBatteryRam(romId: string, data: Uint8Array): Promise<void> {
    this.battery.set(romId, { romId, data: data.slice(), savedAt: this.now() });
  }

  async getState(romId: string, slot: StateSlot): Promise<StateRecord | undefined> {
    const record = this.states.get(`${romId}/${slot}`);
    return record && structuredClone(record);
  }

  async putState(romId: string, slot: StateSlot, state: SaveState, thumbnail: string | null): Promise<void> {
    this.states.set(`${romId}/${slot}`, structuredClone({ romId, slot, state, savedAt: this.now(), thumbnail }));
    const game = this.games.get(romId);
    if (game && thumbnail !== null) game.thumbnail = thumbnail;
  }

  async listStates(romId: string): Promise<StateRecord[]> {
    const records = await Promise.all(STATE_SLOTS.map((slot) => this.getState(romId, slot)));
    return records.filter((record): record is StateRecord => record !== undefined);
  }

  async getResume(romId: string): Promise<ResumeRecord | undefined> {
    const record = this.resume.get(romId);
    return record && structuredClone(record);
  }

  async putResume(romId: string, state: SaveState, thumbnail: string | null): Promise<void> {
    const savedAt = this.now();
    this.resume.set(romId, structuredClone({ romId, state, savedAt, thumbnail }));
    const game = this.games.get(romId);
    if (game) Object.assign(game, { resumeAt: savedAt, thumbnail: thumbnail ?? game.thumbnail });
  }

  async savedRomIds(): Promise<string[]> {
    const ids = [...this.battery.keys(), ...[...this.states.values()].map((record) => record.romId), ...this.resume.keys()];
    return [...new Set(ids)].sort();
  }

  async saveSet(romId: string): Promise<SaveSet> {
    const battery = this.battery.get(romId);
    return {
      romId,
      battery: battery ? { ...battery, data: battery.data.slice() } : null,
      states: await this.listStates(romId),
      resume: (await this.getResume(romId)) ?? null,
    };
  }

  async mergeSaves(imported: SaveSet): Promise<MergeCount> {
    const plan = planMerge(await this.saveSet(imported.romId), imported);
    if (plan.battery) this.battery.set(imported.romId, { ...plan.battery, data: plan.battery.data.slice() });
    for (const state of plan.states) this.states.set(`${state.romId}/${state.slot}`, structuredClone(state));
    if (plan.resume) this.resume.set(imported.romId, structuredClone(plan.resume));
    const game = this.games.get(imported.romId);
    if (game && plan.count.written > 0) Object.assign(game, mergedSummary(game, plan.after));
    return plan.count;
  }

  private updateGame(id: string, change: Partial<GameRecord>): void {
    const game = this.games.get(id);
    if (!game) throw notInLibrary(id);
    Object.assign(game, change);
  }
}

export type OpenedStore = { store: GameStore; problem?: string };

/** Opens IndexedDB, or explains why saves will not outlast the page. */
export async function openGameStore(factory: IDBFactory | undefined, events: StoreEvents = {}): Promise<OpenedStore> {
  if (!factory) {
    return { store: new MemoryGameStore(), problem: "This browser has no IndexedDB, so games and saves last only until the page closes." };
  }
  try {
    return { store: await IndexedDbGameStore.open(factory, Date.now, events) };
  } catch (error) {
    return {
      store: new MemoryGameStore(),
      problem: `Browser storage could not be opened (${error instanceof Error ? error.message : String(error)}), so games and saves last only until the page closes.`,
    };
  }
}
