import { parseGameProfile, PROFILE_FORMAT, type GameProfile } from "../console/gameProfile";
import { parseTunables, TUNABLES_FORMAT, type Tunables } from "../tune/tunables";

// A game's own files, found at run time: its tunables file (the Tune panel's
// sliders) and its game profile (the console's values and commands). Each is
// a JSON file for one or more ROMs by SHA-256, loaded in the page and kept per
// game in the browser, or, on the development server, found in the local ROM
// folder beside the ROM (harness/testRomsPlugin.ts serves it at /local-roms/).
// After VS Code's and RetroArch's per-game settings, found by content hash.

export const LOCAL_FOLDER = "/local-roms/";
export const GAMES_LIST = "games.json";
/** The development server marks a page it serves with a local ROM folder by a meta element of this name. */
export const LOCAL_FOLDER_META = "retrowright-local-roms";

/** True on a page the development server serves with a local ROM folder: only then does a game open look there. */
export function hasLocalFolder(): boolean {
  return document.querySelector(`meta[name="${LOCAL_FOLDER_META}"]`) !== null;
}

export interface GameFiles {
  tunables: Tunables | null;
  profile: GameProfile | null;
  /** Files that were found but could not be used, each as a sentence to show. */
  problems: string[];
}

export type LoadedGameFile = { kind: "tunables"; tunables: Tunables } | { kind: "profile"; profile: GameProfile };

const short = (sha: string) => sha.slice(0, 12);

/** A good file for other ROMs: among a folder's files, one to pass over. */
export class OtherRomError extends Error {}

/** A tunables file or a game profile, told apart by its format; throws, naming the file, when it is neither or not for this ROM. */
export function readGameFile(text: string, fileName: string, romSha256: string): LoadedGameFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${fileName} is not JSON.`);
  }
  const format = typeof data === "object" && data !== null ? (data as { format?: unknown }).format : undefined;
  if (format === TUNABLES_FORMAT) {
    const tunables = parseTunables(data, fileName);
    if (tunables.romSha256 !== romSha256) throw new OtherRomError(`${fileName} is for another ROM (SHA-256 ${short(tunables.romSha256)}…), not this one (${short(romSha256)}…).`);
    return { kind: "tunables", tunables };
  }
  if (format === PROFILE_FORMAT) {
    const profile = parseGameProfile(data, fileName);
    if (!profile.romSha256.includes(romSha256)) throw new OtherRomError(`${fileName} is a profile for other ROMs, not this one (SHA-256 ${short(romSha256)}…).`);
    return { kind: "profile", profile };
  }
  throw new Error(`${fileName} is neither a tunables file ("${TUNABLES_FORMAT}") nor a game profile ("${PROFILE_FORMAT}").`);
}

/** One game of the local ROM folder's games.json, opened by ?game=<id>. */
export interface ListedGame {
  id: string;
  label: string;
  rom: string;
  tunables?: string;
  profile?: string;
}

const plainFile = (name: unknown, extension: RegExp) => typeof name === "string" && !/[/\\]/.test(name) && !name.startsWith(".") && extension.test(name);

/** Checks a parsed games.json and throws, saying what is wrong, when it is not one. */
export function parseGamesList(data: unknown): ListedGame[] {
  const fail = (problem: string): never => {
    throw new Error(`${GAMES_LIST} in the local ROM folder cannot be read: ${problem}.`);
  };
  const games = typeof data === "object" && data !== null ? (data as { games?: unknown }).games : undefined;
  if (!Array.isArray(games)) return fail('it has no "games" list');
  const ids = new Set<string>();
  for (const game of games as Partial<ListedGame>[]) {
    if (typeof game?.id !== "string" || !/^[a-z0-9-]+$/.test(game.id) || ids.has(game.id)) fail(`${JSON.stringify(game?.id)} is not an id of its own (lower-case letters, digits and -)`);
    ids.add(game.id!);
    if (typeof game.label !== "string" || game.label.trim() === "") fail(`${game.id} has no label`);
    if (!plainFile(game.rom, /\.nes$/i)) fail(`${game.id}'s rom is not a .nes file name in the folder`);
    if (game.tunables !== undefined && !plainFile(game.tunables, /\.tunables\.json$/i)) fail(`${game.id}'s tunables is not a .tunables.json file name in the folder`);
    if (game.profile !== undefined && !plainFile(game.profile, /\.profile\.json$/i)) fail(`${game.id}'s profile is not a .profile.json file name in the folder`);
  }
  return games as ListedGame[];
}

const fileUrl = (name: string) => `${LOCAL_FOLDER}${encodeURIComponent(name)}`;

/** The served file names of the local ROM folder; null when the server has no folder. */
async function listFolder(): Promise<string[] | null> {
  const response = await fetch(LOCAL_FOLDER);
  // Deliberate: 404 is the development server started without a folder, a set-up with nothing to find, not a fault.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The local ROM folder could not be listed (HTTP ${response.status}).`);
  const listing = (await response.json()) as { files?: unknown };
  if (!Array.isArray(listing.files) || !listing.files.every((name) => typeof name === "string")) throw new Error("The local ROM folder's listing is not a list of files.");
  return listing.files as string[];
}

async function fetchText(name: string): Promise<string> {
  const response = await fetch(fileUrl(name));
  if (!response.ok) throw new Error(`${name} could not be fetched from the local ROM folder (HTTP ${response.status}).`);
  return response.text();
}

/** The games the local ROM folder's games.json lists. */
export async function localGamesList(): Promise<ListedGame[]> {
  const response = await fetch(fileUrl(GAMES_LIST));
  if (!response.ok) throw new Error(`The local ROM folder has no ${GAMES_LIST} (HTTP ${response.status}); ?game= opens the games it lists.`);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`${GAMES_LIST} in the local ROM folder is not JSON.`);
  }
  return parseGamesList(data);
}

/**
 * The tunables file and profile for a ROM in the local ROM folder: the ones a
 * games.json entry names, else `<ROM name>.tunables.json` and
 * `<ROM name>.profile.json` (the ROM's file name without .nes), else any file
 * of that kind whose SHA-256 is the ROM's. A file named for the ROM that is
 * for another ROM is a problem, not skipped quietly.
 */
export async function localGameFiles(romSha256: string, romFileName: string, named: Pick<ListedGame, "tunables" | "profile"> = {}): Promise<GameFiles> {
  const found: GameFiles = { tunables: null, profile: null, problems: [] };
  let files: string[] | null;
  try {
    files = await listFolder();
  } catch (error) {
    found.problems.push(error instanceof Error ? error.message : String(error));
    return found;
  }
  if (files === null) return found;
  const stem = romFileName.replace(/\.nes$/i, "");
  for (const kind of ["tunables", "profile"] as const) {
    const suffix = `.${kind}.json`;
    const own = named[kind] ?? `${stem}${suffix}`;
    const others = files.filter((name) => name.endsWith(suffix) && name !== own);
    const candidates = [...(files.includes(own) ? [own] : []), ...others];
    for (const name of candidates) {
      try {
        const file = readGameFile(await fetchText(name), name, romSha256);
        if (file.kind !== kind) throw new Error(`${name} is a ${file.kind === "tunables" ? "tunables file" : "game profile"}, not a ${kind === "tunables" ? "tunables file" : "game profile"}.`);
        if (file.kind === "tunables") found.tunables = file.tunables;
        else found.profile = file.profile;
        break;
      } catch (error) {
        // A file of another ROM is expected among the others; one named for this ROM, or one that cannot be read, is shown.
        if (name === own || !(error instanceof OtherRomError)) found.problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (named[kind] && !files.includes(named[kind]!)) found.problems.push(`${GAMES_LIST} names ${named[kind]}, which is not in the local ROM folder.`);
  }
  return found;
}
