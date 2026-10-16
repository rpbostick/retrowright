// Offline play and updates in headless Firefox (puppeteer-core over WebDriver
// BiDi). Serves the built dist/ under a sub-path and:
//
// 1. Offline: loads the page once, adds a game (a synthetic test ROM built in
//    code, so no ROM file is needed), waits for the service worker, then stops
//    the server (every request to it now fails, as with the network off),
//    reloads, opens the stored game from the library and checks that frames
//    advance.
// 2. Update: with the server back and a game running, serves a next build (a
//    copy of dist/ whose index.html and service worker differ, as a rebuild's
//    would) and asks the browser to check for updates. The notice "A new
//    version is ready" shows, the game keeps running on the same document,
//    which still lacks the next build's marker; Reload then brings the next
//    build in.
//
// Writes screenshots, results.json and an index.html to the output directory.
// Usage: npm run build && npx tsx e2e/offline.mjs [output-dir]
// Not part of `npm test`: it needs Firefox.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { buildInes } from "../src/test/syntheticRom.ts";
import { startStaticServer } from "./staticServer.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "offline"));
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";
const SUB_PATH = "/retrowright/";
const NEXT_MARKER = '<meta name="retrowright-build" content="next">';

if (!existsSync(join(DIST, "sw.js"))) {
  console.error(`${join(DIST, "sw.js")} is missing: run \`npm run build\` first.`);
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

const framesRun = (page) => page.evaluate(() => window.__retrowright?.framesRun ?? 0);

const shots = [];
async function shoot(page, name, caption) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  shots.push({ file: `${name}.png`, caption });
}

/** A copy of dist/ as the next build would differ: a marker in index.html, and the worker's precache revision for it changed to match. */
async function makeNextBuild(dir) {
  await rm(dir, { recursive: true, force: true });
  await cp(DIST, dir, { recursive: true });
  const index = await readFile(join(dir, "index.html"), "utf8");
  await writeFile(join(dir, "index.html"), index.replace("<head>", `<head>\n    ${NEXT_MARKER}`));
  const worker = await readFile(join(dir, "sw.js"), "utf8");
  const changed = worker.replace(/(\{url:"index\.html",revision:")[0-9a-f]+(")/, "$1nextbuild$2");
  if (changed === worker) throw new Error("dist/sw.js has no precache entry for index.html to change.");
  await writeFile(join(dir, "sw.js"), changed);
}

function escape(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

async function writeReport(results) {
  await writeFile(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const figure = (shot) => `<figure><img src="${shot.file}" alt="${escape(shot.caption)}"><figcaption>${escape(shot.caption)}</figcaption></figure>`;
  const rows = results.checks.map((item) => `<tr><td>${item.ok ? "✅" : "❌"}</td><td>${escape(item.name)}</td><td><code>${escape(JSON.stringify(item.detail ?? ""))}</code></td></tr>`).join("\n");
  await writeFile(
    join(OUT, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>retrowright: offline and updates</title>
<style>body{font-family:system-ui,sans-serif;max-width:1200px;margin:1rem auto;padding:0 1rem}figure{display:inline-block;margin:.5rem;vertical-align:top;max-width:560px}figure img{max-width:100%;border:1px solid #ccc}td{padding:.2rem .5rem;vertical-align:top}code{font-size:.85em;word-break:break-all}</style>
<h1>retrowright: offline play and updates in headless Firefox</h1>
<p>${escape(results.when)} · ${results.passed}/${results.checks.length} checks passed</p>
<h2>Checks</h2><table>${rows}</table>
<h2>Screenshots</h2>${results.screenshots.map(figure).join("\n")}
`,
  );
}

await mkdir(OUT, { recursive: true });
const scratch = join(tmpdir(), `retrowright-offline-${process.pid}`);
await mkdir(scratch, { recursive: true });
const romPath = join(scratch, "synthetic.nes");
await writeFile(romPath, buildInes({ battery: true }));
const nextDist = join(scratch, "dist-next");
await makeNextBuild(nextDist);

const server = await startStaticServer({ root: DIST, subPath: SUB_PATH, ports: [8820, 8821, 8822, 8823, 8824, 8825] });
const url = `http://127.0.0.1:${server.port}${SUB_PATH}?debug`;
console.log(`Serving ${DIST} at ${url}`);
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
const consoleLines = [];
let exitCode = 0;
try {
  const page = await browser.newPage();
  page.on("console", (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`pageerror: ${error.message}`));
  await page.setViewport({ width: 1280, height: 900 });

  // 1. Offline.
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("#rom-input");
  await (await page.$("#rom-input")).uploadFile(romPath);
  await waitFor(page, "the game to start", () => window.__retrowright?.game);
  const worker = await waitFor(page, "the service worker to activate", async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.state === "activated" && { scope: registration.scope, script: registration.active.scriptURL };
  });
  check("the service worker activates with the page's own folder as its scope", worker.scope.endsWith(SUB_PATH) && worker.script.endsWith(`${SUB_PATH}sw.js`), worker);
  await waitFor(page, "the offline-ready notice", () => document.querySelector(".notices")?.textContent?.includes("now opens without a network"));
  await shoot(page, "01-online-first-load", "First load, online: the game added and running; the notice says the page now opens without a network.");
  // Keep the game for Continue, as leaving the page does.
  await page.keyboard.press("Escape");
  await page.click("[data-item=quit]");
  await page.waitForSelector(".continue-button");

  await server.stop();
  const refused = await page.evaluate(async (target) => {
    try {
      await fetch(`${target}?probe=${Date.now()}`, { cache: "no-store" });
      return false;
    } catch {
      return true;
    }
  }, `http://127.0.0.1:${server.port}/elsewhere/`);
  check("with the server stopped, a request outside the worker's scope fails: the network is off", refused, { refused });
  await page.reload({ waitUntil: "load" });
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  await page.waitForSelector(".continue-button", { timeout: 20000 });
  await shoot(page, "02-offline-library", "Reloaded with the server stopped: the library from the service worker's cache, the stored game on the Continue card.");
  await page.click(".continue-button");
  await waitFor(page, "the game to open offline", () => window.__retrowright?.game);
  const before = await framesRun(page);
  await sleep(1000);
  const after = await framesRun(page);
  check("offline, the reloaded page is served by the worker, opens the stored game and frames advance", controlled && after > before + 30, { controlled, before, after });
  await shoot(page, "03-offline-playing", "Offline: the stored game running.");

  // 2. Update.
  await server.start(DIST);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".continue-button");
  await page.click(".continue-button");
  await waitFor(page, "the game to run", () => (window.__retrowright?.framesRun ?? 0) > 30);
  await page.evaluate(() => (window.__sameDocument = true));
  server.setRoot(nextDist);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await waitFor(page, "the update notice", () => document.querySelector(".update-notice") !== null, undefined, 30000);
  const waiting = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return { waiting: registration.waiting?.state ?? null, sameDocument: window.__sameDocument === true, nextMarker: document.querySelector('meta[name="retrowright-build"]') !== null, notice: document.querySelector(".update-notice").textContent };
  });
  const runningFrom = await framesRun(page);
  await sleep(1000);
  const runningTo = await framesRun(page);
  check(
    "a new build shows the update notice, waits, and leaves the running game on its own files",
    waiting.waiting === "installed" && waiting.sameDocument && !waiting.nextMarker && waiting.notice.includes("A new version is ready") && runningTo > runningFrom + 30,
    { ...waiting, runningFrom, runningTo },
  );
  await shoot(page, "04-update-notice", "A new build was found while the game runs: the notice offers Reload; the game goes on.");
  await page.click(".update-reload");
  await waitFor(page, "the next build to load", () => window.__sameDocument !== true && document.querySelector('meta[name="retrowright-build"]') !== null && document.querySelector(".continue-button") !== null, undefined, 30000);
  const reloaded = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return { waiting: registration.waiting?.state ?? null, continueLabel: document.querySelector(".continue-button").textContent };
  });
  check("Reload brings in the next build, and the game is kept for Continue", reloaded.waiting === null && reloaded.continueLabel === "Continue", reloaded);
  await shoot(page, "05-after-reload", "After Reload: the next build, with the game on the Continue card.");
} catch (error) {
  check(`the run finished: ${error.message}`, false);
  exitCode = 1;
} finally {
  await browser.close();
  await server.stop();
  await rm(scratch, { recursive: true, force: true });
}

const passed = checks.filter((item) => item.ok).length;
if (checks.some((item) => !item.ok)) exitCode = 1;
await writeReport({ when: new Date().toString(), passed, checks, screenshots: shots, console: consoleLines });
console.log(`${passed}/${checks.length} checks passed; report in ${OUT}`);
process.exit(exitCode);
