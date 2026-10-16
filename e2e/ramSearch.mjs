// Browser check of the tools panel in headless Firefox, with the page opened
// with ?debug: loads Final Fantasy, turns the Developer tools setting on and
// plays movies/ff1-new-game.rwmovie.json,
// then, with the keyboard alone, opens the tools panel (F4) and searches for
// the map byte $48 as the Node test in src/tools/ramSearch.test.ts does:
// equal to 0 on the world map, equal to 8 inside Coneria Castle, unchanged
// back outside. It adds the one result to the watch list and checks that the
// watch is still there after a reload.
//
// Usage: npm run build && npm run e2e:ram-search [-- output-dir]
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
const MOVIE = join(ROOT, "movies", "ff1-new-game.rwmovie.json");
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "ram-search"));
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";
const MAP_BYTE = 0x48;
/** Movie frames each step is taken between: the map byte is 0 on the world map, 8 in the castle before $6F7C turns 8 too, and the movie ends outside. */
const WORLD_MAP = [2560, 2740];
const IN_CASTLE = [2770, 2836];

for (const [file, what] of [
  [ROM, "a Final Fantasy (USA) ROM"],
  [MOVIE, "the ff1-new-game movie"],
]) {
  if (!existsSync(file)) {
    console.log(`SKIP: ${file} is missing. Put ${what} there to run this check.`);
    process.exit(0);
  }
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
    await sleep(20);
  }
}

const movieFrame = (page) => page.evaluate(() => window.__retrowright.movieStatus().frame);
/** The focused control's aria-label, or its data-tool name. */
const focusedTool = (page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.dataset.tool ?? null);
const countText = (page) => page.$eval("[data-tool=count]", (node) => node.textContent);

/** Waits for the movie to reach `first`, and fails when it is already past `last`: a step taken outside its window would test nothing. */
async function waitForWindow(page, [first, last], what) {
  await waitFor(page, `movie frame ${first}`, (wanted) => window.__retrowright.movieStatus().frame >= wanted, first, 120000);
  const frame = await movieFrame(page);
  if (frame > last) throw new Error(`The movie was at frame ${frame}, past ${last}, before ${what}.`);
  return frame;
}

await mkdir(OUT, { recursive: true });
const server = await startStaticServer({ root: DIST, subPath: "/", ports: [0] });
const url = `http://127.0.0.1:${server.port}/?debug`;
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
let exitCode = 0;
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.log(`pageerror: ${error.message}`));
  await page.setViewport({ width: 1280, height: 1000 });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("#rom-input");
  await (await page.$("#rom-input")).uploadFile(ROM);
  await waitFor(page, "the game to load", () => window.__retrowright?.game);

  // Setup, not part of the search: turn Developer tools on in Display and speed, which the tools panel needs, then play the movie from the menu's movie view.
  await page.focus("canvas.screen");
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-item=display]");
  await page.click("[data-item=display]");
  await page.waitForSelector("[data-item=developer-tools]");
  await page.click("[data-item=developer-tools]");
  check("the menu's Display and speed turns Developer tools on", (await page.$eval("[data-item=developer-tools]", (button) => button.textContent)) === "Developer tools: on");
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-item=movie]");
  await page.click("[data-item=movie]");
  await (await page.waitForSelector("#movie-input")).uploadFile(MOVIE);
  await waitFor(page, "playback", () => window.__retrowright.movieStatus().mode === "playing");

  // From here on, the keyboard alone.
  await page.focus("canvas.screen");
  await page.keyboard.press("F4");
  await page.waitForSelector(".tools-panel");
  check("F4 opens the tools panel with focus on the search's comparison", (await focusedTool(page)) === "comparison-equal", await focusedTool(page));
  const framesBefore = await page.evaluate(() => window.__retrowright.framesRun);
  await page.keyboard.press("Tab");
  check("Tab reaches the value field", (await focusedTool(page)) === "value", await focusedTool(page));
  await page.keyboard.type("0");

  const firstFrame = await waitForWindow(page, WORLD_MAP, "the first step");
  await page.keyboard.press("Enter");
  const afterFirst = await countText(page);
  check("step 1, equal to 0 on the world map", afterFirst.endsWith("after 1 step"), { frame: firstFrame, count: afterFirst });
  check("the game keeps running while the panel is open", (await page.evaluate(() => window.__retrowright.framesRun)) > framesBefore);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("8");

  const secondFrame = await waitForWindow(page, IN_CASTLE, "the second step");
  await page.keyboard.press("Enter");
  const afterSecond = await countText(page);
  check("step 2, equal to 8 inside the castle", afterSecond.endsWith("after 2 steps"), { frame: secondFrame, count: afterSecond });
  await page.screenshot({ path: join(OUT, "01-in-castle-two-steps.png") });

  await waitFor(page, "the movie to finish", () => window.__retrowright.movieStatus().finished, undefined, 120000);
  // Shift+Tab to the comparisons; the arrows move from Equal to Unchanged, and Tab skips the value field, now disabled, to Filter.
  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowDown");
  check("the arrows choose Unchanged", (await focusedTool(page)) === "comparison-unchanged", await focusedTool(page));
  await page.keyboard.press("Tab");
  check("Tab reaches Filter", (await focusedTool(page)) === "filter", await focusedTool(page));
  await page.keyboard.press("Enter");
  const afterThird = await countText(page);
  const results = await page.$$eval(".candidates tbody tr", (rows) => rows.map((row) => Number(row.dataset.address)));
  check("step 3, unchanged outside, leaves the map byte $48 alone", afterThird === "1 candidate after 3 steps" && results.length === 1 && results[0] === MAP_BYTE, { count: afterThird, results });
  check("the arrows and Enter typed in the panel left no button held in the game",(await page.evaluate(() => window.__retrowright.heldButtons())).length === 0);

  for (let step = 0; step < 10 && (await focusedTool(page)) !== "Watch $0048"; step++) await page.keyboard.press("Tab");
  check("Tab reaches Watch $0048", (await focusedTool(page)) === "Watch $0048", await focusedTool(page));
  await page.keyboard.press("Enter");
  await page.waitForSelector(`.watches tr[data-address="${MAP_BYTE}"]`);
  const watchValue = await page.$eval(`.watches tr[data-address="${MAP_BYTE}"] [data-tool=watch-value]`, (node) => node.textContent);
  check("the watch list shows $48 with the map's value, 8", watchValue === "8", watchValue);
  await page.screenshot({ path: join(OUT, "02-found-and-watched.png") });

  await page.keyboard.press("Escape");
  await waitFor(page, "the panel to close", () => document.querySelector(".tools-panel") === null);
  check("Esc closes the panel and focus goes back to the picture", await page.evaluate(() => document.activeElement?.classList.contains("screen")));

  // A reload: the watch list is kept for this ROM.
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".card-open");
  await page.click(".card-open");
  await waitFor(page, "the game to load again", () => window.__retrowright?.game);
  await page.focus("canvas.screen");
  await page.keyboard.press("F4");
  await page.waitForSelector(".tools-panel");
  const kept = await page.$$eval(".watches tbody tr", (rows) => rows.map((row) => ({ address: Number(row.dataset.address), name: row.querySelector("input")?.value })));
  check("after a reload the watch list still holds $48", kept.length === 1 && kept[0].address === MAP_BYTE && kept[0].name === "$0048", kept);
  await page.screenshot({ path: join(OUT, "03-after-reload.png") });
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
