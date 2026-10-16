// Display and speed in headless Firefox (puppeteer-core over WebDriver BiDi).
// Serves a built dist/ under a sub-path, adds Final Fantasy through the file
// input (a single file starts at once) and checks, with numbers in the log:
// integer scaling gives a whole-number scale at three window sizes, and the
// 8:7 pixel aspect draws the picture 8/7 as wide as square pixels do; the
// quick menu's screenshot decodes to exactly the core's frame (its pixel hash
// is the frame's screenHash) at the core's size, and F2 saves one too;
// holding Tab runs at least twice as many frames a second and letting go
// returns to normal, as does the menu's Fast-forward toggle; and every
// display option set in the menu survives a reload. Writes screenshots,
// results.json and an index.html to the output directory.
//
// A build from before these options existed, given as the second argument,
// gets only the picture's sizes and screenshots, for a before-and-after page:
// the options it lacks are left unchecked.
//
// Usage: npm run build && node e2e/display.mjs [output-dir] [dist-dir]
// Not part of `npm test`: it needs Firefox and a ROM that is never committed.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { startStaticServer } from "./staticServer.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = resolve(process.argv[3] ?? join(ROOT, "dist"));
const ROM = join(ROOT, "roms", "Final_Fantasy_USA.nes");
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "display"));
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";
const SUB_PATH = "/retrowright/";
const PORTS = [8810, 8811, 8812, 8813, 8814, 8815, 8816, 8817, 8818, 8819];
/** Three window sizes whose room for the picture (less 160 px for the controls) holds it 2, 3 and 4 times. */
const WINDOWS = [
  { width: 1024, height: 700 },
  { width: 1280, height: 900 },
  { width: 1920, height: 1200 },
];
const NES = { width: 256, height: 240, pixelAspect: 8 / 7 };
const SPEED_SECONDS = 3;

if (!existsSync(ROM)) {
  console.log(`SKIP: ${ROM} is missing. Put a Final Fantasy (USA) ROM there to run this check.`);
  process.exit(0);
}
if (!existsSync(join(DIST, "index.html"))) {
  console.error(`${join(DIST, "index.html")} is missing: run \`npm run build\` first.`);
  process.exit(1);
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitFor(page, description, predicate, arg, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const value = await page.evaluate(predicate, arg);
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${description}.`);
    await sleep(50);
  }
}

const framesRun = (page) => page.evaluate(() => window.__retrowright.framesRun);

async function waitFrames(page, count) {
  const target = (await framesRun(page)) + count;
  await waitFor(page, `${count} more frames`, (wanted) => window.__retrowright.framesRun >= wanted, target);
}

/** Emulated frames a second over `seconds` of the page's own clock. */
async function framesPerSecond(page, seconds) {
  const start = await page.evaluate(() => ({ frames: window.__retrowright.framesRun, time: performance.now() }));
  await sleep(seconds * 1000);
  const end = await page.evaluate(() => ({ frames: window.__retrowright.framesRun, time: performance.now() }));
  const frames = end.frames - start.frames;
  return { frames, seconds: (end.time - start.time) / 1000, fps: frames / ((end.time - start.time) / 1000) };
}

const shots = [];
async function shoot(page, name, caption, selector = null) {
  const path = join(OUT, `${name}.png`);
  if (selector) await (await page.$(selector)).screenshot({ path });
  else await page.screenshot({ path });
  shots.push({ file: `${name}.png`, caption });
}

const menuOpen = (page) => page.evaluate(() => document.querySelector("[role=dialog]") !== null);

async function openMenu(page) {
  await page.keyboard.press("Escape");
  await waitFor(page, "the menu to open", () => document.querySelector("[role=dialog]") !== null);
}

async function closeMenu(page) {
  for (let step = 0; step < 3 && (await menuOpen(page)); step++) {
    await page.keyboard.press("Escape");
    await sleep(100);
  }
  await waitFor(page, "the menu to close", () => document.querySelector("[role=dialog]") === null);
}

async function openDisplay(page) {
  await openMenu(page);
  await page.click("[data-item=display]");
  await page.waitForSelector("[data-item=theme]");
}

/** The picture's drawn size and the canvas's own attributes. */
const picture = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector("canvas.screen");
    const rect = canvas.getBoundingClientRect();
    const scanlines = document.querySelector(".scanlines");
    return {
      width: rect.width,
      height: rect.height,
      canvas: `${canvas.width}x${canvas.height}`,
      scale: canvas.dataset.scale ?? null,
      scaling: canvas.dataset.scaling ?? null,
      aspect: canvas.dataset.aspect ?? null,
      scanlines: scanlines ? Number(scanlines.dataset.intensity) : null,
    };
  });

/** The display section's settings as the menu shows them. */
const menuSettings = (page) =>
  page.evaluate(() => ({
    scaling: document.querySelector("[data-item=scaling]").textContent,
    aspect: document.querySelector("[data-item=aspect]").textContent,
    scanlines: document.querySelector("[data-item=scanlines]").textContent,
    intensity: document.querySelector("[data-item=scanline-intensity]").value,
    speed: document.querySelector("[data-item=fast-forward-speed]").value,
  }));

/** Catches the page's downloads (an anchor's click on a blob URL) instead of letting the browser save them. */
const catchDownloads = (page) =>
  page.evaluate(() => {
    window.__downloads = [];
    HTMLAnchorElement.prototype.click = function () {
      window.__downloads.push({ href: this.href, name: this.download });
    };
  });

/** Decodes the last caught download as an image in the page: its size, pixel hash and PNG bytes (base64). */
const decodeLastDownload = (page) =>
  page.evaluate(async () => {
    const download = window.__downloads.at(-1);
    const blob = await (await fetch(download.href)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { name: download.name, type: blob.type, width: bitmap.width, height: bitmap.height, hash: window.__retrowright.pictureHash(pixels), base64: btoa(binary) };
  });

function escape(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

async function writeReport(results) {
  await writeFile(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const figure = (shot) => `<figure><img src="${shot.file}" alt="${escape(shot.caption)}"><figcaption>${escape(shot.caption)}</figcaption></figure>`;
  const rows = results.checks.map((item) => `<tr><td>${item.ok ? "✅" : "❌"}</td><td>${escape(item.name)}</td><td><code>${escape(JSON.stringify(item.detail ?? ""))}</code></td></tr>`).join("\n");
  await writeFile(
    join(OUT, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>retrowright: display and speed</title>
<style>body{font-family:system-ui,sans-serif;max-width:1200px;margin:1rem auto;padding:0 1rem}figure{display:inline-block;margin:.5rem;vertical-align:top;max-width:560px}figure img{max-width:100%;border:1px solid #ccc}td{padding:.2rem .5rem;vertical-align:top}code{font-size:.85em;word-break:break-all}</style>
<h1>retrowright: display and speed in headless Firefox</h1>
<p>${escape(results.when)} · ${results.options ? "this build" : "a build without the display options"} · ${results.passed}/${results.checks.length} checks passed</p>
<h2>Checks</h2><table>${rows}</table>
<h2>Screenshots</h2>${results.screenshots.map(figure).join("\n")}
`,
  );
}

await mkdir(OUT, { recursive: true });
const server = await startStaticServer({ root: DIST, subPath: SUB_PATH, ports: PORTS });
const url = `http://127.0.0.1:${server.port}${SUB_PATH}?debug`;
console.log(`Serving ${DIST} at ${url}`);
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
const consoleLines = [];
let exitCode = 0;
let options = false;
const sizes = [];
const speeds = {};
try {
  const page = await browser.newPage();
  page.on("console", (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`pageerror: ${error.message}`));
  await page.setViewport(WINDOWS[1]);
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("#rom-input");
  await (await page.$("#rom-input")).uploadFile(ROM);
  await waitFor(page, "the game to start", () => window.__retrowright?.game);
  // The prologue's text is on screen by then: a picture with fine detail.
  await waitFrames(page, 420);
  await openDisplay(page);
  options = await page.evaluate(() => document.querySelector("[data-item=scaling]") !== null);
  await closeMenu(page);
  console.log(options ? "This build has the display options." : "This build has no display options: sizes and screenshots only.");

  // Integer scaling at three window sizes, with the core's 8:7 aspect (the default) and then square pixels.
  for (const aspect of options ? ["core", "square"] : ["build default"]) {
    for (const view of WINDOWS) {
      await page.setViewport(view);
      await sleep(300);
      const size = { window: `${view.width}x${view.height}`, aspect, ...(await picture(page)) };
      sizes.push(size);
      console.log(`picture at ${size.window}, ${aspect}: ${size.width} x ${size.height} CSS px, scale ${size.scale}`);
      if (aspect !== "square") await shoot(page, `size-${aspect.replace(" ", "-")}-${size.window}`, `The page at ${size.window}, ${aspect === "core" ? "integer scaling with the 8:7 pixel aspect" : "as this build draws it"}: ${size.width.toFixed(1)} × ${size.height} CSS px.`);
    }
    if (aspect === "core") {
      await page.setViewport(WINDOWS[1]);
      await openDisplay(page);
      await page.click("[data-item=aspect]");
      await closeMenu(page);
    }
  }
  if (options) {
    for (const view of WINDOWS) {
      const label = `${view.width}x${view.height}`;
      const core = sizes.find((size) => size.window === label && size.aspect === "core");
      const square = sizes.find((size) => size.window === label && size.aspect === "square");
      const scale = Number(core.scale);
      check(
        `at ${label} integer scaling draws a whole-number scale: 240 lines × ${scale}, and 8:7 is 8/7 of the square width`,
        Number.isInteger(scale) && scale >= 1 && core.height === NES.height * scale && Math.abs(core.width - NES.width * NES.pixelAspect * scale) < 0.01 && square.width === NES.width * scale && Math.abs(core.width / square.width - 8 / 7) < 0.001,
        { core: { width: core.width, height: core.height, scale: core.scale }, square: { width: square.width, height: square.height, scale: square.scale }, ratio: core.width / square.width },
      );
    }
    const scales = WINDOWS.map((view) => sizes.find((size) => size.window === `${view.width}x${view.height}` && size.aspect === "core").scale);
    check("the three window sizes give three different whole-number scales", new Set(scales).size === 3, { scales });
    // Back to 8:7.
    await page.setViewport(WINDOWS[1]);
    await openDisplay(page);
    await page.click("[data-item=aspect]");
    await closeMenu(page);
  } else {
    await page.setViewport(WINDOWS[1]);
  }

  if (options) {
    // The menu's Screenshot: the game is paused, so the frame stays put while it is saved.
    await catchDownloads(page);
    await openMenu(page);
    const frameHash = await page.evaluate(() => window.__retrowright.screenHash());
    await page.click("[data-item=screenshot]");
    await waitFor(page, "the screenshot's download", () => window.__downloads.length === 1);
    const fromMenu = await decodeLastDownload(page);
    await writeFile(join(OUT, fromMenu.name), Buffer.from(fromMenu.base64, "base64"));
    shots.push({ file: fromMenu.name, caption: `The menu's screenshot as saved (${fromMenu.width}×${fromMenu.height}), named after the game and the time.` });
    const { base64: _menuBytes, ...menuShot } = fromMenu;
    check("the menu's screenshot is a PNG at the core's 256x240 whose pixel hash is the frame's screenHash", fromMenu.type === "image/png" && fromMenu.width === 256 && fromMenu.height === 240 && fromMenu.hash === frameHash, { frameHash, ...menuShot });
    check("the screenshot is named after the game and the local time", /^Final_Fantasy_USA-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.png$/.test(fromMenu.name), fromMenu.name);
    await closeMenu(page);

    // F2 while the game runs.
    await page.keyboard.press("F2");
    await waitFor(page, "F2's download", () => window.__downloads.length === 2);
    const { base64: _keyBytes, ...fromKey } = await decodeLastDownload(page);
    check("F2 saves a 256x240 PNG of the running game", fromKey.type === "image/png" && fromKey.width === 256 && fromKey.height === 240, fromKey);

    // Fast-forward held with Tab, then let go.
    await page.focus("canvas.screen");
    speeds.normal = await framesPerSecond(page, SPEED_SECONDS);
    await page.keyboard.down("Tab");
    await sleep(200);
    const heldSpeed = await page.evaluate(() => window.__retrowright.speed);
    speeds.held = await framesPerSecond(page, SPEED_SECONDS);
    await page.keyboard.up("Tab");
    await sleep(200);
    const releasedSpeed = await page.evaluate(() => window.__retrowright.speed);
    speeds.released = await framesPerSecond(page, SPEED_SECONDS);
    console.log(`frames a second: normal ${speeds.normal.fps.toFixed(1)} (${speeds.normal.frames} frames), Tab held ${speeds.held.fps.toFixed(1)} (${speeds.held.frames}), let go ${speeds.released.fps.toFixed(1)} (${speeds.released.frames})`);
    check(
      "holding Tab runs at least twice as many frames a second, and letting go returns to normal",
      heldSpeed === 3 && releasedSpeed === 1 && speeds.held.fps >= 2 * speeds.normal.fps && Math.abs(speeds.released.fps - speeds.normal.fps) < 0.15 * speeds.normal.fps,
      { heldSpeed, releasedSpeed, ...speeds },
    );

    // The menu's toggle form.
    await openDisplay(page);
    await page.click("[data-item=fast-forward]");
    await closeMenu(page);
    await sleep(200);
    const toggledSpeed = await page.evaluate(() => window.__retrowright.speed);
    speeds.toggled = await framesPerSecond(page, SPEED_SECONDS);
    await openDisplay(page);
    await page.click("[data-item=fast-forward]");
    await closeMenu(page);
    await sleep(200);
    const untoggledSpeed = await page.evaluate(() => window.__retrowright.speed);
    check(
      "the menu's Fast-forward toggle runs at least twice as fast until it is turned off",
      toggledSpeed === 3 && untoggledSpeed === 1 && speeds.toggled.fps >= 2 * speeds.normal.fps,
      { toggledSpeed, untoggledSpeed, toggled: speeds.toggled },
    );

    // Every option changed in the menu, then a reload.
    await openDisplay(page);
    await page.click("[data-item=scaling]");
    await page.click("[data-item=aspect]");
    await page.click("[data-item=scanlines]");
    await page.focus("[data-item=scanline-intensity]");
    for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowRight");
    await page.select("[data-item=fast-forward-speed]", "4");
    const setInMenu = await menuSettings(page);
    await shoot(page, "menu-display", "The quick menu's Display and speed section after changing every option.");
    await closeMenu(page);
    await sleep(300);
    const before = await picture(page);
    await shoot(page, "scanlines", `Fill scaling, square pixels and scanlines at ${before.scanlines}: the page at 1280x900.`);
    const stored = await page.evaluate(() => localStorage.getItem("retrowright.display"));

    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".continue-button");
    await page.click(".continue-button");
    await waitFor(page, "the game to open again", () => window.__retrowright?.game);
    await waitFrames(page, 30);
    const after = await picture(page);
    await openDisplay(page);
    const afterReload = await menuSettings(page);
    await closeMenu(page);
    console.log(`stored: ${stored}`);
    check(
      "every display option set in the menu survives a reload: fill, square pixels, scanlines and their intensity, the fast-forward speed",
      JSON.stringify(after) === JSON.stringify(before) && JSON.stringify(afterReload) === JSON.stringify(setInMenu) && after.scaling === "fill" && after.aspect === "square" && after.scanlines === 0.6 && afterReload.speed === "4",
      { before, after, setInMenu, afterReload, stored },
    );
    await shoot(page, "after-reload", "After the reload and Continue: the same fill scaling, square pixels and scanlines.");
  } else {
    await shoot(page, "page-1280x900", "The page at 1280x900 as this build draws it.");
  }
} catch (error) {
  check(`the run finished: ${error.message}`, false);
  exitCode = 1;
} finally {
  await browser.close();
  await server.stop();
}

const passed = checks.filter((item) => item.ok).length;
if (checks.some((item) => !item.ok)) exitCode = 1;
await writeReport({ when: new Date().toString(), options, passed, checks, sizes, speeds, screenshots: shots, console: consoleLines });
console.log(`${passed}/${checks.length} checks passed; report in ${OUT}`);
process.exit(exitCode);
