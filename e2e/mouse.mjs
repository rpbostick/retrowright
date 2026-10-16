// The second control set in headless Firefox (puppeteer-core over WebDriver
// BiDi), on the development server, with a synthetic ROM that reads pad 1
// every pass. Checks, through the pressed buttons the core reports: W, A, S
// and D move as the arrows do; a held left click on the picture is A and a
// held right click B, with the context menu kept from the picture alone;
// letting go outside the picture lets go in the game; a click outside the
// picture, and the click that gives focus back to it, press nothing; and the
// Controls view binds a secondary to a mouse button, which the controls panel
// shows at once. Screenshots of both go beside the report.
//
// Usage: npm run e2e:mouse [-- output-dir]
// Not part of `npm test`: it needs Firefox.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import { buildInes, READ_PAD_PROGRAM } from "../src/test/syntheticRom.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "mouse"));
const ROMS = join(OUT, "roms");
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";

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

const held = (page) => page.evaluate(() => window.__retrowright.heldButtons().sort().join(","));
const framesRun = (page) => page.evaluate(() => window.__retrowright.framesRun);

/** The buttons held a few frames after `act`, so a press that the core drops on the next frame is caught. */
async function heldAfter(page, act) {
  await act();
  const before = await framesRun(page);
  await waitFor(page, "frames to run", (count) => window.__retrowright.framesRun > count + 3, before);
  return held(page);
}

async function centre(page, selector) {
  const box = await (await page.$(selector)).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function escape(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

await mkdir(ROMS, { recursive: true });
await writeFile(join(ROMS, "read-pad.nes"), buildInes({ program: READ_PAD_PROGRAM }));
process.env.RETROWRIGHT_TEST_ROMS = ROMS;
const vite = await createServer({ configFile: join(ROOT, "vite.config.ts"), root: ROOT, logLevel: "error", server: { host: "127.0.0.1", port: 5191 } });
await vite.listen();
const origin = new URL(vite.resolvedUrls.local[0]).origin;
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
let finished = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(`${origin}/?play=local-roms/read-pad.nes&label=Second%20set&controls=1`, { waitUntil: "load" });
  await waitFor(page, "the game to run", () => window.__retrowright?.game === "read-pad.nes" && window.__retrowright.framesRun > 30);
  // Records, after the page's own handlers, whether each context menu was kept from opening.
  await page.evaluate(() => {
    window.__contextMenus = [];
    window.addEventListener("contextmenu", (event) => window.__contextMenus.push({ target: event.target.className, prevented: event.defaultPrevented }));
  });
  const focusedIsPicture = () => page.evaluate(() => document.activeElement?.matches("canvas.screen") ?? false);
  check("the picture has focus once the game starts", await focusedIsPicture());

  for (const [code, button] of [
    ["KeyW", "Up"],
    ["KeyA", "Left"],
    ["KeyS", "Down"],
    ["KeyD", "Right"],
  ]) {
    const during = await heldAfter(page, () => page.keyboard.down(code));
    await page.keyboard.up(code);
    const after = await heldAfter(page, async () => {});
    check(`${code} holds ${button}, as its arrow does`, during === `1:${button}` && after === "", `held ${during || "nothing"}, then ${after || "nothing"}`);
  }

  const picture = await centre(page, "canvas.screen");
  await page.mouse.move(picture.x, picture.y);
  const leftHeld = await heldAfter(page, () => page.mouse.down({ button: "left" }));
  await sleep(300);
  const leftStill = await held(page);
  check("a held left click on the picture holds A", leftHeld === "1:A" && leftStill === "1:A", `${leftHeld}, after 300 ms ${leftStill}`);
  const bothHeld = await heldAfter(page, () => page.mouse.down({ button: "right" }));
  check("a held right click on the picture holds B beside A", bothHeld === "1:A,1:B", bothHeld);
  const pictureMenus = await page.evaluate(() => window.__contextMenus.filter((menu) => menu.target === "screen"));
  check("the right click on the picture opens no context menu", pictureMenus.length > 0 && pictureMenus.every((menu) => menu.prevented), JSON.stringify(pictureMenus));
  await shot(page, "holding-a-and-b.png", "Left and right buttons held on the picture: A and B held (controls panel lists both sets)");

  const theme = await centre(page, "button.theme");
  await page.mouse.move(theme.x, theme.y);
  const leftOutside = await heldAfter(page, () => page.mouse.up({ button: "left" }));
  const rightOutside = await heldAfter(page, () => page.mouse.up({ button: "right" }));
  check("letting go of the buttons outside the picture lets go of A, then B", leftOutside === "1:B" && rightOutside === "", `${leftOutside} then ${rightOutside || "nothing"}`);

  // A click on a control outside the picture presses nothing; the page gives focus back to the picture after it.
  const mute = await centre(page, ".play-bar .mute");
  await page.mouse.move(mute.x, mute.y);
  const onMute = await heldAfter(page, () => page.mouse.down({ button: "left" }));
  await page.mouse.up({ button: "left" });
  check("a click on Mute presses nothing", onMute === "", onMute || "nothing");
  await page.evaluate(() => document.querySelector(".play-bar .mute").focus());
  await page.mouse.move(picture.x, picture.y);
  const focusing = await heldAfter(page, () => page.mouse.down({ button: "left" }));
  await page.mouse.up({ button: "left" });
  check("the click that gives focus back to the picture presses nothing", focusing === "" && (await focusedIsPicture()), focusing || "nothing");
  const afterFocus = await heldAfter(page, () => page.mouse.down({ button: "left" }));
  await page.mouse.up({ button: "left" });
  check("the next click on the picture holds A", afterFocus === "1:A", afterFocus);
  await page.mouse.click(theme.x, theme.y, { button: "right" });
  const themeMenus = await page.evaluate(() => window.__contextMenus.filter((menu) => menu.target !== "screen"));
  check("the context menu is left alone outside the picture", themeMenus.length > 0 && themeMenus.every((menu) => !menu.prevented), JSON.stringify(themeMenus));

  // Controls…: Start's secondary bound to the middle button, shown in the panel at once.
  await page.evaluate(() => document.querySelector("canvas.screen").focus());
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-item=controls]");
  await page.click("[data-item=controls]");
  const secondary = '[data-action=Start][data-slot="1"]';
  await page.click(secondary);
  const waiting = await page.$eval(secondary, (button) => button.textContent);
  const target = await centre(page, secondary);
  await page.mouse.click(target.x, target.y, { button: "middle" });
  await sleep(100);
  const bound = await page.$eval(secondary, (button) => button.textContent);
  const panel = await page.evaluate(() => [...document.querySelectorAll(".controls-side tbody tr")].find((row) => row.querySelector("th")?.textContent === "Start")?.querySelector(".side-secondary")?.textContent);
  check("the Controls view binds Start's secondary to the middle button, and the panel shows it", waiting === "Press a key…" && bound === "Middle click" && panel === "Middle click", `${waiting} → ${bound}; panel: ${panel}`);
  await shot(page, "controls-view.png", "Controls…: primary and secondary for each action, Start's secondary bound to the middle button; the panel behind shows it");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector("canvas.screen").focus());
  await page.mouse.move(picture.x, picture.y);
  const middle = await heldAfter(page, () => page.mouse.down({ button: "middle" }));
  await page.mouse.up({ button: "middle" });
  check("the middle button on the picture then holds Start", middle === "1:Start", middle);
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
  `<!doctype html><meta charset="utf-8"><title>retrowright: the second control set</title>
<style>body{font-family:system-ui,sans-serif;max-width:1400px;margin:1rem auto;padding:0 1rem}figure{display:inline-block;margin:.5rem;vertical-align:top;max-width:640px}figure img{max-width:100%;border:1px solid #ccc}td{padding:.2rem .5rem;vertical-align:top}code{font-size:.8em;word-break:break-all}</style>
<h1>The second control set: WASD and the mouse (development server, headless Firefox)</h1>
<p>${escape(new Date().toString())} · ${failing} failing</p>
<table>${checks.map((item) => `<tr><td>${item.ok ? "✅" : "❌"}</td><td>${escape(item.name)}</td><td><code>${escape(item.detail)}</code></td></tr>`).join("\n")}</table>
<h2>Screenshots</h2>${shots.map((item) => `<figure><img src="${item.file}" alt="${escape(item.caption)}"><figcaption>${escape(item.caption)}</figcaption></figure>`).join("\n")}
`,
);
console.log(`${checks.length} checks, ${failing} failing${finished ? "" : ", the run did not finish"}; report in ${OUT}`);
process.exit(failing === 0 && finished ? 0 : 1);
