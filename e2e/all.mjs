// Runs every browser check in turn after one build, and prints one line per
// check (pass, fail, or skipped with the reason) and a total. Each check's
// output goes to <log-dir>/<script>.log; the checks write their pages where
// they do when run alone. Exits 1 when the build or any check fails.
//
// A check skips itself, exiting 0 after a line starting with SKIP, when a ROM
// it needs is missing (Final Fantasy, in roms/); that line is the reason
// printed here. A check that skips only a part passes with that part named.
//
// Usage: npm run e2e:all [-- log-dir]

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { outcome } from "./outcome.mjs";
import { runScript } from "./runScript.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LOG_DIR = resolve(process.argv[2] ?? join(ROOT, ".out", "e2e-all"));

// Deliberate: touch, backup and display run before e2e, as its page shows what they wrote beside it.
const SCRIPTS = [
  "e2e:touch",
  "e2e:backup",
  "e2e:display",
  "e2e",
  "e2e:movie",
  "e2e:offline",
  "e2e:pages",
  "e2e:ram-search",
  "e2e:patch",
  "e2e:test-links",
  "e2e:movie-link",
  "e2e:mouse",
  "e2e:combos",
  "e2e:opposites",
  "e2e:tune",
  "e2e:replay",
  "e2e:console",
  "a11y",
];

const run = (script, logPath) => runScript(script, logPath, ROOT);

await mkdir(LOG_DIR, { recursive: true });
console.log(`Logs: ${LOG_DIR}`);

const build = await run("build", join(LOG_DIR, "build.log"));
if (build.status !== 0) {
  console.log(`FAIL build — exit ${build.status}, see build.log`);
  process.exit(1);
}
console.log("PASS build");

const counts = { pass: 0, fail: 0, skip: 0 };
for (const script of SCRIPTS) {
  const logName = `${script.replace(/:/g, "-")}.log`;
  const result = outcome(await run(script, join(LOG_DIR, logName)));
  counts[result.kind] += 1;
  const label = { pass: "PASS", fail: "FAIL", skip: "SKIP" }[result.kind];
  console.log(`${label} ${script}${result.note ? ` — ${result.note}` : ""} (${logName})`);
}

console.log(`${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped of ${SCRIPTS.length}`);
process.exit(counts.fail === 0 ? 0 : 1);
