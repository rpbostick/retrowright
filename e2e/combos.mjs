// Combo keys and player 2's keys in headless Firefox (puppeteer-core over
// WebDriver BiDi), on the development server, with a synthetic ROM that reads
// both pads every pass into RAM ($20 pad 1, $21 pad 2; A is bit 7, Right
// bit 0). Checks, through what the game itself read: the Controls view adds
// Down+B on C and Down+A on V with one click each, changes a combo's key and
// buttons and removes it, and binds player 2's A and B to M and N; C presses
// Down and B together and lets go of both, while Down held by S stays held
// when C is let go; M and N reach pad 2; the controls panel lists player 2's
// keys and the combos. Screenshots go beside the report.
//
// Usage: npm run e2e:combos [-- output-dir]
// Not part of `npm test`: it needs Firefox.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import { buildInes, READ_BOTH_PADS_PROGRAM } from "../src/test/syntheticRom.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "combos"));
const ROMS = join(OUT, "roms");
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";

/** The bits READ_BOTH_PADS_PROGRAM keeps each button in. */
const BIT = { A: 0x80, B: 0x40, Select: 0x20, Start: 0x10, Up: 0x08, Down: 0x04, Left: 0x02, Right: 0x01 };
const PAD1 = 0x20;
const PAD2 = 0x21;

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

const text = (page, selector) => page.$eval(selector, (element) => element.textContent).catch(() => null);

function escape(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

await mkdir(ROMS, { recursive: true });
await writeFile(join(ROMS, "read-pads.nes"), buildInes({ program: READ_BOTH_PADS_PROGRAM }));
process.env.RETROWRIGHT_TEST_ROMS = ROMS;
const vite = await createServer({ configFile: join(ROOT, "vite.config.ts"), root: ROOT, logLevel: "error", server: { host: "127.0.0.1", port: 5192 } });
await vite.listen();
const origin = new URL(vite.resolvedUrls.local[0]).origin;
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
let finished = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200 });
  await page.goto(`${origin}/?play=local-roms/read-pads.nes&label=Combo%20keys&controls=1`, { waitUntil: "load" });
  await waitFor(page, "the game to run", () => window.__retrowright?.game === "read-pads.nes" && window.__retrowright.framesRun > 30);
  const picture = () => page.evaluate(() => document.querySelector("canvas.screen").focus());
  checkPads("nothing is read from either pad before a key is pressed", await padsAfter(page, async () => {}), 0, 0);
  await shot(page, "before.png", "Before: the controls panel with the defaults, no player 2 table and no combos");

  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-item=controls]");
  await page.click("[data-item=controls]");
  await page.waitForSelector("[data-add-combo='Down+B']");
  await page.$eval("[data-add-combo='Down+B']", (element) => element.scrollIntoView({ block: "center" }));
  await shot(page, "controls-empty.png", "Controls…: no combos yet; Down+B and Down+A offered");
  await page.click("[data-add-combo='Down+B']");
  const waiting = await text(page, "[data-add-combo='Down+B']");
  await page.keyboard.press("KeyC");
  await page.click("[data-add-combo='Down+A']");
  await page.keyboard.press("KeyV");
  const keys = [await text(page, "[data-combo='0']"), await text(page, "[data-combo='1']")];
  check("one click on Add Down+B, then C, adds the combo; Down+A on V likewise", waiting === "Press a key for Down+B…" && keys.join() === "C,V", `${waiting} → ${keys.join(", ")}`);

  // Change: V's combo to B, with Up added; then removed.
  await page.click("[data-combo='1']");
  await page.keyboard.press("KeyB");
  const buttonsOf = (index) => page.$$eval(`[data-combo='${index}']`, ([key]) => [...key.closest("tr").querySelectorAll("[data-combo-button][aria-pressed=true]")].map((button) => button.textContent).join("+"));
  await page.click("tr:nth-child(2) [data-combo-button=Up]");
  const changed = [await text(page, "[data-combo='1']"), await buttonsOf(1)];
  check("a combo's key and buttons change", changed.join(" ") === "B Up+Down+A", changed.join(" "));
  await page.$eval("[data-combo='1']", (element) => element.scrollIntoView({ block: "center" }));
  await shot(page, "controls-changed.png", "Controls…: Down+B on C, and the second combo moved to B with Up added");
  await page.click("[data-remove-combo='1']");
  const left = await page.$$eval("[data-combo]", (elements) => elements.map((element) => element.textContent).join(","));
  const offered = await text(page, "[data-add-combo='Down+A']");
  check("Remove takes the combo away, and Down+A is offered again", left === "C" && offered === "Add Down+A", `combos: ${left}; offered: ${offered}`);

  // Player 2's A and B on M and N.
  await page.click("[data-action=P2A][data-slot='0']");
  await page.keyboard.press("KeyM");
  await page.click("[data-action=P2B][data-slot='0']");
  await page.keyboard.press("KeyN");
  const player2 = [await text(page, "[data-action=P2A][data-slot='0']"), await text(page, "[data-action=P2B][data-slot='0']")];
  check("player 2's A and B are bound to M and N", player2.join() === "M,N", player2.join(", "));
  await page.$eval("[data-action=P2A]", (element) => element.scrollIntoView({ block: "center" }));
  await shot(page, "controls-player2.png", "Controls…: player 2's A on M and B on N, the combo on C below");
  await page.$eval("[data-combo='0']", (element) => element.scrollIntoView({ block: "center" }));
  await shot(page, "controls-combos.png", "Controls…: the combo on C after the second was removed");

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await waitFor(page, "the menu to close", () => !document.querySelector("[role=dialog]"));
  await picture();

  const panel = await page.evaluate(() =>
    [...document.querySelectorAll(".controls-side table")].map((table) => ({
      heading: table.querySelector("thead th")?.textContent,
      rows: [...table.querySelectorAll("tbody tr")].map((row) => [...row.children].map((cell) => cell.textContent).join(" | ")),
    })),
  );
  const player2Rows = panel.find((table) => table.heading === "Player 2")?.rows ?? [];
  const comboRows = panel.find((table) => table.heading === "Combo")?.rows ?? [];
  check(
    "the controls panel lists player 2's keys and the combo",
    player2Rows.includes("A | M | none | Second gamepad") && player2Rows.includes("B | N | none | Second gamepad") && comboRows.join() === "Down+B | C",
    `player 2: ${player2Rows.join("; ")}; combos: ${comboRows.join("; ")}`,
  );

  checkPads("C holds Down and B on pad 1", await padsAfter(page, () => page.keyboard.down("KeyC")), bits("Down", "B"), 0);
  await shot(page, "holding-c.png", "C held: the game reads Down+B on pad 1; the panel lists player 2's keys and the combo");
  checkPads("letting go of C lets go of both", await padsAfter(page, () => page.keyboard.up("KeyC")), 0, 0);
  checkPads("S holds Down", await padsAfter(page, () => page.keyboard.down("KeyS")), bits("Down"), 0);
  checkPads("C with S held adds B", await padsAfter(page, () => page.keyboard.down("KeyC")), bits("Down", "B"), 0);
  checkPads("letting go of C keeps Down, which S still holds", await padsAfter(page, () => page.keyboard.up("KeyC")), bits("Down"), 0);
  checkPads("letting go of S lets go of Down", await padsAfter(page, () => page.keyboard.up("KeyS")), 0, 0);

  checkPads("M holds A on pad 2", await padsAfter(page, () => page.keyboard.down("KeyM")), 0, bits("A"));
  checkPads("N adds B on pad 2, X holds A on pad 1", await padsAfter(page, async () => {
    await page.keyboard.down("KeyN");
    await page.keyboard.down("KeyX");
  }), bits("A"), bits("A", "B"));
  await shot(page, "holding-m-n-x.png", "M, N and X held: pad 2 reads A+B, pad 1 reads A");
  checkPads("letting go of M, N and X lets go of all", await padsAfter(page, async () => {
    await page.keyboard.up("KeyM");
    await page.keyboard.up("KeyN");
    await page.keyboard.up("KeyX");
  }), 0, 0);

  // The bindings survive a reload.
  await page.reload({ waitUntil: "load" });
  await waitFor(page, "the game to run again", () => window.__retrowright?.game === "read-pads.nes" && window.__retrowright.framesRun > 30);
  await picture();
  checkPads("after a reload, C still holds Down and B, and M still holds pad 2's A", await padsAfter(page, async () => {
    await page.keyboard.down("KeyC");
    await page.keyboard.down("KeyM");
  }), bits("Down", "B"), bits("A"));
  await page.keyboard.up("KeyC");
  await page.keyboard.up("KeyM");
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
  `<!doctype html><meta charset="utf-8"><title>retrowright: combo keys and player 2's keys</title>
<style>body{font-family:system-ui,sans-serif;max-width:1400px;margin:1rem auto;padding:0 1rem}figure{display:inline-block;margin:.5rem;vertical-align:top;max-width:640px}figure img{max-width:100%;border:1px solid #ccc}td{padding:.2rem .5rem;vertical-align:top}code{font-size:.8em;word-break:break-all}</style>
<h1>Combo keys and player 2's keys (development server, headless Firefox, a ROM reading both pads)</h1>
<p>${escape(new Date().toString())} · ${failing} failing</p>
<table>${checks.map((item) => `<tr><td>${item.ok ? "✅" : "❌"}</td><td>${escape(item.name)}</td><td><code>${escape(item.detail)}</code></td></tr>`).join("\n")}</table>
<h2>Screenshots</h2>${shots.map((item) => `<figure><img src="${item.file}" alt="${escape(item.caption)}"><figcaption>${escape(item.caption)}</figcaption></figure>`).join("\n")}
`,
);
console.log(`${checks.length} checks, ${failing} failing${finished ? "" : ", the run did not finish"}; report in ${OUT}`);
process.exit(failing === 0 && finished ? 0 : 1);
