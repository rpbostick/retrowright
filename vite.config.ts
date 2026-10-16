import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { TEST_ROMS_VARIABLE, testRomsPlugin } from "./harness/testRomsPlugin";
import { LICENSES_FILE } from "./harness/thirdPartyLicenses";

/** Puts THIRD_PARTY_LICENSES (npm run licenses) into dist/, in place of the licence comments the bundle leaves out. */
function thirdPartyLicensesPlugin(): Plugin {
  return {
    name: "third-party-licenses",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "THIRD_PARTY_LICENSES.txt", source: readFileSync(LICENSES_FILE, "utf8") });
    },
  };
}

/** Names the path the site is served under (`npm run build:pages` sets it to /retrowright/); unset, asset URLs are relative. */
const BASE_VARIABLE = "RETROWRIGHT_BASE";

/** The base from the environment: a path from the site's root, starting and ending with "/". */
function baseFromEnvironment(): string {
  const base = process.env[BASE_VARIABLE];
  if (base === undefined || base === "") return "./";
  if (!base.startsWith("/") || !base.endsWith("/")) throw new Error(`${BASE_VARIABLE} is ${base}; it must start and end with "/", as /retrowright/ does.`);
  return base;
}

export default defineConfig({
  // Deliberate: relative asset URLs by default, so dist/ works under any
  // sub-path (GitHub Pages serves the site under /<repo>/) without a rebuild.
  base: baseFromEnvironment(),
  // Licence comments stay out of the minified bundle; dist/THIRD_PARTY_LICENSES.txt carries them in full.
  esbuild: { legalComments: "none" },
  plugins: [
    react(),
    thirdPartyLicensesPlugin(),
    // Development server only: serves the test ROM folder for test links.
    testRomsPlugin(process.env[TEST_ROMS_VARIABLE]),
    VitePWA({
      // Deliberate: a new version waits for the player's Reload instead of
      // replacing the page's files under a running game.
      registerType: "prompt",
      // Registered by src/ui/UpdateNotice.tsx, which shows the update notice.
      injectRegister: false,
      // Relative, like the assets: the worker and its scope are the folder the page is served from.
      scope: "./",
      manifest: {
        name: "retrowright",
        short_name: "retrowright",
        description: "NES in the browser. Your games and saves stay in this browser.",
        id: "./",
        start_url: "./",
        scope: "./",
        // Deliberate: standalone, not fullscreen: iOS honours only standalone
        // for a Home Screen app, and the menu's Fullscreen covers the rest.
        display: "standalone",
        theme_color: "#1b2030",
        background_color: "#1b2030",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        // The manifest and its icons are added by the plugin itself.
        globPatterns: ["**/*.{js,css,html}"],
        // The page's own URL with ?debug (the browser checks) is the same page.
        ignoreURLParametersMatching: [/^debug$/],
      },
    }),
  ],
  build: {
    // Deliberate: ES2022 keeps class fields native. Lower targets rewrite them
    // into calls to a bundler helper, and the AudioWorklet, built from
    // SampleRing's source text, has no such helper in its scope.
    target: "es2022",
  },
  test: {
    // e2e/ holds browser scripts run by hand; only its *.test.ts files are unit tests.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "harness/**/*.test.ts", "e2e/**/*.test.ts"],
    // Git worktrees checked out under .worktrees/ are copies of the repository;
    // their tests are not part of this checkout's suite.
    exclude: ["**/node_modules/**", "**/dist/**", ".worktrees/**"],
  },
});
