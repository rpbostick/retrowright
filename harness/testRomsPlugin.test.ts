import { spawnSync } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildInes } from "../src/test/syntheticRom";
import { LOCAL_FOLDER_META } from "../src/ui/gameFiles";
import { loadNamePatterns, namesIn } from "./nameScan";
import { TEST_ROMS_VARIABLE } from "./testRomsPlugin";

// Runs the project's own vite.config.ts, as `npm run dev` and `npm run build` do.

const ROOT = resolve(import.meta.dirname, "..");
const CONFIG = join(ROOT, "vite.config.ts");
const ROM_NAME = "Test Link Marker (Rev 7).nes";
const ROM = buildInes({ battery: true });
const MOVIE_NAME = "Bot Run (board).rwmovie.json";
const MOVIE_TEXT = '{"format":"retrowright-movie"}\n';
const TUNABLES_NAME = "Test Link Marker (Rev 7).tunables.json";
const PROFILE_NAME = "marker.profile.json";
const GAMES_TEXT = { name: "games.json", text: '{"games":[]}\n' };

let folder: string;
let vite: ViteDevServer | null = null;
let http: Server | null = null;
const savedVariable = process.env[TEST_ROMS_VARIABLE];

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "retrowright-test-roms-"));
  await writeFile(join(folder, ROM_NAME), ROM);
  await writeFile(join(folder, "notes.txt"), "not a ROM");
  await writeFile(join(folder, MOVIE_NAME), MOVIE_TEXT);
  await writeFile(join(folder, TUNABLES_NAME), "{}");
  await writeFile(join(folder, PROFILE_NAME), "{}");
  await writeFile(join(folder, GAMES_TEXT.name), GAMES_TEXT.text);
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

afterEach(async () => {
  if (savedVariable === undefined) delete process.env[TEST_ROMS_VARIABLE];
  else process.env[TEST_ROMS_VARIABLE] = savedVariable;
  await new Promise<void>((done) => (http ? http.close(() => done()) : done()));
  await vite?.close();
  http = null;
  vite = null;
});

/** Starts the development server with the variable as given (undefined: unset) and returns its origin. */
async function startDevServer(variable: string | undefined): Promise<string> {
  if (variable === undefined) delete process.env[TEST_ROMS_VARIABLE];
  else process.env[TEST_ROMS_VARIABLE] = variable;
  vite = await createServer({ configFile: CONFIG, root: ROOT, logLevel: "silent", server: { middlewareMode: true } });
  const server = createHttpServer(vite.middlewares);
  http = server;
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Accept as a browser's address bar sends it: the page fallback answers such requests with index.html. */
const get = (url: string) => fetch(url, { headers: { accept: "text/html,*/*" } });

describe("test links on the development server", () => {
  it("serve the folder's .nes files read-only at /local-roms/ with the variable set", async () => {
    const origin = await startDevServer(folder);
    const response = await get(`${origin}/local-roms/${encodeURIComponent(ROM_NAME)}`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(ROM);

    const missing = await get(`${origin}/local-roms/Nothing%20Here.nes`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("No Nothing Here.nes in the test ROM folder.");
    for (const path of ["/local-roms/notes.txt", "/local-roms/..%2Fpasswd.nes", "/local-roms/sub%2Fgame.nes", "/local-roms/.hidden.nes", "/local-roms/other.json"]) {
      expect((await get(`${origin}${path}`)).status, path).toBe(404);
    }
    const put = await fetch(`${origin}/local-roms/${encodeURIComponent(ROM_NAME)}`, { method: "PUT", body: "x" });
    expect(put.status).toBe(405);
  });

  it("serve a game's tunables file, game profile and the folder's games.json beside the ROMs, list them at /local-roms/, and mark the page", async () => {
    const origin = await startDevServer(folder);
    const listing = await get(`${origin}/local-roms/`);
    expect(listing.headers.get("content-type")).toBe("application/json");
    expect(await listing.json()).toEqual({ files: [ROM_NAME, GAMES_TEXT.name, PROFILE_NAME, TUNABLES_NAME].sort() });
    for (const name of [TUNABLES_NAME, PROFILE_NAME, GAMES_TEXT.name]) {
      const response = await get(`${origin}/local-roms/${encodeURIComponent(name)}`);
      expect(response.status, name).toBe(200);
      expect(response.headers.get("content-type"), name).toBe("application/json");
      expect(await response.text(), name).toBe(name === GAMES_TEXT.name ? GAMES_TEXT.text : "{}");
    }
    const page = await (await get(`${origin}/`)).text();
    expect(page).toContain(`<meta name="${LOCAL_FOLDER_META}" content="1">`);
  });

  it("serve the same folder's .rwmovie.json files read-only at /local-movies/", async () => {
    const origin = await startDevServer(folder);
    const response = await get(`${origin}/local-movies/${encodeURIComponent(MOVIE_NAME)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.text()).toBe(MOVIE_TEXT);

    const missing = await get(`${origin}/local-movies/Nothing.rwmovie.json`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("No Nothing.rwmovie.json in the test ROM folder.");
    for (const path of ["/local-movies/", `/local-movies/${encodeURIComponent(ROM_NAME)}`, "/local-movies/notes.txt", "/local-movies/..%2Fx.rwmovie.json", "/local-movies/.hidden.rwmovie.json"]) {
      expect((await get(`${origin}${path}`)).status, path).toBe(404);
    }
    expect((await get(`${origin}/local-roms/${encodeURIComponent(MOVIE_NAME)}`)).status).toBe(404);
    expect((await fetch(`${origin}/local-movies/${encodeURIComponent(MOVIE_NAME)}`, { method: "PUT", body: "x" })).status).toBe(405);
  });

  it("answer 404 at /local-roms/ without the variable, where the page fallback would answer with index.html", async () => {
    const origin = await startDevServer(undefined);
    expect((await get(`${origin}/elsewhere/${encodeURIComponent(ROM_NAME)}`)).status).toBe(200);
    for (const path of ["/local-roms/", `/local-roms/${encodeURIComponent(ROM_NAME)}`, `/local-movies/${encodeURIComponent(MOVIE_NAME)}`]) {
      expect((await get(`${origin}${path}`)).status, path).toBe(404);
    }
    expect(await (await get(`${origin}/`)).text()).not.toContain(LOCAL_FOLDER_META);
  });

  it("refuse to start when the variable names no folder", async () => {
    await expect(startDevServer(join(folder, ROM_NAME))).rejects.toThrow(`${TEST_ROMS_VARIABLE} names ${join(folder, ROM_NAME)}, which is not a folder.`);
  });
});

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

describe("the production build", () => {
  it("has no trace of test links, the test ROM folder or a name the name-scan file lists, even built with the variable set", { timeout: 180_000 }, async () => {
    const names = loadNamePatterns(ROOT)?.patterns ?? [];
    const outDir = await mkdtemp(join(tmpdir(), "retrowright-build-"));
    try {
      // A child process, as `npm run build` runs vite: Vitest's own NODE_ENV would make the build a development one.
      const env: NodeJS.ProcessEnv = { ...process.env, [TEST_ROMS_VARIABLE]: folder };
      delete env.NODE_ENV;
      const run = spawnSync(process.execPath, [join(ROOT, "node_modules/vite/bin/vite.js"), "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"], { cwd: ROOT, env, encoding: "utf8" });
      expect(run.status, run.stderr).toBe(0);
      const files = await filesUnder(outDir);
      expect(files.some((file) => file.endsWith("index.html"))).toBe(true);
      for (const file of files) {
        const text = await readFile(file, "latin1");
        for (const trace of ["local-roms", "local-movies", folder, "Test Link Marker", TEST_ROMS_VARIABLE]) {
          expect(text.includes(trace), `${trace} in ${file}`).toBe(false);
        }
        expect(namesIn(text, names), file).toEqual([]);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
