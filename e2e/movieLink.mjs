// The movie link in headless Firefox (puppeteer-core over WebDriver BiDi), on
// the development server, which alone serves test links. Writes a synthetic
// ROM whose backdrop is green while A is held and red otherwise, and a
// synthetic movie that holds A from frame 60, to <out>/roms; replays the movie
// in Node first to put the expected screen hashes into its checkpoints, then
// starts `vite` with RETROWRIGHT_TEST_ROMS pointing there and checks:
// ?play=…&movie=… plays the movie from power-on with the frame count shown,
// Esc pauses it and Esc again resumes it, it runs to its last frame with the
// final screen hash Node gave, and a movie of another ROM gets the player's
// mismatch message.
//
// Usage: npm run e2e:movie-link [-- output-dir]
// Not part of `npm test`: it needs Firefox.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import { JsnesCore } from "../src/core/jsnesCore.ts";
import { sha256Hex } from "../src/storage/gameStore.ts";
import { buildInes, PAINT_BACKDROP_PROGRAM } from "../src/test/syntheticRom.ts";
import { replay } from "../harness/replay.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "movie-link"));
const ROMS = join(OUT, "roms");
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";
const WIDE = { width: 1280, height: 900 };
const FRAMES = 300;
const PRESS_A = 60;

/**
 * Reads pad 1 and paints the backdrop $2A (green) while A is held, $16 (red) otherwise:
 * loop: strobe $4016 / LDA $4016 / AND #1 / BEQ red / LDA #$2A / BNE paint / red: LDA #$16 /
 * paint: TAX / $3F00 into $2006 / STX $2007 / JMP loop
 */
const BACKDROP_FROM_A = [
  0xa9, 0x01, 0x8d, 0x16, 0x40, 0xa9, 0x00, 0x8d, 0x16, 0x40, // strobe
  0xad, 0x16, 0x40, 0x29, 0x01, // LDA $4016 / AND #1
  0xf0, 0x04, 0xa9, 0x2a, 0xd0, 0x02, 0xa9, 0x16, // BEQ red / LDA #$2A / BNE paint / red: LDA #$16
  0xaa, // paint: TAX
  0xa9, 0x3f, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20, // $3F00
  0x8e, 0x07, 0x20, // STX $2007
  0x4c, 0x00, 0x80, // JMP loop
];

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

function escape(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

/** A power-on movie of `rom` holding A from PRESS_A to the end, with the screen hashes `hashes` gives at frame 30 and the last. */
function movieOf(name, sha256, hashes) {
  return {
    format: "retrowright-movie",
    version: 1,
    rom: { name, sha256 },
    core: { name: "jsnes", version: "2.1.0" },
    start: { kind: "power-on", batteryRam: null },
    frames: FRAMES,
    inputs: [{ frame: PRESS_A, pad1: 1, pad2: 0 }],
    events: [],
    checkpoints: hashes
      ? [
          { frame: 30, name: "before A", expect: { screenHash: hashes[29] } },
          { frame: FRAMES, name: "the last frame", expect: { screenHash: hashes[FRAMES - 1] } },
        ]
      : [],
  };
}

await mkdir(ROMS, { recursive: true });
const rom = buildInes({ program: BACKDROP_FROM_A });
const other = buildInes({ program: PAINT_BACKDROP_PROGRAM });
const romSha = await sha256Hex(rom);
// Node's replay gives the hash of every frame; the movie's checkpoints carry two of them.
const nodeRun = await replay({ createCore: (callbacks) => new JsnesCore(callbacks), rom, movie: movieOf("Pad.nes", romSha, null), gameMap: null, frameHashes: true });
const movie = movieOf("Pad.nes", romSha, nodeRun.frameHashes);
const finalHash = nodeRun.frameHashes[FRAMES - 1];
check("in Node, holding A changes the picture", nodeRun.frameHashes[29] !== finalHash, `frame 30 ${nodeRun.frameHashes[29]}, frame ${FRAMES} ${finalHash}`);
await writeFile(join(ROMS, "Pad.nes"), rom);
await writeFile(join(ROMS, "Other.nes"), other);
await writeFile(join(ROMS, "Pad run.rwmovie.json"), `${JSON.stringify(movie, null, 2)}\n`);
process.env.RETROWRIGHT_TEST_ROMS = ROMS;

const vite = await createServer({ configFile: join(ROOT, "vite.config.ts"), root: ROOT, logLevel: "error", server: { host: "127.0.0.1", port: 5191 } });
await vite.listen();
const origin = new URL(vite.resolvedUrls.local[0]).origin;
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
let finished = false;
try {
  const page = await browser.newPage();
  await page.setViewport(WIDE);
  const link = `?play=local-roms/Pad.nes&movie=local-movies/${encodeURIComponent("Pad run.rwmovie.json")}&label=${encodeURIComponent(`Pad, ${FRAMES} frames`)}`;
  await page.goto(`${origin}/${link}`, { waitUntil: "load" });
  await waitFor(page, "the movie to play", () => window.__retrowright?.movieStatus().mode === "playing");
  const indicator = await waitFor(page, "the frame count", () => {
    const text = document.querySelector(".play-indicator")?.textContent ?? "";
    return /movie frame [1-9]\d* \/ 300$/.test(text) && text;
  });
  check("the link opens the ROM and plays the movie, its frame count under the picture", (await page.evaluate(() => window.__retrowright.game)) === "Pad.nes", indicator);
  check("the label shows in the banner", (await page.evaluate(() => document.querySelector(".test-label")?.textContent)) === `Pad, ${FRAMES} frames`);
  await shot(page, "playing.png", `${link}: playing, frame count under the picture`);

  // Esc pauses the movie with the game; Esc again resumes it.
  await page.focus("canvas.screen");
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-item=resume]");
  const pausedAt = await page.evaluate(() => window.__retrowright.movieStatus().frame);
  await sleep(500);
  const stillAt = await page.evaluate(() => window.__retrowright.movieStatus().frame);
  check("Esc pauses the movie", pausedAt === stillAt && pausedAt < FRAMES, `frame ${pausedAt}, after 0.5 s ${stillAt}`);
  await shot(page, "paused.png", "Esc during the movie: the menu, the movie paused");
  await page.keyboard.press("Escape");
  await waitFor(page, "the movie to go on", (frame) => window.__retrowright.movieStatus().frame > frame, pausedAt);
  check("Esc again resumes it", true);
  await waitFor(page, "a frame with A held", (from) => window.__retrowright.movieStatus().frame > from, PRESS_A + 30);
  await shot(page, "a-held.png", `Past frame ${PRESS_A}: the movie holds A and the backdrop turns green`);

  const status = await waitFor(page, "the movie's end", () => {
    const now = window.__retrowright.movieStatus();
    return now.finished && now;
  });
  const last = status.results.find((result) => result.name === "the last frame");
  check(
    `the movie runs to its end and frame ${FRAMES}'s screen hash is Node's`,
    status.results.length === 2 && status.results.every((result) => result.passed) && last?.frame === FRAMES,
    JSON.stringify(status.results),
  );
  const notice = await waitFor(page, "the finished notice", () => document.querySelector(".notices")?.textContent.includes("Movie finished") && document.querySelector(".notices").textContent);
  check("the page reports the checkpoints when the movie ends", notice.includes("Movie finished: 2 checkpoint(s) passed."), notice.trim());
  await waitFor(page, "the red picture once the movie lets go of A", (red) => window.__retrowright.screenHash() === red, nodeRun.frameHashes[29], 3000);
  check("the movie lets go of A when it ends: the picture is red again", true);
  await shot(page, "finished.png", "The movie's end: the notice reports its checkpoints");

  // A movie of another ROM.
  const mismatch = await browser.newPage();
  await mismatch.setViewport(WIDE);
  await mismatch.goto(`${origin}/?play=local-roms/Other.nes&movie=${encodeURIComponent("local-movies/Pad run.rwmovie.json")}&label=Other`, { waitUntil: "load" });
  const alert = await waitFor(mismatch, "the mismatch notice", () => document.querySelector("[role=alert]")?.textContent.includes("could not be played") && document.querySelector("[role=alert]").textContent);
  const otherSha = await sha256Hex(other);
  check(
    "a movie of another ROM gets the player's mismatch message, and the game runs without it",
    alert.includes(`Pad run.rwmovie.json could not be played: This movie was recorded on Pad.nes (SHA-256 ${romSha.slice(0, 12)}…), not this ROM (${otherSha.slice(0, 12)}…).`) &&
      (await mismatch.evaluate(() => window.__retrowright.game === "Other.nes" && window.__retrowright.movieStatus().mode === "idle")),
    alert.trim(),
  );
  await shot(mismatch, "mismatch.png", "A movie of another ROM: the player's message");
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
  `<!doctype html><meta charset="utf-8"><title>retrowright: the movie link</title>
<style>body{font-family:system-ui,sans-serif;max-width:1400px;margin:1rem auto;padding:0 1rem}figure{display:inline-block;margin:.5rem;vertical-align:top;max-width:640px}figure img{max-width:100%;border:1px solid #ccc}td{padding:.2rem .5rem;vertical-align:top}code{font-size:.8em;word-break:break-all}</style>
<h1>The movie link (development server, headless Firefox)</h1>
<p>${escape(new Date().toString())} · ${failing} failing</p>
<table>${checks.map((item) => `<tr><td>${item.ok ? "✅" : "❌"}</td><td>${escape(item.name)}</td><td><code>${escape(item.detail)}</code></td></tr>`).join("\n")}</table>
<h2>Screenshots</h2>${shots.map((item) => `<figure><img src="${item.file}" alt="${escape(item.caption)}"><figcaption>${escape(item.caption)}</figcaption></figure>`).join("\n")}
`,
);
console.log(`${checks.length} checks, ${failing} failing${finished ? "" : ", the run did not finish"}; report in ${OUT}`);
process.exit(failing === 0 && finished ? 0 : 1);
