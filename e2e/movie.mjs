// Browser check of movies in headless Firefox, with the page opened with
// ?debug: loads Final Fantasy, records a short movie from power-on with the
// quick menu's Record button and the keyboard, marks a checkpoint, stops (the
// download is caught, not saved), then plays the movie back through "Play
// movie" and checks that its checkpoint passes, that is, that the replay's
// screen hash matches the recording's.
//
// Usage: npm run build && node e2e/movie.mjs [output-dir]
// Not part of `npm test`: it needs Firefox and a ROM that is never committed.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { startStaticServer } from "./staticServer.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");
const ROM = join(ROOT, "roms", "Final_Fantasy_USA.nes");
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "movie-page"));
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";

if (!existsSync(ROM)) {
  console.log(`SKIP: ${ROM} is missing. Put a Final Fantasy (USA) ROM there to run this check.`);
  process.exit(0);
}
if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/index.html is missing: run `npm run build` first.");
  process.exit(1);
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
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

const status = (page) => page.evaluate(() => window.__retrowright.movieStatus());

/** Holds a key until the recording has run `frames` more frames. */
async function hold(page, key, frames) {
  const target = (await status(page)).frame + frames;
  await page.keyboard.down(key);
  await waitFor(page, `frame ${target}`, (wanted) => window.__retrowright.movieStatus().frame >= wanted, target);
  await page.keyboard.up(key);
}

async function idle(page, frames) {
  const target = (await status(page)).frame + frames;
  await waitFor(page, `frame ${target}`, (wanted) => window.__retrowright.movieStatus().frame >= wanted, target);
}

async function tap(page, key) {
  await page.keyboard.down(key);
  await sleep(100);
  await page.keyboard.up(key);
}

/** Opens the quick menu with Esc and its movie view with the arrow keys and Enter. */
async function openMovieMenu(page) {
  await tap(page, "Escape");
  await waitFor(page, "the menu", () => document.querySelector("[role=dialog]") !== null);
  for (let step = 0; step < 12 && !(await page.evaluate(() => document.activeElement?.dataset.item === "movie")); step++) await tap(page, "ArrowDown");
  await tap(page, "Enter");
  await waitFor(page, "the movie view", () => document.querySelector(".movie-bar") !== null);
}

async function closeMenu(page) {
  while (await page.evaluate(() => document.querySelector("[role=dialog]") !== null)) await tap(page, "Escape");
}

await mkdir(OUT, { recursive: true });
const server = await startStaticServer({ root: DIST, subPath: "/", ports: [0] });
// ?debug installs window.__retrowright, which a production build leaves out otherwise.
const url = `http://127.0.0.1:${server.port}/?debug`;
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
let exitCode = 0;
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.log(`pageerror: ${error.message}`));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("#rom-input");
  await (await page.$("#rom-input")).uploadFile(ROM);
  // A single added file starts at once.
  await waitFor(page, "the game to load", () => window.__retrowright?.game);

  // Record from power-on with battery RAM cleared: prologue, Start, New Game.
  await openMovieMenu(page);
  await page.select(".record-from select", "power-on-clear");
  await page.click("button.record");
  await waitFor(page, "recording", () => window.__retrowright.movieStatus().mode === "recording");
  await closeMenu(page);
  check("the recording indicator shows under the picture", await page.$(".play-bar .rec-indicator"), await page.$eval(".play-bar .rec-indicator", (node) => node.textContent));
  await idle(page, 240);
  await hold(page, "Enter", 6);
  await idle(page, 60);
  await hold(page, "ArrowDown", 6);
  await idle(page, 10);
  await hold(page, "KeyX", 6);
  await idle(page, 90);
  // The menu pauses the game, so the mark and the hash read here are of the same frame.
  await openMovieMenu(page);
  await page.click("button.mark");
  const recordedHash = await page.evaluate(() => window.__retrowright.screenHash());
  await page.screenshot({ path: join(OUT, "01-recording-marked.png"), fullPage: true });
  await closeMenu(page);
  await idle(page, 30);

  // Stop: catch the download link instead of saving a file.
  await page.evaluate(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__downloaded = this.download;
      else click.call(this);
    };
  });
  await openMovieMenu(page);
  await page.click("button.record");
  const downloaded = await waitFor(page, "the movie download", () => window.__downloaded);
  check("Stop offers the movie as a .rwmovie.json download", downloaded.endsWith(".rwmovie.json"), downloaded);
  const movieText = await page.evaluate(() => window.__retrowright.lastRecording());
  const movie = JSON.parse(movieText);
  const moviePath = join(OUT, "recorded.rwmovie.json");
  await writeFile(moviePath, movieText);
  check("the movie has inputs, a start at power-on and the mark", movie.inputs.length >= 6 && movie.start.kind === "power-on" && movie.checkpoints.length === 1, {
    frames: movie.frames,
    inputs: movie.inputs.length,
    checkpoint: movie.checkpoints[0],
  });
  check("the mark holds the screen hash shown when it was made", movie.checkpoints[0]?.expect.screenHash === recordedHash, { recordedHash });

  // Play it back with the keyboard held, which the locked-out pads must ignore.
  // Choosing the file closes the menu.
  await (await page.$("#movie-input")).uploadFile(moviePath);
  await waitFor(page, "playback", () => window.__retrowright.movieStatus().mode === "playing");
  await page.keyboard.down("ArrowLeft");
  await page.screenshot({ path: join(OUT, "02-playing.png"), fullPage: true });
  const played = await waitFor(page, "the movie to finish", () => {
    const now = window.__retrowright.movieStatus();
    return now.finished && now;
  }, undefined, 120000);
  await page.keyboard.up("ArrowLeft");
  const result = played.results[0];
  check("the replay's checkpoint passes: its screen hash matches the recording's", played.results.length === 1 && result.passed, result);
  await waitFor(page, "the finish notice", () => [...document.querySelectorAll(".notice")].some((node) => node.textContent.includes("Movie finished")));
  await page.screenshot({ path: join(OUT, "03-finished.png"), fullPage: true });
} catch (error) {
  exitCode = 1;
  check("the run finished", false, String(error?.stack ?? error));
} finally {
  await browser.close();
  await server.stop();
}
await writeFile(join(OUT, "results.json"), JSON.stringify(checks, null, 2));
const failed = checks.filter((item) => !item.ok).length;
console.log(`${checks.length - failed} passed, ${failed} failed.`);
process.exit(exitCode || (failed > 0 ? 1 : 0));
