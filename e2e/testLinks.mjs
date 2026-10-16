// Test links and the controls panel in headless Firefox (puppeteer-core over
// WebDriver BiDi), on the development server, which alone serves test links.
// Writes two synthetic ROMs (one paints the backdrop red, one green) to
// <out>/roms, starts `vite` with RETROWRIGHT_TEST_ROMS pointing there, and
// checks: two tabs opened with two test links each play their own game under
// their own label; a missing file names itself; &controls=1 shows the controls
// panel, which follows a rebinding at once; the menu's setting turns it on and
// it survives a reload; and with the tools panel open too (Developer tools
// turned on) the two stack in one column beside the picture, nothing overlaps
// and the picture keeps its size on a wide window, while a narrow one puts
// both panels under the picture.
//
// Usage: npm run e2e:test-links [-- output-dir]
// Not part of `npm test`: it needs Firefox.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import { buildInes, PAINT_BACKDROP_PROGRAM } from "../src/test/syntheticRom.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "test-links"));
const ROMS = join(OUT, "roms");
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";
const WIDE = { width: 1920, height: 1080 };

/** PAINT_BACKDROP_PROGRAM with another backdrop colour: its LDA #$16 is the 12th byte. */
const paintBackdrop = (colour) => buildInes({ battery: true, program: PAINT_BACKDROP_PROGRAM.map((byte, index) => (index === 11 ? colour : byte)) });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const checks = [];
const shots = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}

async function waitFor(page, description, predicate, arg, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const value = await page.evaluate(predicate, arg);
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${description}.`);
    await sleep(50);
  }
}

async function shot(page, file, caption) {
  await page.screenshot({ path: join(OUT, file) });
  shots.push({ file, caption });
}

/** Opens a test link and waits until its game runs. */
async function openLink(page, search, game) {
  await page.goto(`${origin}/${search}`, { waitUntil: "load" });
  await waitFor(page, `${game} to run`, (name) => window.__retrowright?.game === name && window.__retrowright.framesRun > 30, game);
}

const label = (page) => page.evaluate(() => document.querySelector(".test-label")?.textContent ?? null);
const sideKeys = (page, row) =>
  page.evaluate((row) => [...document.querySelectorAll(".controls-side tbody tr")].find((tr) => tr.querySelector("th")?.textContent === row)?.querySelector(".side-keys")?.textContent ?? null, row);

/** The boxes of the picture and both panels, and whether any two of them overlap. */
const boxes = (page) =>
  page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    const found = { picture: rect("canvas.screen"), controls: rect(".controls-side"), tools: rect(".tools-panel"), banner: rect(".test-label") };
    const names = Object.keys(found).filter((name) => found[name]);
    const overlaps = [];
    for (const [index, first] of names.entries()) {
      for (const second of names.slice(index + 1)) {
        const a = found[first];
        const b = found[second];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) overlaps.push(`${first}/${second}`);
      }
    }
    return { ...found, overlaps };
  });

async function menuItem(page, item) {
  await page.waitForSelector(`[data-item=${item}]`);
  await page.click(`[data-item=${item}]`);
}

function escape(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

await mkdir(ROMS, { recursive: true });
await writeFile(join(ROMS, "Original.nes"), paintBackdrop(0x16));
await writeFile(join(ROMS, "Patched.nes"), paintBackdrop(0x2a));
process.env.RETROWRIGHT_TEST_ROMS = ROMS;
const vite = await createServer({ configFile: join(ROOT, "vite.config.ts"), root: ROOT, logLevel: "error", server: { host: "127.0.0.1", port: 5190 } });
await vite.listen();
const origin = new URL(vite.resolvedUrls.local[0]).origin;
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
let finished = false;
try {
  // Two tabs, two builds.
  const original = await browser.newPage();
  await original.setViewport(WIDE);
  await openLink(original, "?play=local-roms/Original.nes&label=Original", "Original.nes");
  const patched = await browser.newPage();
  await patched.setViewport(WIDE);
  await openLink(patched, "?play=local-roms/Patched.nes&label=Patched&controls=1", "Patched.nes");
  await shot(patched, "tab-patched.png", "Tab 2: ?play=local-roms/Patched.nes&label=Patched&controls=1 (green backdrop, controls panel)");
  await original.bringToFront();
  await sleep(300);
  await shot(original, "tab-original.png", "Tab 1: ?play=local-roms/Original.nes&label=Original (red backdrop)");
  const tabs = [];
  for (const page of [original, patched]) {
    tabs.push(await page.evaluate(() => ({ game: window.__retrowright.game, romId: window.__retrowright.romId, hash: window.__retrowright.screenHash(), title: document.title })));
  }
  check("tab 1 plays Original.nes under the label Original", tabs[0].game === "Original.nes" && (await label(original)) === "Original", JSON.stringify(tabs[0]));
  check("tab 2 plays Patched.nes under the label Patched", tabs[1].game === "Patched.nes" && (await label(patched)) === "Patched", JSON.stringify(tabs[1]));
  check("the two tabs run different ROMs and show different pictures", tabs[0].romId !== tabs[1].romId && tabs[0].hash !== tabs[1].hash);
  const originalBoxes = await boxes(original);
  check("the label banner does not cover the picture", originalBoxes.banner !== null && originalBoxes.overlaps.length === 0, JSON.stringify(originalBoxes));
  check("controls=1 shows the controls panel in tab 2 alone", (await patched.$(".controls-side")) !== null && (await original.$(".controls-side")) === null);

  // A missing file names what it looked for.
  const missing = await browser.newPage();
  await missing.setViewport(WIDE);
  await missing.goto(`${origin}/?play=local-roms/Missing.nes&label=Missing`, { waitUntil: "load" });
  const alert = await waitFor(missing, "the missing-file notice", () => document.querySelector("[role=alert]")?.textContent.includes("Missing.nes") && document.querySelector("[role=alert]").textContent);
  check("a missing file gives a notice naming it", alert.includes("“Missing.nes” was not found"), alert.trim());
  await shot(missing, "missing-file.png", "?play=local-roms/Missing.nes: the notice names the file");
  await missing.close();

  // The panel follows a rebinding at once.
  await patched.bringToFront();
  await patched.focus("canvas.screen");
  const keyBefore = await sideKeys(patched, "B");
  await patched.keyboard.press("Escape");
  await menuItem(patched, "controls");
  await patched.click("[data-action=B]");
  await patched.keyboard.press("KeyK");
  const keyDuring = await sideKeys(patched, "B");
  check("the controls panel follows a rebinding at once", keyBefore === "Z" && keyDuring === "K", `B: ${keyBefore} → ${keyDuring}`);
  await shot(patched, "rebinding.png", "Rebinding B to K in Controls…: the panel behind the menu already shows K");
  await patched.keyboard.press("Escape");
  await patched.keyboard.press("Escape");

  // The setting: off by default, turned on in the menu, kept over a reload.
  await original.bringToFront();
  await original.focus("canvas.screen");
  const pictureAlone = (await boxes(original)).picture;
  await original.keyboard.press("Escape");
  await menuItem(original, "display");
  const toggleText = await original.$eval("[data-item=show-controls]", (button) => button.textContent);
  await original.click("[data-item=show-controls]");
  // Developer tools on too, for the tools panel (F4) below.
  await original.click("[data-item=developer-tools]");
  await original.keyboard.press("Escape");
  await original.keyboard.press("Escape");
  check("the setting is off by default and turns the panel on", toggleText === "Show controls beside the game: off" && (await original.$(".controls-side")) !== null, toggleText);
  await openLink(original, "?play=local-roms/Original.nes&label=Original", "Original.nes");
  check("the panel is still on after a reload", (await original.$(".controls-side")) !== null);
  check("the rebinding made in tab 2 shows after tab 1's reload", (await sideKeys(original, "B")) === "K");

  // Both panels open on a wide window: nothing overlaps, and the picture keeps its size.
  await original.focus("canvas.screen");
  await original.keyboard.press("F4");
  await original.waitForSelector(".tools-panel");
  await sleep(300);
  const both = await boxes(original);
  check("with the tools and controls panels open at 1920×1080, nothing overlaps", both.controls && both.tools && both.overlaps.length === 0, JSON.stringify(both));
  check(
    "the picture keeps the size it has without the panels at 1920×1080",
    Math.abs(both.picture.width - pictureAlone.width) < 1 && Math.abs(both.picture.height - pictureAlone.height) < 1,
    `${pictureAlone.width.toFixed(1)}×${pictureAlone.height} alone, ${both.picture.width.toFixed(1)}×${both.picture.height} with both panels`,
  );
  check("on a wide window the controls and tools panels stack in one column beside the picture, controls first", both.controls.left >= both.picture.right && both.tools.left === both.controls.left && both.tools.top >= both.controls.bottom, JSON.stringify(both));
  await shot(original, "both-panels-1920.png", "Tools (F4) and controls panels open at 1920×1080: stacked beside the picture, picture at its own size");
  await original.setViewport({ width: 1366, height: 768 });
  await sleep(300);
  const laptop = await boxes(original);
  check("with both panels open at 1366×768, nothing overlaps", laptop.overlaps.length === 0, JSON.stringify(laptop));
  await shot(original, "both-panels-1366.png", "Both panels at 1366×768");
  await original.setViewport({ width: 1100, height: 900 });
  await sleep(300);
  const medium = await boxes(original);
  check(
    "at 1100 wide both panels stack beside the picture, the controls above the tools, with nothing overlapping",
    medium.overlaps.length === 0 && medium.controls.left >= medium.picture.right && medium.tools.left >= medium.picture.right && medium.tools.top >= medium.controls.bottom,
    JSON.stringify(medium),
  );
  await original.screenshot({ path: join(OUT, "both-panels-1100.png"), fullPage: true });
  shots.push({ file: "both-panels-1100.png", caption: "Both panels at 1100 wide (whole page): stacked beside the picture, controls above tools" });
  await original.setViewport({ width: 900, height: 1000 });
  await sleep(300);
  const narrow = await boxes(original);
  check(
    "on a narrow window (900 wide) both panels go under the picture",
    narrow.overlaps.length === 0 && narrow.controls.top >= narrow.picture.bottom && narrow.tools.top >= narrow.picture.bottom,
    JSON.stringify(narrow),
  );
  await original.screenshot({ path: join(OUT, "both-panels-900.png"), fullPage: true });
  shots.push({ file: "both-panels-900.png", caption: "Both panels at 900 wide (whole page): under the picture" });
  finished = true;
} catch (error) {
  check(`the run finished: ${error.message}`, false);
} finally {
  await browser.close();
  await vite.close();
}

const failing = checks.filter((item) => !item.ok).length;
await writeFile(
  join(OUT, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>retrowright: test links and the controls panel</title>
<style>body{font-family:system-ui,sans-serif;max-width:1400px;margin:1rem auto;padding:0 1rem}figure{display:inline-block;margin:.5rem;vertical-align:top;max-width:640px}figure img{max-width:100%;border:1px solid #ccc}td{padding:.2rem .5rem;vertical-align:top}code{font-size:.8em;word-break:break-all}</style>
<h1>Test links and the controls panel (development server, headless Firefox)</h1>
<p>${escape(new Date().toString())} · ${failing} failing</p>
<table>${checks.map((item) => `<tr><td>${item.ok ? "✅" : "❌"}</td><td>${escape(item.name)}</td><td><code>${escape(item.detail)}</code></td></tr>`).join("\n")}</table>
<h2>Screenshots</h2>${shots.map((item) => `<figure><img src="${item.file}" alt="${escape(item.caption)}"><figcaption>${escape(item.caption)}</figcaption></figure>`).join("\n")}
`,
);
console.log(`${checks.length} checks, ${failing} failing${finished ? "" : ", the run did not finish"}; report in ${OUT}`);
process.exit(failing === 0 && finished ? 0 : 1);
