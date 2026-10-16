// Browser check of first run and save export in headless Firefox, with the
// page opened with ?debug. Two browser launches, each with its own new
// profile, stand for two browsers:
//
// 1. A fresh profile sees the empty library's explanation. Final Fantasy is
//    added and starts; the sound hint shows until the first click. Its
//    battery save and a save state (slot 1, with its picture) are made, the
//    browser is asked to keep the page's storage, and Saves and storage shows
//    the meter. Export everything is caught as a file.
// 2. A second fresh profile imports that file before it has any game, then
//    adds Final Fantasy from roms/: its battery save and the slot's state and
//    picture are there.
//
// Firefox asks the player before granting persistent storage; the first
// profile answers yes through its testing preferences, the second no, so both
// answers are shown.
//
// Usage: npm run build && node e2e/backup.mjs [output-dir]
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
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "backup"));
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

const screenshots = [];
async function shot(page, file, caption) {
  await page.screenshot({ path: join(OUT, file), fullPage: true });
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

/** Waits for a notice holding `text` and returns that notice's whole text. */
const noticeIncludes = (page, text) =>
  waitFor(page, `the notice "${text}"`, (wanted) => [...document.querySelectorAll(".notice")].map((node) => node.textContent).find((shown) => shown.includes(wanted)) ?? null, text);

/** A new browser with a profile of its own; `keepStorage` is its answer to persist(). */
function launch(keepStorage) {
  return puppeteer.launch({
    browser: "firefox",
    executablePath: FIREFOX,
    headless: true,
    protocol: "webDriverBiDi",
    extraPrefsFirefox: { "dom.storageManager.prompt.testing": true, "dom.storageManager.prompt.testing.allow": keepStorage },
  });
}

async function openPage(browser, url) {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.log(`pageerror: ${error.message}`));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: "load" });
  await waitFor(page, "the player", () => window.__retrowright !== undefined);
  return page;
}

async function quitToLibrary(page) {
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-item=quit]");
  await page.click("[data-item=quit]");
  await page.waitForSelector(".open-saves");
}

await mkdir(OUT, { recursive: true });
const server = await startStaticServer({ root: DIST, subPath: "/", ports: [0] });
// ?debug installs window.__retrowright, which a production build leaves out otherwise.
const url = `http://127.0.0.1:${server.port}/?debug`;
const backupPath = join(OUT, "exported.rwbackup.json");
let exitCode = 0;
let first = null;
try {
  // The first browser.
  const browserA = await launch(true);
  try {
    const page = await openPage(browserA, url);
    const lead = await page.waitForSelector(".empty-lead");
    check("a fresh profile sees the empty library's explanation", lead !== null, await page.$eval(".library-empty", (node) => node.innerText));
    await shot(page, "01-empty-library.png", "A fresh profile: the empty library");
    // Opened without a click: a click would start sound before the hint below is checked.
    await page.$eval(".rom-help", (node) => (node.open = true));
    await shot(page, "02-where-games-come-from.png", "Where do games come from? opened");

    await (await page.$("#rom-input")).uploadFile(ROM);
    await waitFor(page, "the game to run", () => window.__retrowright.game && window.__retrowright.framesRun > 30);
    check("the sound hint shows by the picture before any click", await page.$(".sound-hint"), await page.$eval(".sound-hint", (node) => node.textContent).catch(() => null));
    await shot(page, "03-sound-hint.png", "Before the first click: the sound hint by the picture");
    await page.click("canvas.screen");
    await waitFor(page, "the sound hint to go", () => document.querySelector(".sound-hint") === null);
    await waitFor(page, "a battery save", () => window.__retrowright.batterySaves > 0);
    await page.keyboard.press("F5");
    const saved = await noticeIncludes(page, "Saved to slot 1.");
    const agreed = await noticeIncludes(page, "This browser has agreed to keep your saves.");
    check("after the first save the page asks to keep its storage and says the browser agreed", Boolean(saved && agreed), { saved, agreed });
    const battery = await page.evaluate(() => window.__retrowright.storedBatteryRamDigest());
    const state = await page.evaluate(() => window.__retrowright.storedStateDigest(1));
    first = { battery, state };

    await quitToLibrary(page);
    await page.click(".open-saves");
    const meter = await waitFor(page, "the storage meter", () => {
      const text = document.querySelector(".storage-meter")?.textContent ?? "";
      return /^[\d.]+ (bytes|KB|MB|GB) used of about/.test(text) && text;
    });
    check("Saves and storage shows how much room the page uses, and that the browser keeps it", meter, {
      meter,
      persistence: await page.$eval(".persistence", (node) => node.dataset.persistence),
    });
    await shot(page, "04-saves-and-storage.png", "Saves and storage: the browser agreed, the meter, export and import");

    // Catch the download: read the file the link points at instead of saving it.
    await page.evaluate(() => {
      HTMLAnchorElement.prototype.click = function () {
        window.__downloadName = this.download;
        void fetch(this.href)
          .then((response) => response.text())
          .then((text) => (window.__download = text));
      };
    });
    await page.click("[data-item=export]");
    const text = await waitFor(page, "the backup download", () => window.__download);
    const name = await page.evaluate(() => window.__downloadName);
    await writeFile(backupPath, text);
    const backup = JSON.parse(text);
    check("Export everything downloads one .rwbackup.json file without the ROM", name.endsWith(".rwbackup.json") && backup.games.length === 1 && backup.games[0].rom === null, {
      name,
      version: backup.version,
      bytes: text.length,
      saves: backup.saves.map((saves) => ({ battery: saves.battery !== null, slots: saves.states.map((state) => state.slot), resume: saves.resume !== null })),
      settings: Object.keys(backup.settings ?? {}),
    });
  } finally {
    await browserA.close();
  }

  // Another browser, with a new profile: nothing in it.
  const browserB = await launch(false);
  try {
    const page = await openPage(browserB, url);
    await page.waitForSelector(".empty-lead");
    check("the second profile starts empty", (await page.$$("[data-card]")).length === 0);
    await page.click(".open-saves");
    await (await page.$("#backup-input")).uploadFile(backupPath);
    const waiting = await noticeIncludes(page, "wait until you add its ROM");
    check("importing before the game is added says its saves wait for the ROM", true, waiting);
    await shot(page, "05-imported-waiting.png", "Second profile: the backup imported, its saves waiting for the ROM");

    await (await page.$("#rom-input")).uploadFile(ROM);
    await waitFor(page, "the game to run", () => window.__retrowright.game && window.__retrowright.framesRun > 10);
    const restored = await page.evaluate(() => window.__retrowright.restoredBatteryRamDigest());
    check("the battery save from the first profile is restored when the ROM is added", first && restored === first.battery, { restored, exported: first?.battery });
    const state = await page.evaluate(() => window.__retrowright.storedStateDigest(1));
    check("slot 1's save state from the first profile is there", first && state === first.state, { state, exported: first?.state });
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-item=load]");
    await page.click("[data-item=load]");
    const picture = await waitFor(page, "slot 1's picture", () => document.querySelector("[data-slot='1'] img")?.getAttribute("src"));
    check("slot 1 shows its picture from the first profile", picture.startsWith("data:image/"), picture.slice(0, 30));
    await shot(page, "06-imported-slot.png", "Second profile, Final Fantasy added: slot 1 with its picture from the first");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await waitFor(page, "the menu to close", () => document.querySelector("[role=dialog]") === null);

    // A save here asks this browser too; this profile answers no.
    await page.keyboard.press("F5");
    await noticeIncludes(page, "has not agreed to keep your saves");
    await quitToLibrary(page);
    check("a browser that does not agree leaves a gentle warning in the library", await page.$(".storage-warning"), await page.$eval(".storage-warning", (node) => node.textContent).catch(() => null));
    await shot(page, "07-library-warning.png", "A browser that did not agree to keep the saves: the library's warning");
  } finally {
    await browserB.close();
  }
} catch (error) {
  exitCode = 1;
  check("the run finished", false, String(error?.stack ?? error));
} finally {
  await server.stop();
}
await writeFile(join(OUT, "results.json"), JSON.stringify({ when: new Date().toString(), checks, screenshots }, null, 2));
const failed = checks.filter((item) => !item.ok).length;
console.log(`${checks.length - failed} passed, ${failed} failed.`);
process.exit(exitCode || (failed > 0 ? 1 : 0));
