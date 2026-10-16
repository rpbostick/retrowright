// Renders public/icon.svg to the PNG sizes the web app manifest lists
// (public/icon-192.png, public/icon-512.png) in headless Firefox, so the
// PNGs always match the SVG. Run it after changing the SVG:
//
// Usage: npm run icons

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SVG = join(ROOT, "public", "icon.svg");
const SIZES = [192, 512];
const FIREFOX = process.env.FIREFOX ?? "/usr/bin/firefox";

const svg = await readFile(SVG, "utf8");
const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, protocol: "webDriverBiDi" });
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    await page.setViewport({ width: size, height: size });
    const html = `<!doctype html><style>html,body{margin:0;overflow:hidden}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}">`;
    await page.setContent(html, { waitUntil: "load" });
    const path = join(ROOT, "public", `icon-${size}.png`);
    await page.screenshot({ path, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`wrote ${path}`);
  }
} finally {
  await browser.close();
}
