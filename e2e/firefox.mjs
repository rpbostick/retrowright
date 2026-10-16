// Browser check in headless Firefox over WebDriver BiDi (puppeteer-core).
// Serves the built dist/ under a sub-path and opens it with ?debug, adds
// Final Fantasy to the library through the file input (one file starts at once),
// presses Start through the title, and checks that the picture moves and that
// sound starts after a click. It then drives the quick menu with the keyboard
// alone: Esc pauses, Reset keeps battery RAM, Save state fills a slot, and
// after a page reload Continue brings the game back with battery RAM, the save
// state and the slots' thumbnails and times. In the library it adds the other
// ROMs under roms/ and a duplicate, stars and renames games, and closes the
// tab mid-game to check that Continue on a new page shows the same frame. It
// records every request the page makes and checks that none leaves the page's
// own files. First, in a fresh browser context, another page holds the first
// version's database open: the library must say so, and once that page closes
// it, Add must work without a reload. The page also shows what e2e/touch.mjs,
// e2e/backup.mjs and e2e/display.mjs wrote beside it. Writes screenshots (the library empty and with games, the menu,
// slot grid and controls diagram, in light and dark, at desktop and phone
// width), results.json and an index.html to the output directory.
//
// Usage: npm run build && node e2e/firefox.mjs [output-dir]
// Not part of `npm test`: it needs Firefox and a ROM that is never committed.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { startStaticServer } from "./staticServer.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");
const ROM = join(ROOT, "roms", "Final_Fantasy_USA.nes");
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page"));
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";
const SUB_PATH = "/retrowright/";
const OLD_TAB_PAGE = "e2e-old-tab.html";
const PORTS = [8790, 8791, 8792, 8793, 8794, 8795, 8796, 8797, 8798, 8799];

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
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}


const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitFor(page, description, predicate, arg, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const value = await page.evaluate(predicate, arg);
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${description}.`);
    await sleep(100);
  }
}

const framesRun = (page) => page.evaluate(() => window.__retrowright?.framesRun ?? 0);

async function waitFrames(page, count) {
  const target = (await framesRun(page)) + count;
  await waitFor(page, `${count} more frames`, (wanted) => (window.__retrowright?.framesRun ?? 0) >= wanted, target);
}

async function canvasDigest(page) {
  const dataUrl = await page.evaluate(() => document.querySelector("canvas.screen").toDataURL("image/png"));
  return createHash("sha256").update(dataUrl).digest("hex").slice(0, 16);
}

const shots = [];
async function shoot(page, name, caption, selector = "canvas.screen") {
  const path = join(OUT, `${name}.png`);
  if (selector) await (await page.$(selector)).screenshot({ path });
  else await page.screenshot({ path, fullPage: true });
  shots.push({ file: `${name}.png`, caption });
}

/** Holds a key for a few frames; returns the buttons the core saw held meanwhile. */
async function press(page, key, holdFrames = 8) {
  await page.keyboard.down(key);
  await sleep(50);
  const held = await page.evaluate(() => window.__retrowright?.heldButtons() ?? []);
  await waitFrames(page, holdFrames);
  await page.keyboard.up(key);
  return held;
}

/** For hotkeys and menu keys, which need no frames to run. */
async function tap(page, key) {
  await page.keyboard.down(key);
  await sleep(100);
  await page.keyboard.up(key);
}

const menuOpen = (page) => page.evaluate(() => document.querySelector("[role=dialog]") !== null);

async function openMenu(page) {
  await tap(page, "Escape");
  await waitFor(page, "the menu to open", () => document.querySelector("[role=dialog]") !== null);
}

/** Presses the down arrow until the element matching `selector` has focus. */
async function focusItem(page, selector) {
  for (let step = 0; step < 24; step++) {
    if (await page.evaluate((wanted) => document.activeElement?.matches(wanted) ?? false, selector)) return;
    await tap(page, "ArrowDown");
  }
  throw new Error(`The arrow keys never reached ${selector}.`);
}

/** Moves focus to an item with the arrow keys and presses Enter on it. */
async function choose(page, selector) {
  await focusItem(page, selector);
  await tap(page, "Enter");
}

const noticeShown = (page, text) =>
  waitFor(page, `the notice "${text}"`, (wanted) => [...document.querySelectorAll(".notice")].some((node) => node.textContent.includes(wanted)), text);

/** Screenshots of the menu, the load grid and the controls diagram (A being remapped), all reached by keyboard. */
async function menuShots(page, label, caption) {
  await openMenu(page);
  await shoot(page, `menu-${label}`, `The quick menu, ${caption}.`, null);
  await choose(page, "[data-item=load]");
  await waitFor(page, "the slot grid", () => document.querySelector(".slot-grid") !== null);
  await shoot(page, `slots-${label}`, `Load state: the slot grid, ${caption}.`, null);
  await tap(page, "Escape");
  await choose(page, "[data-item=controls]");
  await choose(page, "button.key[data-action=A]");
  await waitFor(page, "the lit A button", () => document.querySelector(".pad-part.lit[data-button=A]") !== null);
  await shoot(page, `controls-${label}`, `Controls: remapping A lights A on the pad diagram, ${caption}.`, null);
  await tap(page, "Escape"); // cancels the remapping
  await tap(page, "Escape"); // back to the menu
  await tap(page, "Escape"); // closes it
  await waitFor(page, "the menu to close", () => document.querySelector("[role=dialog]") === null);
}

const keyLog = (page) => page.evaluate(() => window.__keyLog ?? []);

/** Clicks the header's theme button until the page shows `wanted` ("light" or "dark"). */
async function setTheme(page, wanted) {
  for (let step = 0; step < 3; step++) {
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) === wanted) return;
    await page.click(".top .theme");
    await sleep(100);
  }
  throw new Error(`The theme button never reached ${wanted}.`);
}

const libraryCards = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-card]")].map((card) => ({
      title: card.querySelector(".card-title").textContent,
      tags: card.querySelector(".card-tags")?.textContent ?? null,
      picture: card.querySelector(".card-picture img")?.src.slice(0, 16) ?? null,
      placeholder: card.querySelector(".card-placeholder")?.textContent ?? null,
      favourite: card.querySelector(".card-star").getAttribute("aria-pressed") === "true",
    })),
  );

/** Every ROM under roms/ besides Final Fantasy, to fill the library. */
async function otherRoms() {
  const names = (await readdir(join(ROOT, "roms"))).filter((name) => name.toLowerCase().endsWith(".nes") && join(ROOT, "roms", name) !== ROM);
  return names.map((name) => join(ROOT, "roms", name));
}

/** Screenshots of the library page in light and dark, at desktop and phone width. */
async function libraryShots(page, kind, caption) {
  for (const [width, height, widthLabel] of [
    [1280, 900, "desktop"],
    [390, 844, "phone"],
  ]) {
    await page.setViewport({ width, height });
    for (const theme of ["light", "dark"]) {
      await setTheme(page, theme);
      await sleep(200);
      await shoot(page, `library-${kind}-${theme}-${widthLabel}`, `The library, ${caption}: ${theme} theme, ${width} wide.`, null);
    }
  }
  await page.setViewport({ width: 1280, height: 900 });
  await setTheme(page, "light");
}

async function bundleSize() {
  const files = await readdir(join(DIST, "assets"));
  const sizes = {};
  for (const file of files) sizes[file] = (await stat(join(DIST, "assets", file))).size;
  return sizes;
}

function htmlEscape(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

async function writeReport(results) {
  await writeFile(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const rows = results.checks
    .map((item) => `<tr><td>${item.ok ? "✅" : "❌"}</td><td>${htmlEscape(item.name)}</td><td><code>${htmlEscape(JSON.stringify(item.detail ?? ""))}</code></td></tr>`)
    .join("\n");
  const figure = (shot) => `<figure><img src="${shot.file}" alt="${htmlEscape(shot.caption)}"><figcaption>${htmlEscape(shot.caption)}</figcaption></figure>`;
  const isMenuShot = (shot) => /^(menu|slots|controls|library)-/.test(shot.file);
  const rowsOf = (kinds) =>
    kinds.map((kind) => `<div class="row">${results.screenshots.filter((shot) => shot.file.startsWith(`${kind}-`)).map(figure).join("\n")}</div>`).join("\n");
  // The library, then the menu, slot grid and controls, in every theme and width side by side, before the run's own screenshots.
  const libraryFigures = rowsOf(["library-empty", "library-games", "library-list"]);
  const menuFigures = rowsOf(["menu", "slots", "controls"]);
  const figures = results.screenshots.filter((shot) => !isMenuShot(shot)).map(figure).join("\n");
  // e2e/touch.mjs writes into touch/ beside this page; its orientations and themes are shown here, its steps on its own page.
  const touchResults = join(OUT, "touch", "results.json");
  const touch = existsSync(touchResults) ? JSON.parse(await readFile(touchResults, "utf8")) : null;
  const touchSection = touch
    ? `<h2>Touch play: portrait and landscape, light and dark</h2><p>${touch.passed}/${touch.checks.length} checks passed (${htmlEscape(touch.when)}); Final Fantasy step by step on <a href="touch/index.html">the touch page</a>.</p><div class="row">${touch.screenshots
        .filter((shot) => shot.file.startsWith("theme-"))
        .map((shot) => figure({ ...shot, file: `touch/${shot.file}` }))
        .join("\n")}</div>`
    : "<h2>Touch play</h2><p>Not run: <code>node e2e/touch.mjs</code> writes it.</p>";
  // e2e/backup.mjs writes into backup/ beside this page: first run, and saves carried from one profile to another.
  const backupResults = join(OUT, "backup", "results.json");
  const backup = existsSync(backupResults) ? JSON.parse(await readFile(backupResults, "utf8")) : null;
  const backupSection = backup
    ? `<h2>First run and saves carried to another browser</h2><p>${backup.checks.filter((item) => item.ok).length}/${backup.checks.length} checks passed (${htmlEscape(backup.when)}).</p><ul>${backup.checks
        .map((item) => `<li>${item.ok ? "PASS" : "FAIL"} ${htmlEscape(item.name)}</li>`)
        .join("")}</ul><div class="row">${backup.screenshots.map((shot) => figure({ ...shot, file: `backup/${shot.file}` })).join("\n")}</div>`
    : "<h2>First run and saves</h2><p>Not run: <code>node e2e/backup.mjs</code> writes it.</p>";
  // e2e/display.mjs writes into display/ beside this page, and into display-before/ when given a build from before the display options.
  const displayResults = join(OUT, "display", "results.json");
  const beforeResults = join(OUT, "display-before", "results.json");
  const display = existsSync(displayResults) ? JSON.parse(await readFile(displayResults, "utf8")) : null;
  const before = existsSync(beforeResults) ? JSON.parse(await readFile(beforeResults, "utf8")) : null;
  const sizeShots = (run, dir) => run.screenshots.filter((shot) => shot.file.startsWith("size-")).map((shot) => figure({ ...shot, file: `${dir}/${shot.file}` }));
  const displaySection = display
    ? `<h2>Display and speed: before beside after at three window sizes</h2><p>${display.passed}/${display.checks.length} checks passed (${htmlEscape(display.when)}); fast-forward, screenshots and the reload on <a href="display/index.html">the display page</a>.</p>${
        before ? `<h3>Before: the build without display options</h3><div class="row">${sizeShots(before, "display-before").join("\n")}</div>` : "<p>No before run: <code>node e2e/display.mjs out/display-before &lt;old-dist&gt;</code> writes it.</p>"
      }<h3>After: integer scaling with the 8:7 pixel aspect (the defaults)</h3><div class="row">${sizeShots(display, "display").join("\n")}</div><div class="row">${display.screenshots
        .filter((shot) => !shot.file.startsWith("size-"))
        .map((shot) => figure({ ...shot, file: `display/${shot.file}` }))
        .join("\n")}</div><ul>${display.checks.map((item) => `<li>${item.ok ? "PASS" : "FAIL"} ${htmlEscape(item.name)}</li>`).join("")}</ul>`
    : "<h2>Display and speed</h2><p>Not run: <code>node e2e/display.mjs</code> writes it.</p>";
  const bundle = Object.entries(results.bundleBytes)
    .map(([file, bytes]) => `<tr><td><code>${htmlEscape(file)}</code></td><td>${(bytes / 1024).toFixed(1)} KiB</td></tr>`)
    .join("\n");
  await writeFile(
    join(OUT, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>retrowright: Firefox check</title>
<style>body{font-family:system-ui,sans-serif;max-width:1100px;margin:1rem auto;padding:0 1rem}
figure{display:inline-block;margin:.5rem;vertical-align:top;max-width:520px}figure img{max-width:100%;image-rendering:pixelated;border:1px solid #ccc}
.row{display:flex;gap:.5rem;align-items:flex-start;overflow-x:auto}.row figure{flex:0 0 auto;max-width:none}.row figure img{max-height:520px;width:auto}
td{padding:.2rem .5rem;vertical-align:top}code{font-size:.85em;word-break:break-all}</style>
<h1>retrowright: headless Firefox check</h1>
<p>${htmlEscape(results.when)} · Firefox ${htmlEscape(results.browser)} · served under <code>${SUB_PATH}</code> · ${results.passed}/${results.checks.length} checks passed</p>
${displaySection}
<h2>Library: empty and with games, light and dark, desktop and phone width</h2>${libraryFigures}
${touchSection}
${backupSection}
<h2>Network requests</h2><p>${results.requests.length} requests, ${results.foreignRequests.length} outside the page's own files${results.foreignRequests.length ? `: <code>${htmlEscape(results.foreignRequests.join(" "))}</code>` : ""}.</p>
<h2>Quick menu: light and dark, desktop and phone width</h2>${menuFigures}
<h2>Measured frame rate</h2><p>${results.measuredFps.toFixed(2)} emulated frames per second (NES NTSC is 60.10), over ${results.fpsSample.seconds.toFixed(1)} s: ${results.fpsSample.frames} frames.</p>
<h2>Bundle size</h2><table>${bundle}<tr><td>total</td><td>${(Object.values(results.bundleBytes).reduce((a, b) => a + b, 0) / 1024).toFixed(1)} KiB</td></tr></table>
<h2>Checks</h2><table>${rows}</table>
<h2>Screenshots</h2>${figures}
`,
  );
}

await mkdir(OUT, { recursive: true });
// dist/ is served only under SUB_PATH, so any absolute asset URL would 404. The old
// tab's page is of the origin but not the app; its icon is inline, so Firefox fetches no /favicon.ico.
const server = await startStaticServer({
  root: DIST,
  subPath: SUB_PATH,
  ports: PORTS,
  pages: { [OLD_TAB_PAGE]: '<!doctype html><link rel="icon" href="data:,"><title>old tab</title>' },
});
const { port } = server;
// ?debug installs window.__retrowright, which a production build leaves out otherwise.
const url = `http://127.0.0.1:${port}${SUB_PATH}?debug`;
console.log(`Serving dist/ at ${url}`);
const browser = await puppeteer.launch({
  browser: "firefox",
  executablePath: FIREFOX,
  headless: true,
  protocol: "webDriverBiDi",
});
const consoleLines = [];
/** Every URL any page of the run requested; none may leave the page's own files. */
const requests = [];
const ownFiles = `http://127.0.0.1:${port}${SUB_PATH}`;
const isOwn = (requested) => requested.startsWith(ownFiles) || /^(data|blob|about):/.test(requested);
function watch(page) {
  page.on("console", (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`pageerror: ${error.message}`));
  page.on("request", (request) => requests.push(request.url()));
  return page;
}
/**
 * Another page of the origin holds the database open at version 1, as a tab
 * of an earlier build would; the library asks for version 2 and is blocked.
 * Runs in its own browser context, whose storage starts empty.
 */
async function blockedByOldTab() {
  const context = await browser.createBrowserContext();
  try {
    const oldTab = watch(await context.newPage());
    // Any page of the origin will do; this one is not the app, so it opens nothing itself.
    await oldTab.goto(`${ownFiles}${OLD_TAB_PAGE}`, { waitUntil: "load" });
    await oldTab.evaluate(
      () =>
        new Promise((resolveOpen, reject) => {
          const open = indexedDB.open("retrowright", 1);
          open.onupgradeneeded = () => {
            open.result.createObjectStore("roms", { keyPath: "id" });
            open.result.createObjectStore("battery", { keyPath: "romId" });
            open.result.createObjectStore("states", { keyPath: ["romId", "slot"] });
          };
          open.onsuccess = () => {
            window.__oldDb = open.result;
            resolveOpen();
          };
          open.onerror = () => reject(open.error);
        }),
    );
    const page = watch(await context.newPage());
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForSelector("#rom-input");
    await noticeShown(page, "retrowright is open in another tab with an older version. Close that tab to continue.");
    await (await page.$("#rom-input")).uploadFile(ROM);
    await noticeShown(page, "The library is still opening…");
    const cardsWhileBlocked = await page.evaluate(() => document.querySelectorAll("[data-card]").length);
    await shoot(page, "00-blocked-by-old-tab", "Another tab holds the first version's database open: the library says so, and Add games waits.", null);
    check("with another page holding the version-1 database open, the library says so and adds nothing yet", cardsWhileBlocked === 0, { cardsWhileBlocked });

    await oldTab.evaluate(() => window.__oldDb.close());
    // A single file chosen starts at once.
    await waitFor(page, "the game chosen while blocked to start", () => window.__retrowright?.game);
    await noticeShown(page, "Added 1 game.");
    const after = await page.evaluate(() => ({
      game: window.__retrowright.game,
      blockedNotice: [...document.querySelectorAll(".notice")].some((node) => node.textContent.includes("open in another tab")),
    }));
    await shoot(page, "00-unblocked", "After the other tab closed the database: the game chosen while blocked was added and started, without a reload.", null);
    check("after that page closes the database, the game chosen meanwhile is added and started in the same page and the notice goes", after.game !== null && !after.blockedNotice, after);
    // Add once more from the library, now that the store is open: it answers at once.
    await openMenu(page);
    await choose(page, "[data-item=quit]");
    await page.waitForSelector("#rom-input");
    await (await page.$("#rom-input")).uploadFile(ROM);
    await noticeShown(page, "is already in the library");
    const again = await page.evaluate(() => ({
      notice: [...document.querySelectorAll(".notice")].map((node) => node.textContent).find((text) => text.includes("is already in the library")) ?? null,
      cards: document.querySelectorAll("[data-card]").length,
    }));
    check("Add works again in the same page without a reload: the file is named as already there", again.notice !== null && again.cards === 1, again);
  } finally {
    await context.close();
  }
}

let exitCode = 0;
let measuredFps = 0;
let fpsSample = { frames: 0, seconds: 0 };
try {
  await blockedByOldTab();
  let page = watch(await browser.newPage());
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("#rom-input");
  await shoot(page, "01-empty-page", "The library before any game is added (light theme, 1280 wide).", null);
  const audioBefore = await page.evaluate(() => window.__retrowright?.audio());
  // The theme button's clicks here are the first user gestures, which let sound start.
  await libraryShots(page, "empty", "empty");
  await page.mouse.click(20, 200);
  const audioState = await waitFor(page, "the AudioContext to run", () => window.__retrowright?.audio().state === "running" && window.__retrowright.audio().state, undefined, 10000).catch(() => null);
  check("sound is off before the first click", audioBefore?.state === "not started", audioBefore);

  // A single file chosen starts at once.
  const input = await page.$("#rom-input");
  await input.uploadFile(ROM);
  await waitFor(page, "the game to load", () => window.__retrowright?.game);
  await waitFrames(page, 150);
  const audioStats = await page.evaluate(() => window.__retrowright.audio());
  console.log(`audio after the first click: ${JSON.stringify(audioStats)}`);
  check("the AudioWorklet runs after the first click", audioState === "running" && audioStats.quanta > 0 && audioStats.clock > 0, audioStats);

  const firstDigest = await canvasDigest(page);
  // The prologue holds each line for a while; 120 frames always reach the next.
  await waitFrames(page, 120);
  const secondDigest = await canvasDigest(page);
  check("the canvas changes between frames", firstDigest !== secondDigest, { firstDigest, secondDigest });
  await shoot(page, "02-ff1-boot", "Final Fantasy after loading from the file input.");

  // The prologue text scrolls in; Start skips to the title menu.
  await waitFrames(page, 240);
  await shoot(page, "03-ff1-prologue", "The prologue, before any key is pressed.");
  await page.evaluate(() => {
    window.__keyLog = [];
    document.addEventListener("keydown", (event) => window.__keyLog.push(`${event.key}/${event.code}`), true);
  });
  const heldStart = await press(page, "Enter");
  check("the Enter key reaches the core as Start", heldStart.includes("1:Start"), { heldStart, keys: await keyLog(page) });
  await waitFrames(page, 60);
  await shoot(page, "04-ff1-after-start", "After pressing Enter (Start): the title menu.");

  // The cursor starts on Continue; with no saved game yet, A (X key) goes on
  // to party creation, the opening of a new game.
  const heldA = await press(page, "KeyX");
  check("the X key reaches the core as A", heldA.includes("1:A"), heldA);
  await waitFrames(page, 90);
  await shoot(page, "05-ff1-new-game", "After pressing X (A) on the title menu: party creation, the opening of a new game.");

  await waitFrames(page, 60);
  const fpsStart = await page.evaluate(() => ({ frames: window.__retrowright.framesRun, time: performance.now() }));
  await sleep(5000);
  const fpsEnd = await page.evaluate(() => ({ frames: window.__retrowright.framesRun, time: performance.now() }));
  fpsSample = { frames: fpsEnd.frames - fpsStart.frames, seconds: (fpsEnd.time - fpsStart.time) / 1000 };
  measuredFps = fpsSample.frames / fpsSample.seconds;
  check("the game runs at the NES frame rate", Math.abs(measuredFps - 60.1) < 3, { measuredFps, fpsSample });

  // Esc opens the menu and pauses the game.
  await waitFor(page, "a battery save", () => window.__retrowright.batterySaves > 0);
  await openMenu(page);
  const framesAtOpen = await framesRun(page);
  await sleep(500);
  const framesLater = await framesRun(page);
  const pausedFlag = await page.evaluate(() => window.__retrowright.paused);
  const focusInMenu = await page.evaluate(() => document.querySelector("[role=dialog]").contains(document.activeElement));
  check("Esc opens the menu, pauses the game and moves focus into the menu", pausedFlag && framesLater === framesAtOpen && focusInMenu, { pausedFlag, framesAtOpen, framesLater, focusInMenu });

  // Battery RAM: the pause stores it, and what the store holds must be what the game holds.
  const batteryBefore = await page.evaluate(() => window.__retrowright.batteryRamDigest());
  const batteryStored = await page.evaluate(() => window.__retrowright.storedBatteryRamDigest());
  check("battery RAM is stored while playing: the stored copy matches the core's", batteryBefore !== null && batteryStored === batteryBefore, { batteryBefore, batteryStored });

  // Reset from the menu (keyboard only) restarts the game and keeps battery RAM.
  const framesBeforeReset = await framesRun(page);
  await choose(page, "[data-item=reset]");
  await waitFor(page, "the menu to close", () => document.querySelector("[role=dialog]") === null);
  await noticeShown(page, "Reset.");
  await waitFrames(page, 60);
  const batteryAfterReset = await page.evaluate(() => window.__retrowright.batteryRamDigest());
  const storedAfterReset = await page.evaluate(() => window.__retrowright.storedBatteryRamDigest());
  check("battery RAM survives a reset", batteryAfterReset === batteryBefore && storedAfterReset === batteryBefore, { batteryBefore, batteryAfterReset, storedAfterReset, framesBeforeReset });
  await shoot(page, "06-after-reset", "After Reset from the menu: the game starts again.");
  await waitFrames(page, 240);
  await press(page, "Enter");
  await waitFrames(page, 60);
  await press(page, "KeyX");
  await waitFrames(page, 90);

  // F5 still saves to the current slot (1).
  await tap(page, "F5");
  await noticeShown(page, "Saved to slot 1.");

  // Save state from the menu: slot 1 is full, so the right arrow moves to empty slot 2, which saves at once.
  await openMenu(page);
  await choose(page, "[data-item=save]");
  await waitFor(page, "the slot grid", () => document.activeElement?.dataset.slot === "1");
  await tap(page, "ArrowRight");
  const stateBefore = await page.evaluate(() => window.__retrowright.stateDigest());
  await tap(page, "Enter");
  await noticeShown(page, "Saved to slot 2.");
  check("Save state from the menu closes it and resumes", !(await menuOpen(page)) && !(await page.evaluate(() => window.__retrowright.paused)));
  await shoot(page, "07-state-saved", "Saved to slot 2 from the menu; the game runs on.");

  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".continue-button");
  await shoot(page, "08-after-reload", "After a reload: the library's Continue card starts the save its picture shows.", null);
  // The newest pictured save is the resume state if the reload's pagehide wrote it in time, else slot 2.
  // The card names a save once it has read the game's saves; until then its label is another.
  const reloadLabel = await waitFor(page, "the Continue card to name a save", () => {
    const label = document.querySelector(".continue-button").textContent;
    return (label === "Continue" || label === "Load slot 2") && label;
  }).catch(() => page.evaluate(() => document.querySelector(".continue-button").textContent));
  check("after a reload the Continue card names the newest pictured save: the resume state or slot 2", reloadLabel === "Continue" || reloadLabel === "Load slot 2", { reloadLabel });
  await page.click(".continue-button");
  await waitFor(page, "the game to load again", () => window.__retrowright?.game);
  const restored = await page.evaluate(() => window.__retrowright.restoredBatteryRamDigest());
  check("battery RAM survives a reload", restored !== null && restored === batteryBefore, { batteryBefore, restored });
  const storedState = await page.evaluate(() => window.__retrowright.storedStateDigest(2));
  check("a save state survives a reload", storedState === stateBefore, { stateBefore, storedState });

  // The slot grid after the reload: slots 1 and 2 show their pictures and times.
  await waitFrames(page, 30);
  await openMenu(page);
  await choose(page, "[data-item=load]");
  await waitFor(page, "the slot pictures", () => document.querySelector(".slot-grid") !== null && [...document.querySelectorAll(".slot-card img")].every((img) => img.complete));
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll(".slot-card")].map((card) => ({
      slot: card.dataset.slot,
      picture: card.querySelector("img")?.src.slice(0, 16) ?? null,
      pictureWidth: card.querySelector("img")?.naturalWidth ?? 0,
      time: card.querySelector(".slot-time").textContent,
    })),
  );
  const shown = (slot) => cards[slot - 1].picture?.startsWith("data:image/") && cards[slot - 1].pictureWidth === 128 && /\d/.test(cards[slot - 1].time);
  check("saved slots show their thumbnail and time after a reload; empty slots show empty", cards.length === 8 && shown(1) && shown(2) && cards.slice(2).every((card) => card.picture === null && card.time === "—"), cards);
  await shoot(page, "09-slots-after-reload", "Load state after the reload: slots 1 and 2 with their pictures and times, the rest empty.", null);
  // Opened from slot 2, the game has it as the current slot; from the resume state, slot 1.
  if (reloadLabel === "Continue") await tap(page, "ArrowRight");
  await waitFor(page, "slot 2 to have focus", () => document.activeElement?.dataset.slot === "2");
  await tap(page, "Enter");
  await noticeShown(page, "Loaded slot 2.");
  await waitFrames(page, 10);
  await shoot(page, "10-state-loaded", "Slot 2 loaded from the menu: the screen it was saved on, running again.");

  // The menu, the slot grid and the controls diagram: light and dark, desktop and phone width.
  await menuShots(page, "light-desktop", "light theme, 1280 wide");
  await openMenu(page);
  await choose(page, "[data-item=display]");
  await choose(page, "[data-item=theme]"); // light (left by the library's screenshots) -> dark
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check("Display's theme item switches to the dark theme", theme === "dark", { theme });
  await tap(page, "Escape");
  await tap(page, "Escape");
  await menuShots(page, "dark-desktop", "dark theme, 1280 wide");
  await page.setViewport({ width: 390, height: 844 });
  await sleep(300);
  await menuShots(page, "dark-phone", "dark theme, phone width (390)");
  await shoot(page, "11-dark-phone", "Dark theme at phone width (390), playing: the row under the picture holds the menu button, mute and volume.", null);
  const scale = await page.evaluate(() => document.querySelector("canvas.screen").dataset.scale);
  check("the picture is scaled by a whole number at phone width", scale === "1", { scale });
  await openMenu(page);
  await choose(page, "[data-item=display]");
  await choose(page, "[data-item=theme]"); // dark -> system
  await tap(page, "Enter"); // system -> light
  await tap(page, "Escape");
  await tap(page, "Escape");
  await menuShots(page, "light-phone", "light theme, phone width (390)");

  // Quit to library closes the game and brings back the library, focus on Continue.
  await page.setViewport({ width: 1280, height: 900 });
  await openMenu(page);
  await choose(page, "[data-item=quit]");
  await waitFor(page, "the library", () => document.querySelector(".continue-button") !== null);
  const afterQuit = await page.evaluate(() => ({
    game: window.__retrowright.game,
    input: document.querySelector("#rom-input") !== null,
    focus: document.activeElement?.textContent,
    picture: document.querySelector(".continue-card img")?.src.slice(0, 16) ?? null,
  }));
  check(
    "Quit to library closes the game and shows the library, with Continue focused and the game's own last frame as its picture",
    afterQuit.game === null && afterQuit.input && afterQuit.focus === "Continue" && afterQuit.picture?.startsWith("data:image/"),
    afterQuit,
  );
  await shoot(page, "12-quit-to-library", "After Quit to library: the Continue card holds the frame the game was left on.", null);

  // More games: the other ROMs under roms/ and Final Fantasy again, which is recognised by its SHA-256.
  const others = await otherRoms();
  await (await page.$("#rom-input")).uploadFile(...others, ROM);
  await waitFor(page, "the added games", (count) => document.querySelectorAll("[data-card]").length === count, others.length + 1);
  await noticeShown(page, "is already in the library");
  const severalAdded = await page.evaluate(() => ({
    cards: document.querySelectorAll("[data-card]").length,
    duplicateNotice: [...document.querySelectorAll(".notice")].map((node) => node.textContent).find((text) => text.includes("is already in the library")) ?? null,
    game: window.__retrowright.game,
  }));
  check(
    "several files are added at once without starting one, and Final Fantasy added again is recognised as a duplicate",
    severalAdded.cards === others.length + 1 && severalAdded.duplicateNotice?.startsWith("Final_Fantasy_USA.nes is already in the library") && severalAdded.game === null,
    severalAdded,
  );
  // Star Final Fantasy, and rename the second game through its menu, by keyboard.
  await page.click("[data-card] .card-star");
  const renameIndex = others.length > 0 ? 1 : 0;
  await page.evaluate((index) => document.querySelectorAll("[data-card] .card-more")[index].focus(), renameIndex);
  await tap(page, "Enter");
  await page.waitForSelector(".rename-form input");
  await page.keyboard.type("My renamed game");
  await tap(page, "Enter");
  await waitFor(page, "the new title", () => [...document.querySelectorAll(".card-title")].some((node) => node.textContent === "My renamed game"));
  const cardsShown = await libraryCards(page);
  check(
    "cards show the player's own picture for a played game and a placeholder naming the system otherwise; star and rename stick",
    cardsShown[0].picture?.startsWith("data:image/") && cardsShown[0].favourite && cardsShown.slice(1).every((card) => card.placeholder === "NES") && cardsShown.some((card) => card.title === "My renamed game"),
    cardsShown,
  );
  await libraryShots(page, "games", `${cardsShown.length} games, Final Fantasy starred and with its own picture`);
  await page.click(".filter-favourites");
  const favouritesOnly = await libraryCards(page);
  check("the Favourites filter shows only the starred game", favouritesOnly.length === 1 && favouritesOnly[0].favourite, favouritesOnly);
  await page.click(".filter-favourites");
  await page.click(".view-toggle");
  await shoot(page, "library-list-light-desktop", "The library's list view, light theme, 1280 wide.", null);
  await page.click(".view-toggle");

  // Close the tab mid-game, open the page again, and Continue: the same frame.
  await page.click(".continue-button");
  await waitFor(page, "the game to run", () => window.__retrowright?.game);
  await waitFrames(page, 120);
  await openMenu(page); // pauses, so the picture stays on the frame being left
  const hashAtClose = await page.evaluate(() => window.__retrowright.screenHash());
  await page.close({ runBeforeUnload: true });
  page = watch(await browser.newPage());
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector(".continue-button");
  const continueLabel = await page.evaluate(() => document.querySelector(".continue-button").textContent);
  await shoot(page, "13-reopened", "A new tab after the game's tab was closed mid-game: Continue, with the frame it was left on.", null);
  await page.click(".continue-button");
  await waitFor(page, "the game to continue", () => window.__retrowright?.game);
  const hashAfterContinue = await page.evaluate(() => window.__retrowright.continuedScreenHash);
  await waitFrames(page, 30);
  check("closing the tab mid-game and opening the page again, one click on Continue shows the same frame (screen hash)", continueLabel === "Continue" && hashAtClose !== null && hashAfterContinue === hashAtClose, {
    continueLabel,
    hashAtClose,
    hashAfterContinue,
  });
  await shoot(page, "14-continued", "After Continue on the new tab: the game runs on from the frame it was left on.");

  // Without ?debug the production build has no debug handle.
  await page.goto(url.replace("?debug", ""), { waitUntil: "load" });
  await page.waitForSelector("#rom-input");
  const handleWithoutDebug = await page.evaluate(() => typeof window.__retrowright);
  check("window.__retrowright is absent without ?debug", handleWithoutDebug === "undefined", { handleWithoutDebug });

  const foreign = requests.filter((requested) => !isOwn(requested));
  check("no request leaves the page's own files: no art or metadata is fetched", requests.length > 0 && foreign.length === 0, { requests: requests.length, foreign });
} catch (error) {
  exitCode = 1;
  check("the run finished", false, String(error?.stack ?? error));
} finally {
  await browser.close();
  await server.stop();
}

const results = {
  when: new Date().toString(),
  browser: await (async () => {
    const { execFileSync } = await import("node:child_process");
    return execFileSync(FIREFOX, ["--version"]).toString().trim();
  })(),
  url,
  measuredFps,
  fpsSample,
  bundleBytes: await bundleSize(),
  passed: checks.filter((item) => item.ok).length,
  checks,
  screenshots: shots,
  requests,
  foreignRequests: requests.filter((requested) => !isOwn(requested)),
  console: consoleLines,
};
await writeReport(results);
const failed = checks.filter((item) => !item.ok).length;
console.log(`${results.passed} passed, ${failed} failed. Report: ${join(OUT, "index.html")}`);
process.exit(exitCode || (failed > 0 ? 1 : 0));
