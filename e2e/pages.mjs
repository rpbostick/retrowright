// The site as GitHub Pages serves it, in headless Firefox (puppeteer-core
// over WebDriver BiDi): serves the built dist/ under /retrowright/ only, and
// checks that every asset index.html names resolves under that path, that the
// library loads, that a synthetic ROM added through the file input runs, that
// the service worker and the manifest's scope and start URL are the
// sub-path, and that no request leaves it or fails. Works on `npm run
// build:pages` (absolute /retrowright/ URLs) and `npm run build` (relative
// ones); it prints which it found. No ROM is needed.
//
// Usage: npm run build:pages && npm run e2e:pages [-- output-dir]
// Not part of `npm test`: it needs Firefox.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { buildInes, PAINT_BACKDROP_PROGRAM } from "../src/test/syntheticRom.ts";
import { startStaticServer } from "./staticServer.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "pages"));
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";
const SUB_PATH = "/retrowright/";

if (!existsSync(join(DIST, "index.html"))) {
  console.error(`${join(DIST, "index.html")} is missing: run \`npm run build:pages\` first.`);
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

await mkdir(OUT, { recursive: true });
const index = await readFile(join(DIST, "index.html"), "utf8");
const assetUrls = [...index.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
const pageUrl = new URL(SUB_PATH, "http://pages.example");
const outside = assetUrls.filter((url) => !new URL(url, pageUrl).pathname.startsWith(SUB_PATH));
const absolute = assetUrls.some((url) => url.startsWith(SUB_PATH));
const relative = assetUrls.every((url) => !url.startsWith("/"));
console.log(`dist/ was built with ${absolute ? `base ${SUB_PATH} (npm run build:pages)` : relative ? "relative URLs (npm run build)" : `another base`}.`);
check("every asset index.html names resolves under the sub-path", assetUrls.length > 0 && outside.length === 0, { assetUrls, outside });

const romPath = join(tmpdir(), `retrowright-pages-${process.pid}.nes`);
await writeFile(romPath, buildInes({ program: PAINT_BACKDROP_PROGRAM }));
const server = await startStaticServer({ root: DIST, subPath: SUB_PATH, ports: [8830, 8831, 8832, 8833, 0] });
const origin = `http://127.0.0.1:${server.port}`;
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
const requests = [];
const failures = [];
let finished = false;
try {
  const page = await browser.newPage();
  page.on("request", (request) => requests.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${origin}${SUB_PATH}?debug`, { waitUntil: "load" });
  await page.waitForSelector("#rom-input");
  const library = await page.evaluate(() => document.body.textContent?.includes("Where do games come from?"));
  check("the library loads under the sub-path, with its empty-library explanation", library);
  await page.screenshot({ path: join(OUT, "01-library.png") });

  await (await page.$("#rom-input")).uploadFile(romPath);
  await waitFor(page, "the game to start", () => window.__retrowright?.game);
  const before = await page.evaluate(() => window.__retrowright.framesRun);
  await sleep(1000);
  const after = await page.evaluate(() => window.__retrowright.framesRun);
  check("a synthetic ROM added through the file input runs", after > before + 30, { game: await page.evaluate(() => window.__retrowright.game), before, after });
  await page.screenshot({ path: join(OUT, "02-playing.png") });

  const worker = await waitFor(page, "the service worker to activate", async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.state === "activated" && { scope: registration.scope, script: registration.active.scriptURL };
  });
  check("the service worker's scope is the sub-path", worker.scope === `${origin}${SUB_PATH}` && worker.script === `${origin}${SUB_PATH}sw.js`, worker);

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').href;
    const json = await (await fetch(href)).json();
    return { href, scope: new URL(json.scope, href).href, startUrl: new URL(json.start_url, href).href, icons: json.icons.map((icon) => new URL(icon.src, href).href) };
  });
  const iconStatuses = await page.evaluate(async (icons) => Promise.all(icons.map(async (icon) => (await fetch(icon)).status)), manifest.icons);
  check(
    "the manifest's scope and start URL are the sub-path, and its icons load from it",
    manifest.scope === `${origin}${SUB_PATH}` && manifest.startUrl === `${origin}${SUB_PATH}` && iconStatuses.every((status) => status === 200),
    { ...manifest, iconStatuses },
  );

  const strays = requests.filter((url) => url.startsWith("http") && !url.startsWith(`${origin}${SUB_PATH}`));
  check("no request leaves the sub-path", strays.length === 0, { requests: requests.length, strays });
  check("no request fails", failures.length === 0, { failures });
  finished = true;
} catch (error) {
  check(`the run finished: ${error.message}`, false);
} finally {
  await browser.close();
  await server.stop();
}

const failing = checks.filter((item) => !item.ok).length;
await writeFile(join(OUT, "results.json"), JSON.stringify({ when: new Date().toString(), base: absolute ? SUB_PATH : relative ? "./" : "other", checks }, null, 2));
console.log(`${checks.length} checks, ${failing} failing${finished ? "" : ", the run did not finish"}; screenshots and results.json in ${OUT}`);
process.exit(failing === 0 && finished ? 0 : 1);
