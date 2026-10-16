// Accessibility check in headless Firefox (puppeteer-core over WebDriver BiDi).
// Serves the built dist/ under a sub-path and runs axe-core (MPL-2.0, a dev
// dependency, never shipped) against WCAG 2.1 A and AA on the library (empty,
// with a game, its Saves and storage panel, and a game's dialog with Apply
// patch…), the running game's page, the tools and controls panels beside it
// with the Developer tools setting on (search results, a watch, the memory
// viewer; a combo and a player 2 key are bound, so the panel and the Controls
// view show those tables too), the developer console beside it (answers, an
// error and a watch), and each view of the open quick menu (Save over a slot?
// among them), in the light and dark themes, and the Tune panel of a synthetic
// ROM with its tunables file loaded through Load tunables…. It fails on
// any serious or critical finding. It also walks each of those with Tab and
// fails when a focused control has no accessible name. The games are synthetic
// test ROMs built in code, so no ROM file is needed.
//
// Usage: npm run build && npm run a11y [-- output-dir]
// Not part of `npm test`: it needs Firefox.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createHash } from "node:crypto";
import { buildInes, PAINT_BACKDROP_PROGRAM } from "../src/test/syntheticRom.ts";
import { Button } from "../src/core/types.ts";
import { addCombo, DEFAULT_BINDINGS, player2Action, rebind, saveBindings } from "../src/input/keyBindings.ts";
import { startStaticServer } from "./staticServer.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");
const OUT = resolve(process.argv[2] ?? join(ROOT, ".out", "page", "a11y"));
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";
const SUB_PATH = "/retrowright/";
const FAILING_IMPACTS = ["serious", "critical"];
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
/** "confirm" is Save over a slot?, reached from Save state through slot 1, which F5 filled. */
const MENU_VIEWS = ["save", "confirm", "load", "controls", "touch", "display", "movie"];
const BINDINGS_KEY = "retrowright.keyBindings.v1";

if (!existsSync(join(DIST, "index.html"))) {
  console.error(`${join(DIST, "index.html")} is missing: run \`npm run build\` first.`);
  process.exit(1);
}
const axeSource = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

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

const audits = [];
const shots = [];

/** The stored value of the default bindings plus Down+B on C and player 2's A on M, as the page saves it. */
function auditedBindings() {
  let saved = null;
  const storage = {
    setItem: (key, value) => {
      if (key !== BINDINGS_KEY) throw new Error(`The bindings were saved under ${key}, not ${BINDINGS_KEY}.`);
      saved = value;
    },
  };
  saveBindings(storage, addCombo(rebind(DEFAULT_BINDINGS, player2Action(Button.A), "KeyM"), "KeyC", [Button.Down, Button.B]));
  return saved;
}

/** Runs axe on the page as it is now; with `within`, only inside that element (the open menu). */
async function audit(page, name, within = null) {
  // A dialog fading in has blended colours; axe measures contrast once it has finished.
  await waitFor(page, "animations to finish", () => document.getAnimations().every((animation) => animation.playState !== "running"));
  const result = await page.evaluate(
    async ({ tags, within }) => {
      const found = await window.axe.run(within ? document.querySelector(within) : document, { runOnly: { type: "tag", values: tags } });
      return {
        violations: found.violations.map((rule) => ({
          id: rule.id,
          impact: rule.impact,
          help: rule.help,
          nodes: rule.nodes.map((node) => ({ target: node.target.join(" "), summary: node.failureSummary })),
        })),
        passes: found.passes.length,
      };
    },
    { tags: AXE_TAGS, within },
  );
  const failing = result.violations.filter((rule) => FAILING_IMPACTS.includes(rule.impact));
  audits.push({ name, failing: failing.length, ...result });
  console.log(`${failing.length === 0 ? "PASS" : "FAIL"} ${name}: ${result.passes} rules pass, ${result.violations.length} with findings, ${failing.length} serious or critical`);
  for (const rule of result.violations) {
    console.log(`  ${rule.impact} ${rule.id}: ${rule.help}`);
    for (const node of rule.nodes.slice(0, 5)) console.log(`    ${node.target}`);
  }
  const file = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  await page.screenshot({ path: join(OUT, file) });
  shots.push({ file, caption: name });
}

/**
 * Presses Tab (Shift+Tab with `backwards`) up to `limit` times from where
 * focus is, listing each focused element and its accessible name
 * (aria-label, a label, or its text); stops when focus comes back to one
 * already listed.
 */
async function tabWalk(page, name, { backwards = false, limit = 40 } = {}) {
  const order = [];
  const describeFocus = () =>
    page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      // Each element gets an id of its own for the walk, so two alike (two Dismiss buttons) stay apart.
      window.__walkIds ??= new WeakMap();
      window.__walkNext ??= 0;
      if (!window.__walkIds.has(element)) window.__walkIds.set(element, window.__walkNext++);
      const labelled = element.getAttribute("aria-labelledby");
      const name =
        element.getAttribute("aria-label") ??
        (labelled ? document.getElementById(labelled)?.textContent : null) ??
        (element.labels?.[0]?.textContent ?? null) ??
        element.textContent;
      const rect = element.getBoundingClientRect();
      return { id: window.__walkIds.get(element), tag: element.tagName.toLowerCase(), item: element.dataset.item ?? element.className, name: (name ?? "").trim(), visible: rect.width > 0 && rect.height > 0 };
    });
  const first = await describeFocus();
  const start = first?.item ?? null;
  if (first) order.push(first);
  for (let step = 0; step < limit; step++) {
    if (backwards) await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    if (backwards) await page.keyboard.up("Shift");
    const focused = await describeFocus();
    if (!focused) continue;
    if (order.some((seen) => seen.id === focused.id)) break;
    order.push(focused);
  }
  const unnamed = order.filter((element) => element.name === "" || !element.visible);
  const key = backwards ? "Shift+Tab" : "Tab";
  audits.push({ name: `${name}: ${key} order from ${start}`, failing: unnamed.length, order });
  console.log(`${unnamed.length === 0 ? "PASS" : "FAIL"} ${name}: ${key} from ${start} reaches ${order.length} controls, ${unnamed.length} without a name or not visible: ${order.map((element) => element.name).join(" → ")}`);
  return order;
}

async function setTheme(page, wanted) {
  for (let step = 0; step < 3 && (await page.evaluate(() => document.documentElement.dataset.theme)) !== wanted; step++) await page.click("header .theme");
}

function escape(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

async function writeReport(results) {
  await writeFile(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const rows = results.audits
    .map((item) => {
      const detail = item.violations
        ? item.violations.map((rule) => `${rule.impact} ${rule.id}: ${rule.help} (${rule.nodes.map((node) => node.target).join(", ")})`).join("; ") || `${item.passes} rules pass`
        : item.order.map((element) => element.name || `(unnamed ${element.tag})`).join(" → ");
      return `<tr><td>${item.failing === 0 ? "✅" : "❌"}</td><td>${escape(item.name)}</td><td><code>${escape(detail)}</code></td></tr>`;
    })
    .join("\n");
  const figure = (shot) => `<figure><img src="${shot.file}" alt="${escape(shot.caption)}"><figcaption>${escape(shot.caption)}</figcaption></figure>`;
  await writeFile(
    join(OUT, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>retrowright: accessibility check</title>
<style>body{font-family:system-ui,sans-serif;max-width:1200px;margin:1rem auto;padding:0 1rem}figure{display:inline-block;margin:.5rem;vertical-align:top;max-width:380px}figure img{max-width:100%;border:1px solid #ccc}td{padding:.2rem .5rem;vertical-align:top}code{font-size:.85em}</style>
<h1>retrowright: axe-core ${escape(results.axeVersion)} in headless Firefox</h1>
<p>${escape(results.when)} · WCAG 2.1 A and AA · fails on ${FAILING_IMPACTS.join(" or ")} findings · ${results.failing} failing</p>
<table>${rows}</table>
<h2>Screenshots</h2>${results.screenshots.map(figure).join("\n")}
`,
  );
}

await mkdir(OUT, { recursive: true });
const scratch = join(tmpdir(), `retrowright-a11y-${process.pid}`);
await mkdir(scratch, { recursive: true });
const romPath = join(scratch, "Synthetic Test (USA).nes");
await writeFile(romPath, buildInes({ battery: true }));
const server = await startStaticServer({ root: DIST, subPath: SUB_PATH, ports: [8830, 8831, 8832, 8833, 8834, 8835] });
const url = `http://127.0.0.1:${server.port}${SUB_PATH}?debug`;
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
let axeVersion = "";
let finished = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: "load" });
  // A combo and a key for player 2, so the Controls view and the controls panel are audited with their tables.
  await page.evaluate((key, value) => localStorage.setItem(key, value), BINDINGS_KEY, auditedBindings());
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#rom-input");
  // The emulated preference makes "system" mean light; dark is chosen below.
  await page.evaluate(axeSource);
  axeVersion = await page.evaluate(() => window.axe.version);

  // The empty library exists only before the first game, so both themes see it first.
  for (const theme of ["light", "dark"]) {
    await setTheme(page, theme);
    await audit(page, `library, empty, ${theme}`);
  }
  for (const theme of ["light", "dark"]) {
    await setTheme(page, theme);
    if (theme === "light") {
      await (await page.$("#rom-input")).uploadFile(romPath);
      await waitFor(page, "the game to start", () => window.__retrowright?.game);
      await waitFor(page, "frames", () => window.__retrowright.framesRun > 30);
      await page.keyboard.press("F5");
      await waitFor(page, "the save", () => document.querySelector(".notices")?.textContent?.includes("Saved to slot 1."));
    }
    // The running game: the picture and the play bar.
    if (!(await page.evaluate(() => window.__retrowright.game))) {
      await page.click(".continue-button");
      await waitFor(page, "the game to run", () => window.__retrowright?.game);
    }
    await page.focus("canvas.screen");
    await audit(page, `game running, ${theme}`);
    // Focus order is the same in both themes: the keyboard is walked once, in the first.
    if (theme === "light") await keyboardChecks(page, theme);

    // The controls panel beside the running game, turned on in Display and speed with Developer tools (the tools panel and the console below); both stay on from here.
    if (!(await page.$(".controls-side"))) {
      await page.focus("canvas.screen");
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-item=display]");
      await page.click("[data-item=display]");
      await page.click("[data-item=show-controls]");
      await page.click("[data-item=developer-tools]");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.waitForSelector(".controls-side");
      await waitFor(page, "the menu to close", () => document.querySelector("[role=dialog]") === null);
    }

    // The tools panel beside the running game and the controls panel, with search results, a watch and the memory viewer.
    await page.focus("canvas.screen");
    await page.keyboard.press("F4");
    await page.waitForSelector(".tools-panel");
    await page.click("[data-tool=filter]");
    await page.waitForSelector("[data-tool=watch]");
    if (!(await page.$(".watches"))) await page.click("[data-tool=watch]");
    await page.click("[data-tool=memory-toggle]");
    await page.waitForSelector(".hex-view");
    await audit(page, `tools and controls panels, ${theme}`);
    if (theme === "light") await tabWalk(page, `tools panel, ${theme}`, { limit: 20 });
    await page.focus("[data-tool=close]");
    await page.keyboard.press("Escape");
    await waitFor(page, "the tools panel to close", () => document.querySelector(".tools-panel") === null);
    const focusBack = await page.evaluate(() => document.activeElement?.className === "screen");
    audits.push({ name: `tools panel, ${theme}: Esc closes it and focus goes back to the picture`, failing: focusBack ? 0 : 1, order: [] });
    console.log(`${focusBack ? "PASS" : "FAIL"} tools panel, ${theme}: Esc closes it and focus goes back to the picture`);

    // The developer console beside the running game and the controls panel, with answers, an error and a watch.
    await page.focus("canvas.screen");
    await page.keyboard.press("Backquote");
    await page.waitForSelector(".console-panel");
    for (const command of ["peek 0 12", "pause", "watch 0", "peak"]) {
      await page.keyboard.type(command);
      await page.keyboard.press("Enter");
    }
    await page.waitForSelector(".console-line.error");
    await page.waitForSelector(".console-watches");
    await audit(page, `developer console and controls panel, ${theme}`);
    if (theme === "light") await tabWalk(page, `developer console, ${theme}`, { limit: 6 });
    await page.focus("#console-input");
    await page.keyboard.type("resume");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    const consoleFocusBack = await page.evaluate(() => document.activeElement?.className === "screen");
    await page.keyboard.press("Backquote");
    await waitFor(page, "the console to hide", () => document.querySelector(".console-panel") === null);
    audits.push({ name: `developer console, ${theme}: Esc gives focus back to the picture`, failing: consoleFocusBack ? 0 : 1, order: [] });
    console.log(`${consoleFocusBack ? "PASS" : "FAIL"} developer console, ${theme}: Esc gives focus back to the picture`);

    // The quick menu and each of its views.
    await page.focus("canvas.screen");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[role=dialog]");
    await audit(page, `quick menu, ${theme}`, "[role=dialog]");
    if (theme === "light") await tabWalk(page, `quick menu, ${theme}`);
    for (const view of MENU_VIEWS) {
      if (view === "confirm") {
        await page.click("[data-item=save]");
        await page.waitForSelector("[data-slot='1']");
        await page.click("[data-slot='1']");
        await page.waitForSelector("[data-item=cancel]");
      } else {
        await page.click(`[data-item=${view}]`);
        await page.waitForSelector("[data-item=back]");
      }
      await sleep(100);
      await audit(page, `quick menu: ${view}, ${theme}`, "[role=dialog]");
      if (theme === "light") await tabWalk(page, `quick menu: ${view}, ${theme}`);
      if (view === "confirm") {
        await page.click("[data-item=cancel]");
        await page.waitForSelector("[data-slot='1']");
      }
      await page.click("[data-item=back]");
      await page.waitForSelector("[data-item=resume]");
    }

    // Back to the library, with the game on it.
    await page.click("[data-item=quit]");
    await page.waitForSelector(".continue-button");
    await audit(page, `library with a game, ${theme}`);
    if (theme === "light") await tabWalk(page, `library with a game, ${theme}`);
    await page.click(".open-saves");
    await page.waitForSelector("[data-item=export]");
    await audit(page, `saves and storage, ${theme}`);
    if (theme === "light") await tabWalk(page, `saves and storage, ${theme}`);
    await page.evaluate(() => [...document.querySelectorAll(".library-dialog button")].find((button) => button.textContent === "Close").click());
    await waitFor(page, "the saves panel to close", () => document.querySelector("[data-item=export]") === null);
    // A game's own dialog: its title, Apply patch…, export and remove.
    await page.click(".card-more");
    await page.waitForSelector("[data-item=apply-patch]");
    await audit(page, `game dialog, ${theme}`);
    if (theme === "light") await tabWalk(page, `game dialog, ${theme}`);
    await page.click(".library-dialog [data-item=cancel]");
    await waitFor(page, "the game dialog to close", () => document.querySelector("[data-item=apply-patch]") === null);
  }
  await tuneChecks(page);
  finished = true;
} catch (error) {
  audits.push({ name: `the run finished: ${error.message}`, failing: 1, violations: [], passes: 0 });
  console.log(`FAIL the run finished: ${error.stack ?? error}`);
} finally {
  await browser.close();
  await server.stop();
  await rm(scratch, { recursive: true, force: true });
}

/**
 * The Tune panel on a synthetic ROM with a synthetic tunables file, loaded
 * through the menu's Load tunables…, in both themes, beside the controls panel.
 */
async function tuneChecks(page) {
  const rom = buildInes({ program: PAINT_BACKDROP_PROGRAM });
  rom.set([8, 1, 20], 16 + 0x200);
  const romPath = join(scratch, "Tunable (Synthetic).nes");
  await writeFile(romPath, rom);
  const romSha256 = createHash("sha256").update(rom).digest("hex");
  const tunablesPath = join(scratch, "Tunable (Synthetic).tunables.json");
  const value = (key, name, description, offset, extra) => ({ key, name, description, romOffset: 16 + 0x200 + offset, cpuAddress: 0x8200 + offset, ...extra });
  await writeFile(
    tunablesPath,
    JSON.stringify({
      format: "retrowright-tunables",
      version: 1,
      romSha256,
      patch: "tunable.bps",
      values: [
        value("push", "Push", "Speed one push adds.", 0, { min: 0, max: 32, default: 8 }),
        value("style", "Push style", "How a push is made.", 1, { min: 0, max: 1, default: 1, choices: ["Direction taps", "B taps"] }),
        value("ramp", "Brake ramp", "Frames the brake takes to reach full strength.", 2, { min: 1, max: 60, default: 20 }),
      ],
    }),
  );
  await (await page.$("#rom-input")).uploadFile(romPath);
  await waitFor(page, "the tunable ROM to run", (id) => window.__retrowright?.romId === id && window.__retrowright.framesRun > 30, romSha256);
  await page.focus("canvas.screen");
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-item=load-tunables]");
  await (await page.$("#game-file-input")).uploadFile(tunablesPath);
  await page.waitForSelector(".tune-panel");
  for (const theme of ["light", "dark"]) {
    await setTheme(page, theme);
    await audit(page, `Tune panel, ${theme}`);
  }
  await page.focus("[data-tool=tune-close]");
  await tabWalk(page, "Tune panel, dark", { limit: 12 });
  await page.focus("[data-tool=tune-close]");
  await page.keyboard.press("Escape");
  await waitFor(page, "the Tune panel to close", () => document.querySelector(".tune-panel") === null);
  const focusBack = await page.evaluate(() => document.activeElement?.className === "screen");
  audits.push({ name: "Tune panel: Esc closes it and focus goes back to the picture", failing: focusBack ? 0 : 1, order: [] });
  console.log(`${focusBack ? "PASS" : "FAIL"} Tune panel: Esc closes it and focus goes back to the picture`);
}

/** Tab on the picture fast-forwards; Shift+Tab from it, and Tab from the play bar, reach Menu, Mute and the volume. */
async function keyboardChecks(page, theme) {
    // Tab held on the picture fast-forwards and keeps focus there.
    await page.keyboard.down("Tab");
    await sleep(200);
    const tabOnPicture = await page.evaluate(() => ({ speed: window.__retrowright.speed, focus: document.activeElement?.className }));
    await page.keyboard.up("Tab");
    const pictureOk = tabOnPicture.speed > 1 && tabOnPicture.focus === "screen";
    audits.push({ name: `game running, ${theme}: Tab on the picture fast-forwards`, failing: pictureOk ? 0 : 1, order: [{ name: JSON.stringify(tabOnPicture), tag: "canvas" }] });
    console.log(`${pictureOk ? "PASS" : "FAIL"} game running, ${theme}: Tab held on the picture fast-forwards ${JSON.stringify(tabOnPicture)}`);
    // Shift+Tab from the picture, and Tab from the play bar, move focus through Menu, Mute and the volume.
    const reached = [];
    await page.focus("canvas.screen");
    reached.push(...(await tabWalk(page, `game running, ${theme}`, { backwards: true })));
    await page.focus(".play-bar .menu-open");
    reached.push(...(await tabWalk(page, `game running, ${theme}`)));
    const names = reached.map((element) => element.name);
    const barOk = names.some((text) => text.startsWith("Menu")) && names.includes("Mute") && names.some((text) => text.startsWith("Volume"));
    audits.push({ name: `game running, ${theme}: the keyboard reaches Menu, Mute and the volume`, failing: barOk ? 0 : 1, order: reached });
    console.log(`${barOk ? "PASS" : "FAIL"} game running, ${theme}: the keyboard reaches Menu, Mute and the volume`);
}

const failing = audits.reduce((total, item) => total + item.failing, 0);
await writeReport({ when: new Date().toString(), axeVersion, failing, audits, screenshots: shots });
console.log(`${audits.length} audits, ${failing} failing finding(s)${finished ? "" : ", the run did not finish"}; report in ${OUT}`);
process.exit(failing === 0 && finished ? 0 : 1);
