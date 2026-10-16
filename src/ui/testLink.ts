// Test links, on the development server only: /?play=local-roms/<file>&label=<text>
// opens a ROM from the folder named by RETROWRIGHT_TEST_ROMS (served by
// harness/testRomsPlugin.ts), with a label banner and, with &controls=1, the
// controls panel for that tab; &movie=local-movies/<file> then plays a movie
// from the same folder from its start; /?game=<id> opens a game the folder's
// games.json lists, under its label. App reads them only when
// import.meta.env.DEV, so a production build leaves this module out.

const ROM_FOLDER = "local-roms/";
const MOVIE_FOLDER = "local-movies/";

/** A file a test link fetches from the development server. */
export interface TestLinkFile {
  fileName: string;
  url: string;
}

/** A test link that opens a ROM of the folder; `title` names its library entry. */
export interface PlayLink {
  ok: true;
  fileName: string;
  url: string;
  label: string | null;
  controls: boolean;
  movie: TestLinkFile | null;
  title: string | null;
}

/**
 * /?game=<id>: a game the test ROM folder's games.json lists, read when the
 * page starts (src/ui/gameFiles.ts), so the page's code names no game.
 */
export interface NamedGameLink {
  ok: true;
  gameId: string;
}

export type TestLink = PlayLink | NamedGameLink | { ok: false; problem: string };

/** A games.json entry as the link it stands for: its ROM, its label as the banner, the tab's title and the library's name, and the controls. */
export function listedGameLink(game: { label: string; rom: string }): PlayLink {
  return { ok: true, ...fileIn(ROM_FOLDER, `${ROM_FOLDER}${game.rom}`)!, label: game.label, controls: true, movie: null, title: game.label };
}

/** The plain file name after `folder`, or null when the value has a folder part of its own or names none. */
function fileIn(folder: string, value: string): TestLinkFile | null {
  const fileName = value.startsWith(folder) ? value.slice(folder.length) : "";
  if (fileName === "" || /[/\\]/.test(fileName)) return null;
  return { fileName, url: `/${folder}${encodeURIComponent(fileName)}` };
}

/** The test link in a page's query string, or null when it has none. */
export function parseTestLink(search: string): TestLink | null {
  const params = new URLSearchParams(search);
  const gameName = params.get("game");
  if (gameName !== null) {
    if (!/^[a-z0-9-]+$/.test(gameName)) return { ok: false, problem: `Test link: game=${gameName} is not a game id (lower-case letters, digits and -).` };
    return { ok: true, gameId: gameName };
  }
  const play = params.get("play");
  if (play === null) return null;
  const rom = fileIn(ROM_FOLDER, play);
  if (!rom) return { ok: false, problem: `Test link: play=${play} is not a file in ${ROM_FOLDER}; use play=${ROM_FOLDER}<file name>.` };
  const moviePath = params.get("movie");
  const movie = moviePath === null ? null : fileIn(MOVIE_FOLDER, moviePath);
  if (moviePath !== null && !movie) {
    return { ok: false, problem: `Test link: movie=${moviePath} is not a file in ${MOVIE_FOLDER}; use movie=${MOVIE_FOLDER}<file name>.` };
  }
  const label = params.get("label")?.trim() || null;
  return { ok: true, ...rom, label, controls: params.get("controls") === "1", movie, title: null };
}

/**
 * The notice for a test link's file the server did not give. `serverText` is
 * the server's own reason, which tells a missing file from a server started
 * without the folder.
 */
export function missingTestFile(fileName: string, status: number, serverText: string): string {
  const reason = serverText.trim() || `HTTP ${status}`;
  return status === 404 ? `Test link: “${fileName}” was not found. ${reason}` : `Test link: “${fileName}” could not be fetched (HTTP ${status}). ${reason}`;
}
