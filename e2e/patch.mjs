// Browser check of patches in the library, in headless Firefox with the page
// opened with ?debug. Synthetic ROMs built in code stand for a game and its
// hack: the source paints the backdrop red, the BPS target paints it green
// and the IPS result paints it blue, so each shows in its screenshot.
//
// 1. `npm run patch -- create` makes red-to-green.bps from source to target,
//    and wrong.bps from another ROM to the target.
// 2. If Flips is installed, it applies red-to-green.bps too and must give the
//    same bytes; if not, the results say so.
// 3. The source is added in the page. Apply patch… on its card applies
//    red-to-green.bps: a new card keyed by the target's SHA-256 appears, it
//    plays and shows green, and the original card is as it was and still
//    plays red. An IPS applies the same way. wrong.bps is refused with the
//    CRC32 it expects and adds nothing.
//
// The ROMs, patches, screenshots, results.json and an index.html go to
// .out/page/patch/, or the directory given.
//
// Usage: npm run build && npm run e2e:patch [-- output-dir]
// Not part of `npm test`: it needs Firefox.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import puppeteer from "puppeteer-core";
import { buildInes, PAINT_BACKDROP_PROGRAM } from "../src/test/syntheticRom.ts";
import { startStaticServer } from "./staticServer.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "patch"));
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";
/** Where PAINT_BACKDROP_PROGRAM's LDA #$16 operand sits in the file: the 16-byte header, then byte 11 of the program. */
const COLOUR_OFFSET = 16 + 11;
const GREEN = 0x2a;
const BLUE = 0x12;

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/index.html is missing: run `npm run build` first.");
  process.exit(1);
}

const checks = [];
const notes = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}
function note(text) {
  notes.push(text);
  console.log(`NOTE ${text}`);
}

const screenshots = [];
async function shot(page, file, caption) {
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  screenshots.push({ file, caption });
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hex8 = (value) => value.toString(16).toUpperCase().padStart(8, "0");
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

const noticeIncludes = (page, text) =>
  waitFor(page, `the notice "${text}"`, (wanted) => [...document.querySelectorAll(".notice")].map((node) => node.textContent).find((shown) => shown.includes(wanted)) ?? null, text);

const cardIds = (page) => page.$$eval("[data-card]", (cards) => cards.map((card) => card.dataset.card));
const cardTitle = (page, id) => page.$eval(`[data-card="${id}"] .card-title`, (node) => node.textContent);

/** Runs a command from the project root and gives its exit status and output. */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(), missing: result.error?.code === "ENOENT" };
}

/** Plays a card's game from power-on and gives its library key and the picture's hash once it has run. */
async function playCard(page, id, screenshot, caption) {
  await page.click(`[data-card="${id}"] .card-open`);
  // A game played before has a resume state, and its card asks where to start.
  const asked = await waitFor(page, "the game or the start choice", (wanted) => (window.__retrowright?.romId === wanted ? "running" : document.querySelector("[data-item=power-on]") ? "asked" : null), id);
  if (asked === "asked") await page.click("[data-item=power-on]");
  await waitFor(page, "the game to run", (wanted) => window.__retrowright?.romId === wanted && window.__retrowright.framesRun > 30, id);
  const played = { romId: await page.evaluate(() => window.__retrowright.romId), screenHash: await page.evaluate(() => window.__retrowright.screenHash()) };
  await shot(page, screenshot, caption);
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-item=quit]");
  await page.click("[data-item=quit]");
  await page.waitForSelector(".continue-button");
  return played;
}

async function applyPatchFile(page, id, path) {
  await page.click(`[data-card="${id}"] .card-more`);
  await page.waitForSelector("#patch-input");
  await (await page.$("#patch-input")).uploadFile(path);
}

await mkdir(OUT, { recursive: true });

// The ROMs and patches.
const source = buildInes({ program: PAINT_BACKDROP_PROGRAM });
const target = source.slice();
target[COLOUR_OFFSET] = GREEN;
const other = buildInes({ program: PAINT_BACKDROP_PROGRAM, prgBanks: 2 });
const ipsResult = source.slice();
ipsResult[COLOUR_OFFSET] = BLUE;
// One record: offset (3 bytes), length (2 bytes), the byte; then EOF.
const ips = Uint8Array.from([..."PATCH"].map((char) => char.charCodeAt(0)).concat([0, 0, COLOUR_OFFSET, 0, 1, BLUE], [0x45, 0x4f, 0x46]));
const files = {
  source: join(OUT, "Backdrop Test (World).nes"),
  target: join(OUT, "target.nes"),
  other: join(OUT, "other.nes"),
  bps: join(OUT, "red-to-green.bps"),
  wrong: join(OUT, "wrong.bps"),
  ips: join(OUT, "red-to-blue.ips"),
  flipsOut: join(OUT, "flips-applied.nes"),
};
await writeFile(files.source, source);
await writeFile(files.target, target);
await writeFile(files.other, other);
await writeFile(files.ips, ips);
const ids = { source: sha256(source), target: sha256(target), ips: sha256(ipsResult) };

let exitCode = 0;
let server = null;
try {
  const created = run("npm", ["run", "--silent", "patch", "--", "create", files.source, files.target, files.bps, "--metadata", "Backdrop red to green"]);
  check("npm run patch -- create makes a BPS from the two synthetic ROMs", created.status === 0 && existsSync(files.bps), created.output);
  const wrong = run("npm", ["run", "--silent", "patch", "--", "create", files.other, files.target, files.wrong]);
  check("npm run patch -- create makes a BPS from another ROM", wrong.status === 0, wrong.output);
  const refusedInNode = run("npm", ["run", "--silent", "patch", "--", "apply", files.source, files.wrong, join(OUT, "never.nes")]);
  check("npm run patch -- apply refuses that BPS for the source, naming the CRC32 it expects", refusedInNode.status === 1 && refusedInNode.output.includes(`CRC32 ${hex8(crc32(other))}`), refusedInNode.output);

  const flips = run("flips", ["--apply", files.bps, files.source, files.flipsOut]);
  if (flips.missing) {
    note("Flips is not installed (no flips on PATH), so the cross-check with Flips did not run.");
  } else {
    const flipsSha = existsSync(files.flipsOut) ? sha256(await readFile(files.flipsOut)) : null;
    check("Flips applies the harness's BPS to the source and gives the target's SHA-256", flips.status === 0 && flipsSha === ids.target, { output: flips.output, flipsSha, target: ids.target });
  }

  server = await startStaticServer({ root: DIST, subPath: "/", ports: [0] });
  const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.log(`pageerror: ${error.message}`));
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:${server.port}/?debug`, { waitUntil: "load" });
    await waitFor(page, "the player", () => window.__retrowright !== undefined);

    // The original, added as a file: one new file starts at once.
    await (await page.$("#rom-input")).uploadFile(files.source);
    await waitFor(page, "the source to run", () => window.__retrowright.framesRun > 30);
    const firstPlay = { romId: await page.evaluate(() => window.__retrowright.romId), screenHash: await page.evaluate(() => window.__retrowright.screenHash()) };
    await shot(page, "01-original-playing.png", "The original (source) ROM playing: red backdrop");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-item=quit]");
    await page.click("[data-item=quit]");
    await page.waitForSelector(".continue-button");
    check("the original is in the library under its SHA-256", (await cardIds(page)).includes(ids.source), await cardIds(page));
    const originalTitle = await cardTitle(page, ids.source);

    // The BPS made by the harness.
    await page.click(`[data-card="${ids.source}"] .card-more`);
    await page.waitForSelector("[data-item=apply-patch]");
    // The dialog fades in.
    await sleep(400);
    await shot(page, "02-game-dialog.png", "The original's dialog, with Apply patch…");
    await (await page.$("#patch-input")).uploadFile(files.bps);
    const added = await noticeIncludes(page, "Patched with red-to-green.bps");
    await waitFor(page, "the patched card", (id) => document.querySelector(`[data-card="${id}"]`) !== null, ids.target);
    check("the BPS applies in the page: a new card keyed by the target's SHA-256", (await cardIds(page)).includes(ids.target), { notice: added, cards: await cardIds(page), target: ids.target });
    const patchedTitle = await cardTitle(page, ids.target);
    check("the patched card is named after the original and the patch", patchedTitle === "Backdrop Test + red-to-green", patchedTitle);
    await shot(page, "03-library-with-patched.png", "The library after applying red-to-green.bps: the original and the new patched entry");

    const patchedPlay = await playCard(page, ids.target, "04-patched-playing.png", "The patched entry playing: green backdrop");
    check("the patched game plays, and the page's ROM is the target", patchedPlay.romId === ids.target, patchedPlay);
    check("the patched game's picture differs from the original's", patchedPlay.screenHash !== firstPlay.screenHash, { patched: patchedPlay.screenHash, original: firstPlay.screenHash });

    await page.click(`[data-card="${ids.target}"] .card-more`);
    const origin = await page.waitForSelector(".patched-from").then((node) => node.evaluate((element) => element.textContent));
    check("the patched entry's dialog names the ROM and patch it came from", origin === `Made from ${originalTitle} with the patch red-to-green.bps.`, origin);
    await sleep(400);
    await shot(page, "05-patched-origin.png", "The patched entry's dialog: where it came from");
    await page.click(".library-dialog [data-item=cancel]");

    // An IPS.
    await applyPatchFile(page, ids.source, files.ips);
    await noticeIncludes(page, "Patched with red-to-blue.ips");
    await waitFor(page, "the IPS card", (id) => document.querySelector(`[data-card="${id}"]`) !== null, ids.ips);
    const ipsPlay = await playCard(page, ids.ips, "06-ips-playing.png", "The IPS-patched entry playing: blue backdrop");
    check("an IPS applies too: its card has the expected SHA-256 and plays", ipsPlay.romId === ids.ips, ipsPlay);

    // A BPS made for another ROM.
    const before = await cardIds(page);
    await applyPatchFile(page, ids.source, files.wrong);
    const refused = await noticeIncludes(page, "could not be applied");
    const expectedCrc = hex8(crc32(other));
    check("a BPS for another ROM is refused with the CRC32 it expects", refused.includes(`This patch is for a ROM with CRC32 ${expectedCrc}`), refused);
    check("the refused patch adds nothing", JSON.stringify((await cardIds(page)).sort()) === JSON.stringify([...before].sort()), await cardIds(page));
    const alertText = await page.$eval("[role=alert]", (node) => node.textContent);
    check("the refusal is announced as an alert naming the CRC32 it expects", alertText.includes(`This patch is for a ROM with CRC32 ${expectedCrc}`), alertText);
    await shot(page, "07-wrong-rom-refused.png", "wrong.bps on the original: refused, naming the CRC32 it expects");

    // The original, as it was.
    check("the original keeps its title", (await cardTitle(page, ids.source)) === originalTitle, await cardTitle(page, ids.source));
    const againPlay = await playCard(page, ids.source, "08-original-again.png", "The original after all three patches: unchanged, red backdrop");
    check("the original still plays its own ROM, with the same picture", againPlay.romId === ids.source && againPlay.screenHash === firstPlay.screenHash, { again: againPlay, first: firstPlay });
  } finally {
    await browser.close();
  }
} catch (error) {
  exitCode = 1;
  check("the run finished", false, String(error?.stack ?? error));
} finally {
  await server?.stop();
}

const failed = checks.filter((item) => !item.ok).length;
await writeFile(join(OUT, "results.json"), JSON.stringify({ when: new Date().toString(), ids, checks, notes, screenshots }, null, 2));
const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
await writeFile(
  join(OUT, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Patches in the library</title>
<style>body{font:15px system-ui;margin:2rem;max-width:70rem} img{max-width:100%;border:1px solid #888} li{margin:.2rem 0} .fail{color:#b00}</style>
<h1>Patches in the library (e2e/patch.mjs)</h1>
<p>${checks.length - failed} passed, ${failed} failed. ${escape(new Date().toString())}</p>
<ul>${checks.map((item) => `<li class="${item.ok ? "" : "fail"}">${item.ok ? "PASS" : "FAIL"} ${escape(item.name)}</li>`).join("")}</ul>
${notes.map((text) => `<p><strong>Note:</strong> ${escape(text)}</p>`).join("")}
${screenshots.map((item) => `<h2>${escape(item.caption)}</h2><img src="${item.file}" alt="${escape(item.caption)}">`).join("\n")}
`,
);
console.log(`${checks.length - failed} passed, ${failed} failed.`);
process.exit(exitCode || (failed > 0 ? 1 : 0));
