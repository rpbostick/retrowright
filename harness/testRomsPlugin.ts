import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Connect, Plugin } from "vite";
import { LOCAL_FOLDER_META } from "../src/ui/gameFiles";

// Test links: the development server serves the .nes files of the folder
// named by RETROWRIGHT_TEST_ROMS at /local-roms/ (with each game's tunables
// file, game profile and the folder's games.json, and at /local-roms/ itself
// the list of those names) and its .rwmovie.json files at /local-movies/,
// read-only, so a page URL such as
// /?play=local-roms/<file>&movie=local-movies/<file>&label=<text> opens a
// build and plays a movie on it straight away. The plugin applies to `vite`
// (serve) alone: a build never sees the folder.

export const TEST_ROMS_PATH = "/local-roms/";
export const TEST_MOVIES_PATH = "/local-movies/";
export const TEST_ROMS_VARIABLE = "RETROWRIGHT_TEST_ROMS";

/** What one path of the plugin serves from the folder. */
interface Served {
  extension: RegExp;
  refused: string;
  contentType: string;
  /** Whether the path itself answers with the names it serves. */
  listed: boolean;
}

/**
 * Beside each ROM, a game's own files: its tunables file, its game profile,
 * and the folder's games.json, which ?game=<id> reads (src/ui/gameFiles.ts).
 */
const ROMS: Served = {
  extension: /(?:\.nes|\.tunables\.json|\.profile\.json)$|^games\.json$/i,
  refused: "Test links serve .nes, .tunables.json and .profile.json files and games.json from the test ROM folder itself.",
  contentType: "application/octet-stream",
  listed: true,
};
const MOVIES: Served = { extension: /\.rwmovie\.json$/i, refused: "Test links serve .rwmovie.json files from the test ROM folder itself.", contentType: "application/json", listed: false };

const contentType = (name: string, served: Served) => (/\.json$/i.test(name) ? "application/json" : served.contentType);

/** A plain file name with the served extension: no folder part, so a request never leaves the folder. */
function servedFileName(requestPath: string, extension: RegExp): string | null {
  let name: string;
  try {
    name = decodeURIComponent(requestPath.replace(/^\//, ""));
  } catch {
    return null;
  }
  if (name === "" || name.startsWith(".") || /[/\\\0]/.test(name) || !extension.test(name)) return null;
  return name;
}

function serveFrom(root: string | null, served: Served): Connect.NextHandleFunction {
  return (request, response) => {
    const notFound = (text: string) => response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end(text);
    if (!root) return void notFound(`No test ROM folder: start the development server with ${TEST_ROMS_VARIABLE} set to one.`);
    if (request.method !== "GET" && request.method !== "HEAD") return void response.writeHead(405, { allow: "GET, HEAD" }).end();
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/" && served.listed) {
      // The folder itself: the names it serves, so the page can look for a game's files by their contents.
      readdir(root).then(
        (names) => {
          const body = JSON.stringify({ files: names.filter((name) => servedFileName(`/${encodeURIComponent(name)}`, served.extension) !== null).sort() });
          response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(request.method === "HEAD" ? undefined : body);
        },
        (error: unknown) => response.writeHead(500).end(String(error)),
      );
      return;
    }
    const name = servedFileName(path, served.extension);
    if (!name) return void notFound(served.refused);
    readFile(join(root, name)).then(
      (data) => response.writeHead(200, { "content-type": contentType(name, served), "content-length": data.length, "cache-control": "no-store" }).end(request.method === "HEAD" ? undefined : data),
      (error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? notFound(`No ${name} in the test ROM folder.`) : response.writeHead(500).end(String(error))),
    );
  };
}

export function testRomsPlugin(folder: string | undefined): Plugin {
  const root = folder ? resolve(folder) : null;
  return {
    name: "retrowright-test-roms",
    apply: "serve",
    // The page looks in the folder for a game's own files only when it is told there is one.
    transformIndexHtml: () => (root ? [{ tag: "meta", attrs: { name: LOCAL_FOLDER_META, content: "1" }, injectTo: "head" }] : []),
    async configureServer(server) {
      if (root && !(await stat(root).catch(() => null))?.isDirectory()) {
        throw new Error(`${TEST_ROMS_VARIABLE} names ${root}, which is not a folder.`);
      }
      // Deliberate: registered without the variable too, answering 404, since
      // the server's page fallback would otherwise answer /local-roms/<file> with index.html.
      server.middlewares.use(TEST_ROMS_PATH, serveFrom(root, ROMS));
      server.middlewares.use(TEST_MOVIES_PATH, serveFrom(root, MOVIES));
    },
  };
}
