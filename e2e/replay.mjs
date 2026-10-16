// Browser check of the instant replay, in headless Firefox with the page
// opened with ?debug, on a synthetic ROM whose backdrop colour steps on every
// frame (its NMI increments the RAM byte the program paints), so every frame's
// picture differs from the one before.
//
// The replay is set to 30 seconds in the menu's Movies view, to keep the run
// short. The game runs with pad keys held and let go for more than the window
// and a state interval; then, with Right held, R saves the last 30 seconds
// (the download is caught, not saved). The movie must start from a save state, hold 30 to 35
// seconds and end in a checkpoint of the picture's hash; played back through
// Play movie, its checkpoint must pass. The buffer's states and bytes are
// read twice while playing, ten seconds apart, and must not grow. Screenshots,
// the movie, results.json and an index.html go to .out/page/replay/,
// or the directory given. The ROM stays in a temporary folder, removed after.
//
// Usage: npm run build && npm run e2e:replay [-- output-dir]
// Not part of `npm test`: it needs Firefox.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { buildInes, SHOW_RAM_COLOUR_PROGRAM } from "../src/test/syntheticRom.ts";
import { startStaticServer } from "./staticServer.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "replay"));
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";
const WINDOW_SECONDS = 30;
/** INC $00 / RTI: the painted colour steps on once a frame. */
const STEP_COLOUR_NMI_HANDLER = [0xe6, 0x00, 0x40];
const ROM_NAME = "Colour Steps (Synthetic)";

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/index.html is missing: run `npm run build` first.");
  process.exit(1);
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

const screenshots = [];
async function shot(page, file, caption) {
  await page.screenshot({ path: join(OUT, file) });
  screenshots.push({ file, caption });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitFor(page, description, predicate, arg, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    const value = await page.evaluate(predicate, arg);
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${description}.`);
    await sleep(50);
  }
}

const framesRun = (page) => page.evaluate(() => window.__retrowright.framesRun);

/** Waits until `frames` more frames have run. */
async function idle(page, frames) {
  const target = (await framesRun(page)) + frames;
  await waitFor(page, `frame ${target}`, (wanted) => window.__retrowright.framesRun >= wanted, target, 120000);
}

async function hold(page, keys, frames) {
  for (const key of keys) await page.keyboard.down(key);
  await idle(page, frames);
  for (const key of keys) await page.keyboard.up(key);
}

await mkdir(OUT, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), "retrowright-replay-"));
const romFile = join(scratch, `${ROM_NAME}.nes`);
await writeFile(romFile, buildInes({ program: SHOW_RAM_COLOUR_PROGRAM, nmiHandler: STEP_COLOUR_NMI_HANDLER }));

let exitCode = 0;
let server = null;
try {
  server = await startStaticServer({ root: DIST, subPath: "/", ports: [0] });
  const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.log(`pageerror: ${error.message}`));
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:${server.port}/?debug`, { waitUntil: "load" });
    await waitFor(page, "the player", () => window.__retrowright !== undefined);
    await (await page.$("#rom-input")).uploadFile(romFile);
    await waitFor(page, "the ROM to run", () => window.__retrowright.framesRun > 30);
    await page.focus("canvas.screen");

    // The length is set in the menu's Movies view.
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-item=movie]");
    await page.click("[data-item=movie]");
    await page.waitForSelector("[data-item=replay-seconds]");
    await page.select("[data-item=replay-seconds]", String(WINDOW_SECONDS));
    await shot(page, "01-movies-view.png", "The Movies view with the instant replay set to 30 seconds");
    while (await page.evaluate(() => document.querySelector("[role=dialog]") !== null)) await page.keyboard.press("Escape");
    check("the setting is kept", (await page.evaluate(() => localStorage.getItem("retrowright.replay"))) === `{"seconds":${WINDOW_SECONDS}}`);

    // Keys held and let go, so the movie has inputs to hold.
    await idle(page, 60);
    await hold(page, ["Enter"], 6);
    await idle(page, 200);
    const started = await framesRun(page);
    let firstStats = null;
    while ((await framesRun(page)) - started < (WINDOW_SECONDS + 15) * 60) {
      await hold(page, ["ArrowRight", "KeyZ"], 40);
      await hold(page, ["ArrowRight", "KeyZ", "KeyX"], 20);
      if (!firstStats && (await framesRun(page)) - started > (WINDOW_SECONDS + 5) * 60) firstStats = await page.evaluate(() => window.__retrowright.replayStats());
    }
    const lastStats = await page.evaluate(() => window.__retrowright.replayStats());
    // R is pressed with Right held, on a picture that changes every frame.
    await page.keyboard.down("ArrowRight");
    await idle(page, 2);
    check("the buffer does not grow once full: no more states or bytes ten seconds on", firstStats && lastStats.states <= firstStats.states && lastStats.bytes <= firstStats.bytes * 1.05, {
      first: firstStats,
      last: lastStats,
      megabytes: (lastStats.bytes / 1e6).toFixed(1),
    });
    await shot(page, "02-playing.png", "The synthetic ROM running, its backdrop stepping on each frame, just before R");

    // R saves the last 30 seconds: catch the download link and read its blob.
    await page.evaluate(() => {
      window.__downloads = [];
      HTMLAnchorElement.prototype.click = function () {
        window.__downloads.push({ name: this.download, href: this.href });
      };
    });
    const endHash = await page.evaluate(() => window.__retrowright.screenHash());
    await page.keyboard.press("KeyR");
    const download = await waitFor(page, "the replay download", () => window.__downloads[0]);
    await page.keyboard.up("ArrowRight");
    check("R downloads a .rwmovie.json named after the game", /^Colour Steps \(Synthetic\)-replay-.+\.rwmovie\.json$/.test(download.name), download.name);
    const movieText = await page.evaluate((href) => fetch(href).then((response) => response.text()), download.href);
    const movie = JSON.parse(movieText);
    const moviePath = join(OUT, "replay.rwmovie.json");
    await writeFile(moviePath, movieText);
    const seconds = movie.frames / 60.0988;
    check("the movie starts from a save state and holds the last 30 to 35 seconds", movie.start.kind === "save-state" && seconds >= WINDOW_SECONDS && seconds < WINDOW_SECONDS + 5.1, {
      frames: movie.frames,
      seconds: seconds.toFixed(1),
      inputs: movie.inputs.length,
    });
    // The menu was closed and the game ran on between reading the hash and the key reaching the page, so the end is read from the movie.
    check("it ends in a checkpoint of the picture's hash", movie.checkpoints.length === 1 && movie.checkpoints[0].frame === movie.frames && /^fnv1a32:/.test(movie.checkpoints[0].expect.screenHash ?? ""), {
      checkpoint: movie.checkpoints[0],
      hashBeforeR: endHash,
    });
    await waitFor(page, "the notice", () => [...document.querySelectorAll(".notice")].some((node) => node.textContent.includes("Saved the last")));
    await shot(page, "03-saved-notice.png", "The notice after R");

    // Play it back through Play movie; its checkpoint is the final hash.
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-item=movie]");
    await page.click("[data-item=movie]");
    await (await page.waitForSelector("#movie-input")).uploadFile(moviePath);
    await waitFor(page, "playback", () => window.__retrowright.movieStatus().mode === "playing");
    check("the instant replay is not kept while the movie plays", (await page.evaluate(() => window.__retrowright.replayStats())) === null);
    const played = await waitFor(page, "the movie to finish", () => {
      const now = window.__retrowright.movieStatus();
      return now.finished && now;
    }, undefined, 180000);
    check("the replay reaches the same final screen hash", played.results.length === 1 && played.results[0].passed, played.results[0]);
    await shot(page, "04-replayed.png", "The replay's last frame, with its finish notice");
  } finally {
    await browser.close();
  }
} catch (error) {
  exitCode = 1;
  check("the run finished", false, String(error?.stack ?? error));
} finally {
  await server?.stop();
  await rm(scratch, { recursive: true, force: true });
}

await writeFile(join(OUT, "results.json"), JSON.stringify(checks, null, 2));
const rows = checks.map((item) => `<li>${item.ok ? "PASS" : "FAIL"} ${item.name}</li>`).join("\n");
const figures = screenshots.map((item) => `<figure><img src="${item.file}" alt="${item.caption}" width="640"><figcaption>${item.caption}</figcaption></figure>`).join("\n");
await writeFile(join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><title>Instant replay</title>\n<h1>The instant replay (e2e/replay.mjs)</h1>\n<ul>\n${rows}\n</ul>\n${figures}\n`);
const failed = checks.filter((item) => !item.ok).length;
console.log(`${checks.length - failed} passed, ${failed} failed.`);
process.exit(exitCode || (failed > 0 ? 1 : 0));
