// Touch play in headless Firefox (puppeteer-core over WebDriver BiDi), with
// synthetic Pointer Events of type "touch": a phone has no keyboard or pad.
// Serves the built dist/ under a sub-path, adds Final Fantasy through the file
// input (a single file starts at once), and plays it with touches alone at
// phone sizes: from power-on through the prologue, the title menu's New Game,
// naming the four characters (two in portrait, two after turning the phone to
// landscape), onto the world map and north into Coneria Castle, read back
// through the game's memory map. Checks that the picture fills the layout's
// screen rectangle in both orientations, that the page neither scrolls nor
// zooms, that holding » runs at least twice as many frames a second, that a
// key press hides the controls and a touch brings them back,
// and takes screenshots at each step and of both orientations in the light
// and dark themes, set through the quick menu by touch. Writes the
// screenshots, results.json and an index.html to the output directory.
//
// Usage: npm run build && node e2e/touch.mjs [output-dir]
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
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "touch"));
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";
const SUB_PATH = "/retrowright/";
const PORTS = [8800, 8801, 8802, 8803, 8804, 8805, 8806, 8807, 8808, 8809];
const PORTRAIT = { width: 390, height: 664 };
const LANDSCAPE = { width: 844, height: 340 };
/** Four letters fill a name box, so the next A ends the name; each is typed on the name grid with the D-pad and A. */
const NAMES = ["ACED", "BEAD", "CAFE", "DICE"];
const NAME_GRID = ["ABCDEFGHIJ", "KLMNOPQRST", "UVWXYZ"];
const STEP_FRAMES = 16; // one tile of walking

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

async function waitFor(page, description, predicate, arg, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const value = await page.evaluate(predicate, arg);
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${description}.`);
    await sleep(16);
  }
}

const framesRun = (page) => page.evaluate(() => window.__retrowright?.framesRun ?? 0);

async function waitFrames(page, count) {
  const target = (await framesRun(page)) + count;
  await waitFor(page, `${count} more frames`, (wanted) => (window.__retrowright?.framesRun ?? 0) >= wanted, target);
}

/**
 * A finger: a PointerEvent of type touch at (x, y). It goes down on the
 * element under it, and its moves and lift go to that same element, as a
 * browser's implicit capture of a touch sends them.
 */
async function finger(page, type, pointerId, x, y) {
  await page.evaluate(
    ({ type, pointerId, x, y }) => {
      window.__fingers ??= {};
      if (type === "pointerdown") window.__fingers[pointerId] = document.elementFromPoint(x, y);
      const target = window.__fingers[pointerId];
      if (!target) throw new Error(`No element under (${x}, ${y}).`);
      target.dispatchEvent(new PointerEvent(type, { pointerType: "touch", pointerId, isPrimary: pointerId === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true }));
      if (type === "pointerup") delete window.__fingers[pointerId];
    },
    { type, pointerId, x, y },
  );
}

const DPAD_REACH = 0.38;
const DIRECTIONS = { Up: [0, -1], Down: [0, 1], Left: [-1, 0], Right: [1, 0] };

/** Where to touch a control: its centre, or for the D-pad the middle of an arm. */
async function controlPoint(page, control) {
  const [id, direction] = control.startsWith("dpad:") ? ["dpad", control.slice(5)] : [control, null];
  const box = await page.evaluate((wanted) => {
    const rect = document.querySelector(`[data-control="${wanted}"]`)?.getBoundingClientRect();
    return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, id);
  if (!box) throw new Error(`The touch control ${id} is not shown.`);
  const [dx, dy] = direction ? DIRECTIONS[direction] : [0, 0];
  return { x: box.x + box.width / 2 + dx * DPAD_REACH * box.width, y: box.y + box.height / 2 + dy * DPAD_REACH * box.height };
}

/** Touches a control for `holdFrames`, lifts, and waits `releaseFrames`; returns the buttons the core saw held. */
async function press(page, control, holdFrames = 5, releaseFrames = 12) {
  const { x, y } = await controlPoint(page, control);
  await finger(page, "pointerdown", 1, x, y);
  const held = await page.evaluate(() => window.__retrowright.heldButtons());
  await waitFrames(page, holdFrames);
  await finger(page, "pointerup", 1, x, y);
  await waitFrames(page, releaseFrames);
  return held;
}

/** A tap on an HTML element (a menu item): the pointer events a finger makes, then the click the browser sends. */
async function tapElement(page, selector) {
  await page.evaluate((wanted) => {
    const element = document.querySelector(wanted);
    if (!element) throw new Error(`Nothing matches ${wanted}.`);
    const rect = element.getBoundingClientRect();
    const init = { pointerType: "touch", pointerId: 9, isPrimary: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, bubbles: true, cancelable: true };
    element.dispatchEvent(new PointerEvent("pointerdown", init));
    element.dispatchEvent(new PointerEvent("pointerup", init));
    element.click();
  }, selector);
  await sleep(80);
}

const shots = [];
async function shoot(page, name, caption) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  shots.push({ file: `${name}.png`, caption });
}

function gridPosition(letter) {
  const row = NAME_GRID.findIndex((line) => line.includes(letter));
  return { row, column: NAME_GRID[row].indexOf(letter) };
}

/** Names the character under the cursor on the party screen, by touch (the same steps as harness/makeFf1NewGame.ts). */
async function typeName(page, name) {
  await press(page, "a", 5, 30); // opens the name screen
  let at = { row: 0, column: 0 };
  for (const letter of name) {
    const to = gridPosition(letter);
    for (; at.row < to.row; at.row++) await press(page, "dpad:Down");
    for (; at.row > to.row; at.row--) await press(page, "dpad:Up");
    for (; at.column < to.column; at.column++) await press(page, "dpad:Right");
    for (; at.column > to.column; at.column--) await press(page, "dpad:Left");
    await press(page, "a");
  }
  await press(page, "a", 5, 30); // a last A ends the name
}

const state = (page) => page.evaluate(() => window.__retrowright.gameState());

/** The picture against the layout's screen rectangle: with fill scaling it meets two opposite sides of it. */
const pictureFit = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector("canvas.screen");
    const picture = canvas.getBoundingClientRect();
    const box = document.querySelector(".screen-box.fitted").getBoundingClientRect();
    const fillsWidth = Math.abs(picture.width - box.width) < 1;
    const fillsHeight = Math.abs(picture.height - box.height) < 1;
    return { scaling: canvas.dataset.scaling, scale: canvas.dataset.scale, picture: { width: picture.width, height: picture.height }, box: { width: box.width, height: box.height }, fillsWidth, fillsHeight, fills: (fillsWidth || fillsHeight) && picture.width <= box.width + 1 && picture.height <= box.height + 1 };
  });

/** Emulated frames a second over `seconds` of the page's own clock. */
async function framesPerSecond(page, seconds) {
  const start = await page.evaluate(() => ({ frames: window.__retrowright.framesRun, time: performance.now() }));
  await sleep(seconds * 1000);
  const end = await page.evaluate(() => ({ frames: window.__retrowright.framesRun, time: performance.now() }));
  const frames = end.frames - start.frames;
  return { frames, seconds: (end.time - start.time) / 1000, fps: frames / ((end.time - start.time) / 1000) };
}
const SPEED_SECONDS = 3;
const layerOrientation = (page) => page.evaluate(() => document.querySelector(".touch-layer")?.dataset.orientation ?? null);

/** Sets the theme through the quick menu, opened and driven by touch. */
async function setThemeByTouch(page, wanted) {
  const menu = await controlPoint(page, "menu");
  await finger(page, "pointerdown", 1, menu.x, menu.y);
  await finger(page, "pointerup", 1, menu.x, menu.y);
  await waitFor(page, "the menu", () => document.querySelector("[role=dialog]") !== null);
  await tapElement(page, "[data-item=display]");
  for (let step = 0; step < 3 && (await page.evaluate(() => document.documentElement.dataset.theme)) !== wanted; step++) await tapElement(page, "[data-item=theme]");
  await tapElement(page, "[data-item=back]");
  await tapElement(page, "[data-item=resume]");
  await waitFor(page, "the menu to close", () => document.querySelector("[role=dialog]") === null);
  return page.evaluate(() => document.documentElement.dataset.theme);
}

async function writeReport(results) {
  await writeFile(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const escape = (text) => String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  const figure = (shot) => `<figure><img src="${shot.file}" alt="${escape(shot.caption)}"><figcaption>${escape(shot.caption)}</figcaption></figure>`;
  const themed = results.screenshots.filter((shot) => shot.file.startsWith("theme-"));
  const steps = results.screenshots.filter((shot) => !shot.file.startsWith("theme-"));
  const rows = results.checks.map((item) => `<tr><td>${item.ok ? "✅" : "❌"}</td><td>${escape(item.name)}</td><td><code>${escape(JSON.stringify(item.detail ?? ""))}</code></td></tr>`).join("\n");
  await writeFile(
    join(OUT, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>retrowright: touch play</title>
<style>body{font-family:system-ui,sans-serif;max-width:1200px;margin:1rem auto;padding:0 1rem}figure{display:inline-block;margin:.5rem;vertical-align:top}figure img{border:1px solid #ccc;max-height:520px}td{padding:.2rem .5rem;vertical-align:top}code{font-size:.85em;word-break:break-all}</style>
<h1>retrowright: touch play in headless Firefox</h1>
<p>${escape(results.when)} · ${results.passed}/${results.checks.length} checks passed · synthetic Pointer Events of type touch</p>
<h2>Both orientations, light and dark</h2>${themed.map(figure).join("\n")}
<h2>Checks</h2><table>${rows}</table>
<h2>Final Fantasy by touch alone, step by step</h2>${steps.map(figure).join("\n")}
`,
  );
}

await mkdir(OUT, { recursive: true });
const server = await startStaticServer({ root: DIST, subPath: SUB_PATH, ports: PORTS });
const url = `http://127.0.0.1:${server.port}${SUB_PATH}?debug`;
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
const consoleLines = [];
let exitCode = 0;
try {
  const page = await browser.newPage();
  page.on("console", (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`pageerror: ${error.message}`));
  await page.setViewport(PORTRAIT);
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("#rom-input");
  await shoot(page, "01-library-portrait", "The library on a phone in portrait, before any game.");

  // One file chosen: it starts at once.
  await (await page.$("#rom-input")).uploadFile(ROM);
  await waitFor(page, "the game to start", () => window.__retrowright?.game);
  const shownBefore = await page.evaluate(() => document.querySelector(".touch-layer") !== null);
  const canvas = await page.evaluate(() => {
    const rect = document.querySelector("canvas.screen").getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await finger(page, "pointerdown", 1, canvas.x, canvas.y);
  await finger(page, "pointerup", 1, canvas.x, canvas.y);
  await page.waitForSelector(".touch-layer");
  check("a single added file starts the game, and the touch controls appear on the first touch", shownBefore === false && (await layerOrientation(page)) === "portrait", { shownBefore, orientation: await layerOrientation(page) });
  await shoot(page, "02-power-on-portrait", "Power-on, portrait: the touch controls appeared on the first touch; the picture fills the layout's screen rectangle.");
  const portraitFit = await pictureFit(page);
  check("with no scaling chosen, the picture fills the layout's screen rectangle in portrait (fill scaling, not a whole multiple)", portraitFit.scaling === "fill" && portraitFit.fills, portraitFit);

  // The page is locked while playing. Synthetic pointer events never pinch-zoom
  // a page, so the check reads the styles that keep a real finger from it.
  await page.evaluate(() => window.scrollTo(0, 400));
  const lock = await page.evaluate(() => {
    const stage = document.querySelector(".stage");
    return {
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      zoom: window.visualViewport?.scale ?? 1,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      stageTouchAction: getComputedStyle(stage).touchAction,
      layerTouchAction: getComputedStyle(document.querySelector(".touch-layer")).touchAction,
      userSelect: getComputedStyle(document.body).userSelect,
      stageCoversPage: stage.getBoundingClientRect().width === window.innerWidth && stage.getBoundingClientRect().height === window.innerHeight,
    };
  });
  check(
    "while playing on a phone-sized page the page does not scroll to 400, nothing overflows, overflow is hidden, touch-action is none on the stage and the touch layer, and text selection is off",
    lock.scrollY === 0 && lock.scrollHeight <= lock.innerHeight && lock.zoom === 1 && lock.htmlOverflow === "hidden" && lock.stageTouchAction === "none" && lock.layerTouchAction === "none" && lock.userSelect === "none" && lock.stageCoversPage,
    lock,
  );

  await waitFrames(page, 300);
  await shoot(page, "03-prologue-portrait", "The prologue scrolling, portrait.");
  const heldStart = await press(page, "start");
  await waitFrames(page, 60);
  check("touching START reaches the core as Start", heldStart.includes("1:Start"), heldStart);
  await shoot(page, "04-title-menu-portrait", "After touching START: the title menu.");
  const heldDown = await press(page, "dpad:Down");
  const heldA = await press(page, "a");
  await waitFrames(page, 60);
  check("the D-pad's lower arm reaches the core as Down and A as A", heldDown.includes("1:Down") && heldA.includes("1:A"), { heldDown, heldA });
  const classScreen = await state(page);
  check("Down then A on the title menu opens New Game's party screen", classScreen.gold === 400 && classScreen.party[0].maxHp === 0, { gold: classScreen.gold, maxHp: classScreen.party[0].maxHp });
  await shoot(page, "05-party-screen-portrait", "New Game: the party screen, portrait.");

  for (const [index, name] of NAMES.slice(0, 2).entries()) {
    await typeName(page, name);
    await shoot(page, `06-named-${index + 1}-portrait`, `Character ${index + 1} named ${name} by touch, portrait.`);
  }

  // Turn the phone: the game keeps running, the controls move beside the picture.
  const beforeTurn = await page.evaluate(() => ({ game: window.__retrowright.game, frames: window.__retrowright.framesRun }));
  await page.setViewport(LANDSCAPE);
  await waitFor(page, "the landscape layout", () => document.querySelector(".touch-layer")?.dataset.orientation === "landscape");
  await waitFrames(page, 30);
  const afterTurn = await page.evaluate(() => {
    const screen = document.querySelector("canvas.screen").getBoundingClientRect();
    const dpad = document.querySelector("[data-control=dpad]").getBoundingClientRect();
    const a = document.querySelector("[data-control=a]").getBoundingClientRect();
    return { game: window.__retrowright.game, frames: window.__retrowright.framesRun, dpadLeftOfPicture: dpad.right <= screen.left, aRightOfPicture: a.left >= screen.right };
  });
  check("turning to landscape keeps the game running and puts the controls beside the picture", afterTurn.game === beforeTurn.game && afterTurn.frames > beforeTurn.frames && afterTurn.dpadLeftOfPicture && afterTurn.aRightOfPicture, { beforeTurn, afterTurn });
  await shoot(page, "07-turned-landscape", "Turned to landscape mid-naming: the same game, the controls beside the picture.");
  const landscapeFit = await pictureFit(page);
  check("the picture fills the layout's screen rectangle in landscape too", landscapeFit.scaling === "fill" && landscapeFit.fills, landscapeFit);

  for (const [index, name] of NAMES.slice(2).entries()) {
    await typeName(page, name);
    await shoot(page, `08-named-${index + 3}-landscape`, `Character ${index + 3} named ${name} by touch, landscape.`);
  }
  await waitFrames(page, 30);
  await press(page, "a", 5, 300); // accept the party; the game opens on the world map
  const worldMap = await state(page);
  check("the four characters are named by touch and the game opens on the world map", worldMap.party.map((member) => member.name).join(",") === NAMES.join(",") && worldMap.onWorldMap === true, { names: worldMap.party.map((member) => member.name), onWorldMap: worldMap.onWorldMap });
  await shoot(page, "09-world-map-landscape", "The party on the world map, landscape.");

  await press(page, "dpad:Up", 10 * STEP_FRAMES, 120); // north into the castle, held on the D-pad
  const castle = await state(page);
  check("holding Up on the D-pad walks the party into Coneria Castle", castle.map === "Coneria Castle 1F", { map: castle.map });
  await shoot(page, "10-coneria-castle-landscape", "Inside Coneria Castle, walked in by holding Up on the D-pad, landscape.");

  // Two fingers at once: Left on the D-pad and A.
  const left = await controlPoint(page, "dpad:Left");
  const a = await controlPoint(page, "a");
  await finger(page, "pointerdown", 1, left.x, left.y);
  await finger(page, "pointerdown", 2, a.x, a.y);
  const both = await page.evaluate(() => window.__retrowright.heldButtons());
  await waitFrames(page, 4);
  await finger(page, "pointerup", 2, a.x, a.y);
  await finger(page, "pointerup", 1, left.x, left.y);
  check("two fingers hold Left and A at once", both.includes("1:Left") && both.includes("1:A"), both);

  // » held: measured as e2e/display.mjs measures Tab.
  const speeds = { normal: await framesPerSecond(page, SPEED_SECONDS) };
  const fast = await controlPoint(page, "fast");
  await finger(page, "pointerdown", 1, fast.x, fast.y);
  await sleep(200);
  const heldSpeed = await page.evaluate(() => window.__retrowright.speed);
  speeds.held = await framesPerSecond(page, SPEED_SECONDS);
  await finger(page, "pointerup", 1, fast.x, fast.y);
  await sleep(200);
  const releasedSpeed = await page.evaluate(() => window.__retrowright.speed);
  speeds.released = await framesPerSecond(page, SPEED_SECONDS);
  console.log(`frames a second: normal ${speeds.normal.fps.toFixed(1)}, » held ${speeds.held.fps.toFixed(1)}, let go ${speeds.released.fps.toFixed(1)}`);
  check(
    "holding » runs at least twice as many frames a second, and letting go returns to normal",
    heldSpeed === 3 && releasedSpeed === 1 && speeds.held.fps >= 2 * speeds.normal.fps && Math.abs(speeds.released.fps - speeds.normal.fps) < 0.15 * speeds.normal.fps,
    { heldSpeed, releasedSpeed, ...speeds },
  );

  // A key press hides the controls; a touch brings them back.
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.up("ShiftLeft");
  const hiddenByKey = await waitFor(page, "the controls to hide", () => document.querySelector(".touch-layer") === null);
  const canvasNow = await page.evaluate(() => {
    const rect = document.querySelector("canvas.screen").getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await shoot(page, "11-hidden-by-key", "After a key press: the touch controls are hidden and the page is the desktop one.");
  await finger(page, "pointerdown", 1, canvasNow.x, canvasNow.y);
  await finger(page, "pointerup", 1, canvasNow.x, canvasNow.y);
  const back = await waitFor(page, "the controls to come back", () => document.querySelector(".touch-layer") !== null);
  check("a key press hides the touch controls and a touch brings them back", hiddenByKey && back);

  // Both orientations in both themes, the theme set through the menu by touch.
  for (const theme of ["dark", "light"]) {
    const set = await setThemeByTouch(page, theme);
    for (const [label, size] of [
      ["landscape", LANDSCAPE],
      ["portrait", PORTRAIT],
    ]) {
      await page.setViewport(size);
      await waitFor(page, `the ${label} layout`, (wanted) => document.querySelector(".touch-layer")?.dataset.orientation === wanted, label);
      await sleep(200);
      await shoot(page, `theme-${theme}-${label}`, `Touch play, ${label}, ${set} theme.`);
    }
  }
  const menu = await controlPoint(page, "menu");
  await finger(page, "pointerdown", 1, menu.x, menu.y);
  await finger(page, "pointerup", 1, menu.x, menu.y);
  await waitFor(page, "the menu", () => document.querySelector("[role=dialog]") !== null);
  await tapElement(page, "[data-item=touch]");
  await shoot(page, "theme-light-portrait-menu", "The menu's Touch controls view by touch: on/off, Size, Opacity, portrait, light theme.");
} catch (error) {
  exitCode = 1;
  check("the run finished", false, String(error?.stack ?? error));
} finally {
  await browser.close();
  await server.stop();
}

const results = { when: new Date().toString(), url, passed: checks.filter((item) => item.ok).length, checks, screenshots: shots, console: consoleLines };
await writeReport(results);
const failed = checks.filter((item) => !item.ok).length;
console.log(`${results.passed} passed, ${failed} failed. Report: ${join(OUT, "index.html")}`);
process.exit(exitCode || (failed > 0 ? 1 : 0));
