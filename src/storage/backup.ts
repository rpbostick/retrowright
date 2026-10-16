import type { SaveState } from "../core/types";
import { decodeBase64, encodeBase64 } from "../movie/format";
import { romId, STATE_SLOTS, type GameStore, type ResumeRecord, type SaveSet, type StateRecord, type StateSlot } from "./gameStore";
import { isSettingKey, restoreSettings, type Settings } from "./settingsSnapshot";

// The .rwbackup.json file: everything kept in this browser, to carry to
// another browser or keep as a copy. One JSON file is enough (a save state is
// a few hundred kilobytes of JSON, a thumbnail a data: URL, a ROM base64), so
// no archive format is needed. Versioned like the .rwmovie.json format: a
// file of a newer version is refused rather than read wrongly.
//
// Saves are keyed by the ROM's SHA-256, so they match the same game in any
// browser; saves for a game not added there yet wait until its ROM is added.

export const BACKUP_FORMAT = "retrowright-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_EXTENSION = ".rwbackup.json";

export interface BackupGame {
  sha256: string;
  fileName: string;
  title: string | null;
  favourite: boolean;
  /** The ROM file in base64, or null when the backup was made without ROMs. */
  rom: string | null;
}

export interface BackupSaves {
  sha256: string;
  battery: { data: string; savedAt: number } | null;
  states: Array<{ slot: StateSlot; savedAt: number; thumbnail: string | null; state: SaveState }>;
  resume: { savedAt: number; thumbnail: string | null; state: SaveState } | null;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  /** When the backup was made, in milliseconds since 1970. */
  exportedAt: number;
  games: BackupGame[];
  saves: BackupSaves[];
  /** The page's settings, or null in a backup of one game. */
  settings: Settings | null;
}

export interface BackupOptions {
  /** The games to back up; all of them, and every save kept here, when undefined. */
  gameIds?: string[];
  includeRoms: boolean;
  settings: Settings | null;
  now: number;
}

function savesToBackup(set: SaveSet): BackupSaves {
  return {
    sha256: set.romId,
    battery: set.battery && { data: encodeBase64(set.battery.data), savedAt: set.battery.savedAt },
    states: set.states.map(({ slot, savedAt, thumbnail, state }) => ({ slot, savedAt, thumbnail, state })),
    resume: set.resume && { savedAt: set.resume.savedAt, thumbnail: set.resume.thumbnail, state: set.resume.state },
  };
}

function hasSaves(set: SaveSet): boolean {
  return set.battery !== null || set.states.length > 0 || set.resume !== null;
}

export async function buildBackup(store: GameStore, options: BackupOptions): Promise<Backup> {
  const library = await store.listGames();
  const wanted = options.gameIds ? new Set(options.gameIds) : null;
  const games = wanted ? library.filter((game) => wanted.has(game.id)) : library;
  if (wanted && games.length !== wanted.size) throw new Error("A game to back up is no longer in the library.");
  const backupGames: BackupGame[] = [];
  for (const game of games) {
    let rom: string | null = null;
    if (options.includeRoms) {
      const record = await store.getRom(game.id);
      if (!record) throw new Error(`The ROM of ${game.fileName} is not stored in this browser.`);
      rom = encodeBase64(record.data);
    }
    backupGames.push({ sha256: game.id, fileName: game.fileName, title: game.title, favourite: game.favourite, rom });
  }
  // A whole backup also keeps the saves of games removed from the library with their saves kept.
  const ids = wanted ? [...wanted].sort() : await store.savedRomIds();
  const sets = await Promise.all(ids.map((id) => store.saveSet(id)));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: options.now,
    games: backupGames,
    saves: sets.filter(hasSaves).map(savesToBackup),
    settings: options.settings,
  };
}

export function serializeBackup(backup: Backup): string {
  return `${JSON.stringify(backup)}\n`;
}

class BackupFormatError extends Error {
  constructor(message: string) {
    super(`Not a retrowright backup this page can read: ${message}`);
  }
}

function fail(message: string): never {
  throw new BackupFormatError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: unknown, where: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(`${where} must be a SHA-256 in 64 lowercase hex digits.`);
  return value;
}

function savedAt(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${where} must be a time in milliseconds.`);
  return value;
}

function thumbnail(value: unknown, where: string): string | null {
  if (value !== null && (typeof value !== "string" || !value.startsWith("data:image/"))) fail(`${where} must be null or a data:image/ URL.`);
  return value;
}

function saveState(value: unknown, where: string): SaveState {
  if (!isRecord(value) || typeof value.core !== "string" || !("data" in value)) fail(`${where} is not a save state.`);
  return { core: value.core, data: value.data };
}

function base64(value: unknown, where: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail(`${where} must be base64 text.`);
  return value;
}

function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(`${where} must be a list.`);
  return value;
}

function parseGame(value: unknown, index: number): BackupGame {
  const where = `games[${index}]`;
  if (!isRecord(value)) fail(`${where} is not an object.`);
  if (typeof value.fileName !== "string" || value.fileName === "") fail(`${where}.fileName must be a file name.`);
  if (value.title !== null && typeof value.title !== "string") fail(`${where}.title must be null or text.`);
  if (typeof value.favourite !== "boolean") fail(`${where}.favourite must be true or false.`);
  return {
    sha256: sha256(value.sha256, `${where}.sha256`),
    fileName: value.fileName,
    title: value.title,
    favourite: value.favourite,
    rom: value.rom === null ? null : base64(value.rom, `${where}.rom`),
  };
}

function parseSaves(value: unknown, index: number): BackupSaves {
  const where = `saves[${index}]`;
  if (!isRecord(value)) fail(`${where} is not an object.`);
  const battery = value.battery;
  if (battery !== null && !isRecord(battery)) fail(`${where}.battery must be null or an object.`);
  const resume = value.resume;
  if (resume !== null && !isRecord(resume)) fail(`${where}.resume must be null or an object.`);
  const states = list(value.states, `${where}.states`).map((state, stateIndex) => {
    const at = `${where}.states[${stateIndex}]`;
    if (!isRecord(state)) fail(`${at} is not an object.`);
    if (!(STATE_SLOTS as readonly unknown[]).includes(state.slot)) fail(`${at}.slot must be one of slots 1 to 8.`);
    return { slot: state.slot as StateSlot, savedAt: savedAt(state.savedAt, `${at}.savedAt`), thumbnail: thumbnail(state.thumbnail, `${at}.thumbnail`), state: saveState(state.state, `${at}.state`) };
  });
  if (new Set(states.map((state) => state.slot)).size !== states.length) fail(`${where}.states names a slot twice.`);
  return {
    sha256: sha256(value.sha256, `${where}.sha256`),
    battery: battery && { data: base64(battery.data, `${where}.battery.data`), savedAt: savedAt(battery.savedAt, `${where}.battery.savedAt`) },
    states,
    resume: resume && {
      savedAt: savedAt(resume.savedAt, `${where}.resume.savedAt`),
      thumbnail: thumbnail(resume.thumbnail, `${where}.resume.thumbnail`),
      state: saveState(resume.state, `${where}.resume.state`),
    },
  };
}

function parseSettings(value: unknown): Settings | null {
  if (value === null) return null;
  if (!isRecord(value)) fail("settings must be null or an object.");
  for (const [key, setting] of Object.entries(value)) {
    if (!isSettingKey(key) || typeof setting !== "string") fail(`settings has ${JSON.stringify(key)}, which is not a retrowright setting.`);
  }
  return value as Settings;
}

/** Checks a parsed JSON value field by field; throws naming the first problem. */
export function parseBackup(json: unknown): Backup {
  if (!isRecord(json) || json.format !== BACKUP_FORMAT) fail(`format must be "${BACKUP_FORMAT}".`);
  if (typeof json.version === "number" && Number.isInteger(json.version) && json.version > BACKUP_VERSION) {
    throw new Error(
      `This backup was made by a newer version of retrowright (backup format ${json.version}); this page reads format ${BACKUP_VERSION}. Import it into the newer version of the page.`,
    );
  }
  if (json.version !== BACKUP_VERSION) fail(`version ${JSON.stringify(json.version)} is not supported; this page reads version ${BACKUP_VERSION}.`);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: savedAt(json.exportedAt, "exportedAt"),
    games: list(json.games, "games").map(parseGame),
    saves: list(json.saves, "saves").map(parseSaves),
    settings: parseSettings(json.settings),
  };
}

function saveSetFrom(saves: BackupSaves): SaveSet {
  const id = saves.sha256;
  return {
    romId: id,
    battery: saves.battery && { romId: id, data: decodeBase64(saves.battery.data), savedAt: saves.battery.savedAt },
    states: saves.states.map((state): StateRecord => ({ romId: id, ...state })),
    resume: saves.resume && ({ romId: id, ...saves.resume } satisfies ResumeRecord),
  };
}

export interface RestoreReport {
  savesWritten: number;
  /** Saves left as they were because the one already here was as new or newer. */
  savesKeptHere: number;
  gamesAdded: number;
  /** Games whose saves were imported but which are not in the library: they wait for their ROM. */
  waitingForRom: number;
  settingsRestored: boolean;
}

/**
 * Saves first, then ROMs: a game added from the backup then gets its picture
 * from the saves already merged. A game already in the library keeps its own
 * title and favourite.
 */
export async function restoreBackup(store: GameStore, backup: Backup, settingsStorage: Storage | undefined): Promise<RestoreReport> {
  const report: RestoreReport = { savesWritten: 0, savesKeptHere: 0, gamesAdded: 0, waitingForRom: 0, settingsRestored: false };
  for (const saves of backup.saves) {
    const count = await store.mergeSaves(saveSetFrom(saves));
    report.savesWritten += count.written;
    report.savesKeptHere += count.keptHere;
  }
  for (const game of backup.games) {
    if (game.rom === null) continue;
    const data = decodeBase64(game.rom);
    if ((await romId(data)) !== game.sha256) throw new Error(`The ROM of ${game.fileName} in the backup does not match its SHA-256; the file is damaged.`);
    const { duplicate } = await store.addRom(game.fileName, data);
    if (duplicate) continue;
    report.gamesAdded++;
    if (game.title !== null) await store.renameGame(game.sha256, game.title);
    if (game.favourite) await store.setFavourite(game.sha256, true);
  }
  const library = new Set((await store.listGames()).map((game) => game.id));
  report.waitingForRom = backup.saves.filter((saves) => !library.has(saves.sha256)).length;
  if (backup.settings && settingsStorage) {
    restoreSettings(settingsStorage, backup.settings);
    report.settingsRestored = true;
  }
  return report;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);

/** One sentence for the page after an import. */
export function restoreSummary(report: RestoreReport): string {
  const parts = [`Imported ${plural(report.savesWritten, "save", "saves")}`];
  if (report.gamesAdded > 0) parts.push(`added ${plural(report.gamesAdded, "game", "games")}`);
  if (report.settingsRestored) parts.push("restored the settings");
  let text = `${parts.join(", ")}.`;
  if (report.savesKeptHere === 1) text += " 1 save was kept as it was here, being as new or newer.";
  if (report.savesKeptHere > 1) text += ` ${report.savesKeptHere} saves were kept as they were here, being as new or newer.`;
  if (report.waitingForRom === 1) text += " Saves for 1 game not in the library wait until you add its ROM.";
  if (report.waitingForRom > 1) text += ` Saves for ${report.waitingForRom} games not in the library wait until you add their ROMs.`;
  return text;
}
