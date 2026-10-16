// Browser check of the Tune panel, in headless Firefox with the page opened
// with ?debug, on a synthetic ROM and a synthetic tunables file, so it needs
// no game. The ROM paints the backdrop with the byte at $8200, so a tuned
// byte shows in the picture as soon as it is written.
//
// 1. The ROM is added to the library. Its menu offers no Tune…, F3 opens
//    nothing, and the menu offers Load tunables… instead; a tunables file for
//    another ROM is refused with a notice naming it.
// 2. The ROM's own tunables file, picked in Load tunables…, opens the Tune
//    panel with focus on its first value; the menu then offers Tune… (F3),
//    and F3 opens it too. It shows each value with its name and sentence (a
//    list for the value with choices) beside the picture, overlapping it at
//    none of three window sizes and inside the window, its list scrolling
//    (30 spare values make it as long as a real game's), each screenshotted.
// 3. Moving the colour slider writes the byte into the running game's ROM
//    ($8200 read through the debug handle) and the picture's colour.
// 4. After a reload, the file is still known for the game (kept in the
//    browser) and the tuned value with it.
// 5. Save as new version… adds a tuned card and downloads its .bps, which
//    `npm run patch -- apply` applies to the ROM to the same SHA-256.
//
// Screenshots, results.json and an index.html go to .out/page/tune/, or the
// directory given. The ROM and files stay in a temporary folder, removed after.
//
// Usage: npm run build && npm run e2e:tune [-- output-dir]
// Not part of `npm test`: it needs Firefox.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { buildInes } from "../src/test/syntheticRom.ts";
import { startStaticServer } from "./staticServer.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "tune"));
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/index.html is missing: run `npm run build` first.");
  process.exit(1);
}

/** LDA #$3F / STA $2006 / LDA #$00 / STA $2006 / LDA $8200 / STA $2007 / JMP $8000: the backdrop is the byte at $8200. */
const SHOW_TUNED_BYTE_PROGRAM = [0xa9, 0x3f, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20, 0xad, 0x00, 0x82, 0x8d, 0x07, 0x20, 0x4c, 0x00, 0x80];
const COLOUR_OFFSET = 16 + 0x200;
const rom = buildInes({ program: SHOW_TUNED_BYTE_PROGRAM });
rom[COLOUR_OFFSET] = 0x16;
rom[COLOUR_OFFSET + 1] = 1;

/** Values the program never reads, enough that the panel's list scrolls at every window size checked. */
const FILLER_VALUES = 30;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const tunablesFor = (romSha256) => ({
  format: "retrowright-tunables",
  version: 1,
  romSha256,
  patch: "backdrop.bps",
  values: [
    { key: "colour", name: "Backdrop colour", description: "The NES colour the picture is painted with.", romOffset: COLOUR_OFFSET, cpuAddress: 0x8200, min: 0, max: 0x3f, default: 0x16 },
    { key: "style", name: "Style", description: "A byte that picks one of two ways.", romOffset: COLOUR_OFFSET + 1, cpuAddress: 0x8201, min: 0, max: 1, default: 1, choices: ["Plain", "Striped"] },
    ...Array.from({ length: FILLER_VALUES }, (_, index) => ({
      key: `spare${index + 1}`,
      name: `Spare byte ${index + 1}`,
      description: "A byte the program does not read, so the list is as long as a real game's.",
      romOffset: COLOUR_OFFSET + 2 + index,
      cpuAddress: 0x8202 + index,
      min: 0,
      max: 255,
      default: 0,
    })),
  ],
});

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

const screenshots = [];
async function shot(page, file, caption) {
  await page.screenshot({ path: join(OUT, file) });
  screenshots.push({ file, caption });
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

const cardIds = (page) => page.$$eval("[data-card]", (cards) => cards.map((card) => card.dataset.card));
const menuItems = (page) => page.$$eval("[data-item]", (items) => items.map((item) => item.dataset.item));
const noticeText = (page) => page.evaluate(() => document.querySelector(".notices")?.textContent ?? "");

/** The window sizes the Tune panel is screenshotted at beside the picture. */
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1100, height: 800 },
];

/** The picture's and the Tune panel's boxes, and the area they share. */
const tuneBoxes = (page) =>
  page.evaluate(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null;
    };
    const picture = rect("canvas.screen");
    const panel = rect(".tune-panel");
    const overlap = picture && panel ? Math.max(0, Math.min(picture.right, panel.right) - Math.max(picture.left, panel.left)) * Math.max(0, Math.min(picture.bottom, panel.bottom) - Math.max(picture.top, panel.top)) : null;
    const list = document.querySelector(".tune-list");
    return { picture, panel, overlap, listScrolls: list ? list.scrollHeight > list.clientHeight : null };
  });

/** The colour of the picture's middle pixel, as the canvas shows it. */
const middlePixel = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector("canvas.screen");
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext("2d");
    context.drawImage(canvas, 0, 0);
    return [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data.slice(0, 3)];
  });

/** Moves a Tune slider to `value` with its arrow keys, and gives the value it shows. */
async function setSlider(page, key, value) {
  const current = Number(await page.$eval(`[data-tune=${key}]`, (input) => input.value));
  await page.focus(`[data-tune=${key}]`);
  for (let step = 0; step < Math.abs(value - current); step++) await page.keyboard.press(value > current ? "ArrowRight" : "ArrowLeft");
  return page.$eval(`[data-tune-value=${key}]`, (node) => Number(node.textContent));
}

async function openMenu(page) {
  await page.focus("canvas.screen");
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-item=quit]");
}

await mkdir(OUT, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), "retrowright-tune-"));
const romId = sha256(rom);
const files = {
  rom: join(scratch, "Backdrop (Synthetic).nes"),
  tunables: join(scratch, "Backdrop (Synthetic).tunables.json"),
  otherTunables: join(scratch, "other.tunables.json"),
  tunedBps: join(scratch, "tuned.bps"),
  tunedOut: join(scratch, "tuned.nes"),
};
await writeFile(files.rom, rom);
await writeFile(files.tunables, JSON.stringify(tunablesFor(romId), null, 2));
await writeFile(files.otherTunables, JSON.stringify(tunablesFor("0".repeat(64)), null, 2));

let exitCode = 0;
let server = null;
try {
  server = await startStaticServer({ root: DIST, subPath: "/", ports: [0] });
  const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.log(`pageerror: ${error.message}`));
    await page.setViewport({ width: 1280, height: 900 });
    const origin = `http://127.0.0.1:${server.port}`;
    await page.goto(`${origin}/?debug`, { waitUntil: "load" });
    await waitFor(page, "the player", () => window.__retrowright !== undefined);

    // 1. No tunables known: no Tune…, F3 nothing, Load tunables… offered; another ROM's file refused.
    await (await page.$("#rom-input")).uploadFile(files.rom);
    await waitFor(page, "the ROM to run", (id) => window.__retrowright.romId === id && window.__retrowright.framesRun > 30, romId);
    await page.focus("canvas.screen");
    await page.keyboard.press("F3");
    await sleep(200);
    check("F3 opens nothing for a game with no tunables file", (await page.$(".tune-panel")) === null);
    await openMenu(page);
    const plainMenu = await menuItems(page);
    check("the menu offers Load tunables… and no Tune… for a game with no tunables file", plainMenu.includes("load-tunables") && !plainMenu.includes("tune"), plainMenu);
    await (await page.$("#game-file-input")).uploadFile(files.otherTunables);
    await waitFor(page, "the refusal", () => document.querySelector(".notices")?.textContent?.includes("other.tunables.json is for another ROM"));
    check("a tunables file for another ROM is refused with a notice naming it, and no Tune panel opens", (await page.$(".tune-panel")) === null, await noticeText(page));

    // 2. The ROM's own file.
    await openMenu(page);
    await (await page.$("#game-file-input")).uploadFile(files.tunables);
    await page.waitForSelector(".tune-panel");
    const loaded = await page.evaluate(() => ({ menu: document.querySelector("[role=dialog]") !== null, focus: document.activeElement?.dataset.tune ?? null }));
    check("the ROM's own tunables file, picked in Load tunables…, opens the Tune panel with focus on its first value", !loaded.menu && loaded.focus === "colour", loaded);
    await page.keyboard.press("Escape");
    await waitFor(page, "the Tune panel to close", () => document.querySelector(".tune-panel") === null);
    await openMenu(page);
    const tuneItem = await page.$eval("[data-item=tune]", (item) => item.textContent);
    check("the menu then offers Tune… with F3, and no Load tunables…", tuneItem.includes("Tune…") && tuneItem.includes("F3") && !(await menuItems(page)).includes("load-tunables"), tuneItem);
    await page.keyboard.press("Escape");
    await page.focus("canvas.screen");
    await page.keyboard.press("F3");
    await page.waitForSelector(".tune-panel");
    const shown = await page.$$eval(".tune-list li", (items) =>
      items.map((item) => ({ key: item.querySelector("[data-tune]").dataset.tune, tag: item.querySelector("[data-tune]").tagName, name: item.querySelector("label").textContent, description: item.querySelector(".hint").textContent })),
    );
    const expected = tunablesFor(romId).values;
    check(
      "F3 opens the Tune panel, which shows each value with its name and sentence, the one with choices as a list",
      shown.length === expected.length && expected.every((value, index) => shown[index].key === value.key && shown[index].name === value.name && shown[index].description.startsWith(value.description)) && shown[1].tag === "SELECT",
      shown,
    );
    check("the Tune panel has Load tunables… beside Reset and Save as new version…", (await page.$$eval(".tune-actions button", (buttons) => buttons.map((button) => button.textContent))).join("|") === "Reset|Save as new version…|Load tunables…");
    // The notices above the page (the refusal among them) are dismissed, so the panel is measured as a game shows it.
    await page.$$eval(".notices button[aria-label=Dismiss]", (buttons) => buttons.forEach((button) => button.click()));
    await waitFor(page, "the notices to go", () => document.querySelectorAll(".notices button[aria-label=Dismiss]").length === 0);
    for (const [index, size] of SIZES.entries()) {
      await page.setViewport(size);
      await sleep(300);
      const measured = await tuneBoxes(page);
      check(
        `at ${size.width}×${size.height} the Tune panel sits beside the picture without overlapping it, inside the window, its list scrolling`,
        measured.overlap === 0 && measured.panel.left >= measured.picture.right && measured.panel.bottom <= size.height && measured.listScrolls,
        measured,
      );
      await shot(page, `01-tune-panel-${index + 1}-${size.width}x${size.height}.png`, `The Tune panel beside the synthetic ROM at ${size.width}×${size.height}, at the defaults (backdrop $16)`);
    }
    await page.setViewport({ width: 1280, height: 900 });
    await sleep(300);

    // 3. The colour slider writes the ROM byte the game reads.
    const before = await middlePixel(page);
    check("colour slider moves to $2A", (await setSlider(page, "colour", 0x2a)) === 0x2a);
    await waitFor(page, "the byte in the running game", () => window.__retrowright.peek(0x8200) === 0x2a);
    await sleep(200);
    const after = await middlePixel(page);
    check("the running game reads the tuned byte at $8200, and the picture changes colour", JSON.stringify(before) !== JSON.stringify(after), { before, after });
    await shot(page, "02-colour-tuned.png", "The colour tuned to $2A: the backdrop the ROM paints from $8200");

    // 4. A reload keeps the file and the value.
    await page.goto(`${origin}/?debug`, { waitUntil: "load" });
    await waitFor(page, "the library", () => document.querySelector(".continue-button") !== null);
    await page.click(".continue-button");
    await waitFor(page, "the game to run again", (id) => window.__retrowright?.romId === id && window.__retrowright.framesRun > 30, romId);
    await waitFor(page, "the tuned byte again", () => window.__retrowright.peek(0x8200) === 0x2a);
    await openMenu(page);
    check("after a reload the tunables file is still known for the game, its tuned value written in", (await menuItems(page)).includes("tune"));
    await page.click("[data-item=tune]");
    await page.waitForSelector(".tune-panel");

    // 5. Save as new version.
    await page.evaluate(() => {
      window.__downloads = [];
      HTMLAnchorElement.prototype.click = function () {
        window.__downloads.push({ href: this.href, name: this.download });
      };
    });
    await page.click("[data-tool=tune-save]");
    await waitFor(page, "the two downloads", () => window.__downloads.length === 2);
    const downloads = await page.evaluate(async () =>
      Promise.all(
        window.__downloads.map(async (download) => {
          const bytes = new Uint8Array(await (await fetch(download.href)).arrayBuffer());
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return { name: download.name, base64: btoa(binary) };
        }),
      ),
    );
    const bpsDownload = downloads.find((download) => download.name.endsWith(".bps"));
    const jsonDownload = downloads.find((download) => download.name.endsWith(".json"));
    check("Save as new version… downloads a .bps and a .json", bpsDownload && jsonDownload, downloads.map((download) => download.name));
    const saved = JSON.parse(Buffer.from(jsonDownload.base64, "base64").toString("utf8"));
    await writeFile(files.tunedBps, Buffer.from(bpsDownload.base64, "base64"));
    const applied = spawnSync("npm", ["run", "--silent", "patch", "--", "apply", files.rom, files.tunedBps, files.tunedOut], { cwd: ROOT, encoding: "utf8" });
    const tuned = existsSync(files.tunedOut) ? await readFile(files.tunedOut) : null;
    check("npm run patch -- apply gives the saved version's SHA-256 from the downloaded .bps, with the tuned byte", applied.status === 0 && tuned && sha256(tuned) === saved.tunedSha256 && tuned[COLOUR_OFFSET] === 0x2a, {
      output: `${applied.stdout}${applied.stderr}`.trim(),
      saved: saved.tunedSha256,
    });
    await page.focus("canvas.screen");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-item=quit]");
    await page.click("[data-item=quit]");
    await page.waitForSelector(".continue-button");
    check("the saved version is in the library under that SHA-256", (await cardIds(page)).includes(saved.tunedSha256), await cardIds(page));
    await shot(page, "03-library-with-tuned.png", "The library with the synthetic ROM and its tuned version");
  } finally {
    await browser.close();
  }
} catch (error) {
  exitCode = 1;
  check("the run finished", false, String(error?.stack ?? error));
} finally {
  await server?.stop();
  await rm(scratch, { recursive: true, force: true });
}

const failed = checks.filter((item) => !item.ok).length;
await writeFile(join(OUT, "results.json"), JSON.stringify({ when: new Date().toString(), romId, checks, screenshots }, null, 2));
const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
await writeFile(
  join(OUT, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Tune panel on a synthetic ROM</title>
<style>body{font:15px system-ui;margin:2rem;max-width:70rem} img{max-width:100%;border:1px solid #888} li{margin:.2rem 0} .fail{color:#b00}</style>
<h1>Tune panel on a synthetic ROM (e2e/tune.mjs)</h1>
<p>${checks.length - failed} passed, ${failed} failed. ${escape(new Date().toString())}</p>
<ul>${checks.map((item) => `<li class="${item.ok ? "" : "fail"}">${item.ok ? "PASS" : "FAIL"} ${escape(item.name)}${item.detail === undefined ? "" : ` <code>${escape(JSON.stringify(item.detail))}</code>`}</li>`).join("")}</ul>
${screenshots.map((item) => `<h2>${escape(item.caption)}</h2><img src="${item.file}" alt="${escape(item.caption)}">`).join("\n")}
`,
);
console.log(`${checks.length - failed} passed, ${failed} failed.`);
process.exit(exitCode || (failed > 0 ? 1 : 0));
