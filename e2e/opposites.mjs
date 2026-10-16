// Opposite directions in headless Firefox (puppeteer-core over WebDriver
// BiDi), on the development server, with a synthetic ROM that reads both pads
// every pass into RAM ($20 pad 1, $21 pad 2; A is bit 7, Right bit 0) and sets
// $22 for good on any pass where a pad reads Left with Right or Up with Down.
// Checks, through what the game itself read: the arrows and WASD together give
// the direction pressed last and the other back once it is let go; a combo key
// holding Down+B wins over Up held by another key; player 2's keys do the
// same on pad 2; and after all of it, and a burst of every direction pressed
// at once on both pads, $22 is still 0: no pass read both of a pair.
//
// Usage: npm run e2e:opposites [-- output-dir]
// Not part of `npm test`: it needs Firefox.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import { Button } from "../src/core/types.ts";
import { addCombo, DEFAULT_BINDINGS, player2Action, rebind } from "../src/input/keyBindings.ts";
import { buildInes, FLAG_OPPOSITES_PROGRAM } from "../src/test/syntheticRom.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "opposites"));
const ROMS = join(OUT, "roms");
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";

/** The bits FLAG_OPPOSITES_PROGRAM keeps each button in. */
const BIT = { A: 0x80, B: 0x40, Select: 0x20, Start: 0x10, Up: 0x08, Down: 0x04, Left: 0x02, Right: 0x01 };
const PAD1 = 0x20;
const PAD2 = 0x21;
const BOTH_READ = 0x22;

/** The defaults, a Down+B combo on C, and player 2's directions on I, J, K and L. */
let bindings = addCombo(DEFAULT_BINDINGS, "KeyC", [Button.Down, Button.B]);
for (const [button, code] of [[Button.Up, "KeyI"], [Button.Left, "KeyJ"], [Button.Down, "KeyK"], [Button.Right, "KeyL"]]) {
  bindings = rebind(bindings, player2Action(button), code);
}

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

const hex = (byte) => `$${byte.toString(16).padStart(2, "0").toUpperCase()}`;
const bits = (...buttons) => buttons.reduce((sum, button) => sum | BIT[button], 0);

/** What the game read from both pads a few frames after `act`. */
async function padsAfter(page, act) {
  await act();
  const before = await page.evaluate(() => window.__retrowright.framesRun);
  await waitFor(page, "frames to run", (count) => window.__retrowright.framesRun > count + 3, before);
  return page.evaluate(([one, two]) => [window.__retrowright.peek(one), window.__retrowright.peek(two)], [PAD1, PAD2]);
}

function checkPads(name, [pad1, pad2], want1, want2) {
  check(name, pad1 === want1 && pad2 === want2, `pad 1 ${hex(pad1)} (want ${hex(want1)}), pad 2 ${hex(pad2)} (want ${hex(want2)})`);
}

const keys = (page, direction, ...codes) => async () => {
  for (const code of codes) await page.keyboard[direction](code);
};

function escape(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

await mkdir(ROMS, { recursive: true });
await writeFile(join(ROMS, "flag-opposites.nes"), buildInes({ program: FLAG_OPPOSITES_PROGRAM }));
process.env.RETROWRIGHT_TEST_ROMS = ROMS;
const vite = await createServer({ configFile: join(ROOT, "vite.config.ts"), root: ROOT, logLevel: "error", server: { host: "127.0.0.1", port: 5194 } });
await vite.listen();
const origin = new URL(vite.resolvedUrls.local[0]).origin;
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
let finished = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const url = `${origin}/?play=local-roms/flag-opposites.nes&label=Opposite%20directions&controls=1`;
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate((stored) => localStorage.setItem("retrowright.keyBindings.v1", stored), JSON.stringify({ version: 3, ...bindings }));
  await page.goto(url, { waitUntil: "load" });
  await waitFor(page, "the game to run", () => window.__retrowright?.game === "flag-opposites.nes" && window.__retrowright.framesRun > 30);
  await page.evaluate(() => document.querySelector("canvas.screen").focus());
  checkPads("nothing is read from either pad before a key is pressed", await padsAfter(page, async () => {}), 0, 0);

  checkPads("← holds Left", await padsAfter(page, keys(page, "down", "ArrowLeft")), bits("Left"), 0);
  checkPads("D pressed with ← held gives Right alone", await padsAfter(page, keys(page, "down", "KeyD")), bits("Right"), 0);
  await shot(page, "left-then-right.png", "← then D held: the game reads Right alone");
  checkPads("letting go of D gives Left back", await padsAfter(page, keys(page, "up", "KeyD")), bits("Left"), 0);
  checkPads("letting go of ← lets go of Left", await padsAfter(page, keys(page, "up", "ArrowLeft")), 0, 0);

  checkPads("S then ↑ held gives Up alone", await padsAfter(page, keys(page, "down", "KeyS", "ArrowUp")), bits("Up"), 0);
  checkPads("letting go of ↑ gives Down back", await padsAfter(page, keys(page, "up", "ArrowUp")), bits("Down"), 0);
  checkPads("letting go of S lets go of Down", await padsAfter(page, keys(page, "up", "KeyS")), 0, 0);

  checkPads("the Down+B combo on C wins over Up held by ↑", await padsAfter(page, keys(page, "down", "ArrowUp", "KeyC")), bits("Down", "B"), 0);
  checkPads("letting go of C gives Up back", await padsAfter(page, keys(page, "up", "KeyC")), bits("Up"), 0);
  checkPads("letting go of ↑ lets go of Up", await padsAfter(page, keys(page, "up", "ArrowUp")), 0, 0);

  checkPads("player 2's J then L give pad 2 Right alone", await padsAfter(page, keys(page, "down", "KeyJ", "KeyL")), 0, bits("Right"));
  checkPads("player 2's K then I add Up alone", await padsAfter(page, keys(page, "down", "KeyK", "KeyI")), 0, bits("Right", "Up"));
  checkPads("letting go of player 2's keys lets go of all", await padsAfter(page, keys(page, "up", "KeyJ", "KeyL", "KeyK", "KeyI")), 0, 0);

  // Every direction on both pads, pressed and let go without waiting for a frame between.
  const everyDirection = ["ArrowLeft", "KeyD", "ArrowUp", "KeyS", "KeyC", "KeyJ", "KeyL", "KeyI", "KeyK"];
  for (let round = 0; round < 10; round++) {
    await keys(page, "down", ...everyDirection)();
    await sleep(20);
    await keys(page, "up", ...everyDirection.slice(round % 3))();
    await sleep(20);
    await keys(page, "up", ...everyDirection)();
  }
  await padsAfter(page, async () => {});
  const flag = await page.evaluate((address) => window.__retrowright.peek(address), BOTH_READ);
  const frames = await page.evaluate(() => window.__retrowright.framesRun);
  check("no pass of the game read Left with Right or Up with Down on either pad", flag === 0, `$22 = ${hex(flag)} after ${frames} frames`);
  await shot(page, "after.png", "After every check: $22, the ROM's flag for a read with both of a pair, still 0");
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
  `<!doctype html><meta charset="utf-8"><title>retrowright: opposite directions</title>
<style>body{font-family:system-ui,sans-serif;max-width:1400px;margin:1rem auto;padding:0 1rem}figure{display:inline-block;margin:.5rem;vertical-align:top;max-width:640px}figure img{max-width:100%;border:1px solid #ccc}td{padding:.2rem .5rem;vertical-align:top}code{font-size:.8em;word-break:break-all}</style>
<h1>Opposite directions (development server, headless Firefox, a ROM flagging a read with both of a pair)</h1>
<p>${escape(new Date().toString())} · ${failing} failing</p>
<table>${checks.map((item) => `<tr><td>${item.ok ? "✅" : "❌"}</td><td>${escape(item.name)}</td><td><code>${escape(item.detail)}</code></td></tr>`).join("\n")}</table>
<h2>Screenshots</h2>${shots.map((item) => `<figure><img src="${item.file}" alt="${escape(item.caption)}"><figcaption>${escape(item.caption)}</figcaption></figure>`).join("\n")}
`,
);
console.log(`${checks.length} checks, ${failing} failing${finished ? "" : ", the run did not finish"}; report in ${OUT}`);
process.exit(failing === 0 && finished ? 0 : 1);
