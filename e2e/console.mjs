// The developer console in headless Firefox (puppeteer-core over WebDriver
// BiDi), on the development server, with a synthetic ROM that shows RAM $00
// as the backdrop colour and counts frames in $01. With Developer tools off,
// as by default, the backtick and F4 open nothing; the menu's Display and
// speed turns the setting on. Then, with the keyboard alone:
// the backtick opens the console with focus in its input (and is typed there
// as a character); pause holds the game; peek, step and the frame count
// agree; poke $00 changes the colour of the picture two frames on; a watch
// follows $01; Tab completes, Up recalls, a typo is named with the closest
// command; letters typed there press no game button; Escape gives focus back
// to the picture and the backtick hides and shows the console with its
// scrollback kept. Then the console sits beside the picture, never over it,
// at three window sizes and with the tools panel, and full screen shows the
// picture alone. Screenshots and an index.html go to the output folder.
//
// Usage: npm run e2e:console [-- output-dir]
// Not part of `npm test`: it needs Firefox.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import { buildInes, COUNT_NMI_HANDLER, SHOW_RAM_COLOUR_PROGRAM } from "../src/test/syntheticRom.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "console"));
const ROMS = join(OUT, "roms");
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";
const SIZES = [
  { width: 1600, height: 1000 },
  { width: 1100, height: 800 },
  { width: 800, height: 900 },
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const checks = [];
const shots = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
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

const framesRun = (page) => page.evaluate(() => window.__retrowright.framesRun);
const focusedId = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.className || null);
const inputValue = (page) => page.$eval("#console-input", (input) => input.value);
/** The colour in the middle of the picture as drawn on the page's canvas, as "r,g,b". */
const middleColour = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector("canvas.screen");
    const [r, g, b] = canvas.getContext("2d").getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
    return `${r},${g},${b}`;
  });

/** Types a command into the console's input, presses Enter and returns the answer or error added after it. */
async function run(page, command) {
  const before = await page.$$eval(".console-line", (lines) => lines.length);
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
  // The typed line and its answer come in one render.
  await waitFor(page, `the answer to ${command}`, (count) => document.querySelectorAll(".console-line").length > count, before);
  return page.$$eval(".console-line", (lines, from) => lines.slice(from + 1).map((line) => line.textContent).join("\n"), before);
}

/** Turns the Display setting Developer tools on in the menu, and gives focus back to the picture. */
async function turnOnDeveloperTools(page) {
  await page.focus("canvas.screen");
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-item=display]");
  await page.click("[data-item=display]");
  await page.waitForSelector("[data-item=developer-tools]");
  await page.click("[data-item=developer-tools]");
  const label = await page.$eval("[data-item=developer-tools]", (button) => button.textContent);
  check("the menu's Display and speed turns Developer tools on", label === "Developer tools: on", label);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await waitFor(page, "the menu to close", () => document.querySelector("[role=dialog]") === null);
  await page.focus("canvas.screen");
}

/** The picture's and the console's boxes, and the area they share. */
const boxes = (page) =>
  page.evaluate(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null;
    };
    const picture = rect("canvas.screen");
    const panels = Object.fromEntries([".console-panel", ".tools-panel", ".controls-side"].map((selector) => [selector, rect(selector)]).filter(([, box]) => box));
    const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return { picture, panels, overlaps: Object.fromEntries(Object.entries(panels).map(([name, box]) => [name, overlap(picture, box)])) };
  });

function escape(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

async function writeReport() {
  await writeFile(join(OUT, "results.json"), JSON.stringify(checks, null, 2));
  const rows = checks.map((item) => `<tr><td>${item.ok ? "✅" : "❌"}</td><td>${escape(item.name)}</td><td><code>${escape(item.detail)}</code></td></tr>`).join("\n");
  const figures = shots.map((item) => `<figure><img src="${item.file}" alt="${escape(item.caption)}"><figcaption>${escape(item.caption)}</figcaption></figure>`).join("\n");
  await writeFile(
    join(OUT, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>retrowright: developer console</title>
<style>body{font-family:system-ui,sans-serif;max-width:1400px;margin:1rem auto;padding:0 1rem}figure{display:inline-block;margin:.5rem;vertical-align:top;max-width:640px}figure img{max-width:100%;border:1px solid #ccc}td{padding:.2rem .5rem;vertical-align:top}code{font-size:.85em}</style>
<h1>retrowright: the developer console in headless Firefox</h1>
<p>${escape(new Date().toString())} · ${checks.filter((item) => !item.ok).length} failing of ${checks.length}</p>
<h2>Beside the picture, at every size, and full screen</h2>${figures}
<h2>Checks</h2><table>${rows}</table>
`,
  );
}

await mkdir(ROMS, { recursive: true });
await writeFile(join(ROMS, "show-ram.nes"), buildInes({ program: SHOW_RAM_COLOUR_PROGRAM, nmiHandler: COUNT_NMI_HANDLER }));
process.env.RETROWRIGHT_TEST_ROMS = ROMS;
const vite = await createServer({ configFile: join(ROOT, "vite.config.ts"), root: ROOT, logLevel: "error", server: { host: "127.0.0.1", port: 5193 } });
await vite.listen();
const origin = new URL(vite.resolvedUrls.local[0]).origin;
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
let finished = false;
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.log(`pageerror: ${error.message}`));
  await page.setViewport(SIZES[0]);
  await page.goto(`${origin}/?play=local-roms/show-ram.nes&label=Console`, { waitUntil: "load" });
  await waitFor(page, "the game to run", () => window.__retrowright?.game === "show-ram.nes" && window.__retrowright.framesRun > 30);
  check("the console is off until asked for", (await page.$(".console-panel")) === null);

  await page.focus("canvas.screen");
  await page.keyboard.press("Backquote");
  await page.keyboard.press("F4");
  await sleep(300);
  check("with Developer tools off, as by default, the backtick and F4 open nothing", (await page.$(".console-panel, .tools-panel")) === null);
  await turnOnDeveloperTools(page);
  await page.keyboard.press("Backquote");
  await page.waitForSelector(".console-panel");
  check("the backtick on the picture opens the console with focus in its input", (await focusedId(page)) === "console-input", await focusedId(page));
  await page.keyboard.press("Backquote");
  check("a backtick typed in the input is a character, and the console stays", (await inputValue(page)) === "`" && (await page.$(".console-panel")) !== null, await inputValue(page));
  await page.keyboard.press("Backspace");

  const paused = await run(page, "pause");
  const pausedAt = await framesRun(page);
  await sleep(400);
  check("pause holds the game", /^Paused at frame \d+\.$/.test(paused) && (await framesRun(page)) === pausedAt, { paused, before: pausedAt, after: await framesRun(page) });
  check("letters typed into the console pressed no game button (A, S and D are bound to the pad)", (await page.evaluate(() => window.__retrowright.heldButtons())).length === 0);

  const count = Number(/\((\d+)\)/.exec(await run(page, "peek 1"))[1]);
  const stepped = await run(page, "step 5");
  const after = Number(/\((\d+)\)/.exec(await run(page, "peek $01"))[1]);
  check("step 5 runs five frames: the ROM's frame count in $01 moves by 5", after === ((count + 5) & 0xff) && /^Stepped 5 frames; paused at frame \d+\.$/.test(stepped), { count, after, stepped });

  const black = await middleColour(page);
  const poked = await run(page, "poke 0 $2A");
  const stillBlack = await middleColour(page);
  // jsnes fills a frame with the backdrop colour as the frame starts, so the colour the ROM writes during one frame shows from the next.
  await run(page, "step 2");
  const green = await middleColour(page);
  check("poke $00 $2A writes the byte the ROM shows; two frames on the picture is that colour", poked === "$0000 = $2A (42)" && stillBlack === black && green !== black, { black, green, poked });
  await shot(page, "01-poked-and-stepped.png", "After pause, peek, step 5, poke 0 $2A and step 2: the picture is green, beside it the console");

  const watching = await run(page, "watch 1");
  const watchBefore = await page.$eval("[data-watch='$0001'] dd", (node) => node.textContent);
  await run(page, "step 3");
  const watchAfter = await page.$eval("[data-watch='$0001'] dd", (node) => node.textContent);
  check("watch $01 shows the frame count under the input, following each frame", watching.startsWith("Watching $0001") && watchBefore !== watchAfter, { watchBefore, watchAfter });

  await page.keyboard.type("scr");
  await page.keyboard.press("Tab");
  check("Tab completes a command's name", (await inputValue(page)) === "screenshot " && (await focusedId(page)) === "console-input", await inputValue(page));
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ArrowUp");
  check("Up brings back the last command", (await inputValue(page)) === "step 3", await inputValue(page));
  await page.keyboard.press("ArrowUp");
  check("Up again brings back the one before", (await inputValue(page)) === "watch 1", await inputValue(page));
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  const typo = await run(page, "peak 0");
  check("a mistyped command is named with the closest one", typo === "No command named peak; did you mean peek? Type help for the list.", typo);
  const errorShown = await page.$eval(".console-line.error:last-child", (node) => node.textContent).catch(() => null);
  check("the error is shown as an error line", errorShown === typo, errorShown);

  const resumed = await run(page, "resume");
  const resumedAt = await framesRun(page);
  await waitFor(page, "frames after resume", (from) => window.__retrowright.framesRun > from + 5, resumedAt);
  check("resume runs the game again", resumed === "Running.");
  await run(page, "pause");

  await page.keyboard.press("Escape");
  check("Escape gives focus back to the picture and leaves the menu closed", (await focusedId(page)) === "screen" && (await page.$("[role=dialog]")) === null, await focusedId(page));
  await page.keyboard.press("Backquote");
  const hidden = await page.waitForSelector(".console-panel", { hidden: true, timeout: 5000 }).then(() => true, () => false);
  check("the backtick on the picture hides the console", hidden && (await page.$(".console-panel")) === null);
  const hiddenAt = await framesRun(page);
  await sleep(500);
  const afterHiding = await framesRun(page);
  check("hiding the console ends the pause typed into it", afterHiding > hiddenAt + 5, { hiddenAt, afterHiding });
  await page.keyboard.press("Backquote");
  await page.waitForSelector(".console-panel");
  const kept = await page.$$eval(".console-line", (lines) => lines.length);
  check("shown again, its scrollback is kept and its input has focus", kept > 10 && (await focusedId(page)) === "console-input", { lines: kept });

  for (const [index, size] of SIZES.entries()) {
    await page.setViewport(size);
    await sleep(300);
    const measured = await boxes(page);
    check(`at ${size.width}×${size.height} the console does not overlap the picture`, measured.overlaps[".console-panel"] === 0 && measured.picture.right - measured.picture.left > 200, measured);
    await shot(page, `0${index + 2}-${size.width}x${size.height}.png`, `${size.width}×${size.height}: the console ${measured.panels[".console-panel"].left >= measured.picture.right ? "beside" : "under"} the picture`);
  }

  await page.setViewport({ width: 1600, height: 1000 });
  await page.focus("canvas.screen");
  await page.keyboard.press("F4");
  await page.waitForSelector(".tools-panel");
  await sleep(300);
  const withTools = await boxes(page);
  const toolsBox = withTools.panels[".tools-panel"];
  const consoleBox = withTools.panels[".console-panel"];
  check(
    "with the tools panel too, the console sits under the tools beside the picture, overlapping neither",
    withTools.overlaps[".console-panel"] === 0 && withTools.overlaps[".tools-panel"] === 0 && consoleBox.top >= toolsBox.bottom && consoleBox.left >= withTools.picture.right,
    withTools,
  );
  await shot(page, "05-with-tools-1600x1000.png", "1600×1000 with the tools panel: the console under it, beside the picture");
  await page.keyboard.press("Escape");
  await waitFor(page, "the tools to close", () => document.querySelector(".tools-panel") === null);

  // Full screen: the menu's Fullscreen puts the game's section alone on the screen.
  await page.focus("canvas.screen");
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-item=display]");
  await page.click("[data-item=display]");
  await page.waitForSelector("[data-item=fullscreen]");
  await page.click("[data-item=fullscreen]");
  const fullscreen = await waitFor(page, "full screen", () => document.fullscreenElement && { stage: document.fullscreenElement.matches(".stage"), holdsConsole: document.fullscreenElement.contains(document.querySelector(".console-panel")) }, undefined, 5000).catch((error) => ({ error: error.message }));
  check("full screen shows the game's section alone: the console is not in it", fullscreen.stage === true && fullscreen.holdsConsole === false, fullscreen);
  // The menu is part of the game's section, so it shows in full screen too; Resume closes it there.
  await page.click("[data-item=back]");
  await page.waitForSelector("[data-item=resume]");
  await page.click("[data-item=resume]");
  await waitFor(page, "the menu to close", () => document.querySelector("[role=dialog]") === null);
  await sleep(300);
  await shot(page, "06-full-screen.png", "Full screen: the picture alone, no console");
  const stillFull = await page.evaluate(() => document.fullscreenElement?.matches(".stage") ?? false);
  check("the full-screen screenshot was taken in full screen", stillFull);
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  finished = true;
} catch (error) {
  check("the run finished", false, String(error?.stack ?? error));
} finally {
  await browser.close();
  await vite.close();
}
await writeReport();
const failed = checks.filter((item) => !item.ok).length;
console.log(`${checks.length - failed} passed, ${failed} failed; report in ${OUT}`);
process.exit(failed === 0 && finished ? 0 : 1);
