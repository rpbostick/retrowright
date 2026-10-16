// Runs one browser check several times in a row, to tell a flaky check from
// a passing one: prints a line per run and how many passed, keeps each run's
// output in <log-dir>/<script>-<n>.log, and exits 1 unless every run passed.
//
// Usage: npm run e2e:repeat -- <script> [times] [log-dir]
// (for example: npm run e2e:repeat -- e2e:opposites 20)

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runScript } from "./runScript.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [script, timesText = "20", logDirText] = process.argv.slice(2);
const times = Number(timesText);
if (!script || !Number.isInteger(times) || times < 1) {
  console.error("Usage: npm run e2e:repeat -- <script> [times] [log-dir]");
  process.exit(2);
}
const logDir = resolve(logDirText ?? join(ROOT, ".out", "e2e-repeat"));
await mkdir(logDir, { recursive: true });

let passed = 0;
for (let run = 1; run <= times; run++) {
  const logName = `${script.replace(/:/g, "-")}-${run}.log`;
  const { status } = await runScript(script, join(logDir, logName), ROOT);
  if (status === 0) passed += 1;
  console.log(`${status === 0 ? "PASS" : "FAIL"} ${script} run ${run} of ${times} (${logName})`);
}
console.log(`${script}: ${passed} of ${times} passed; logs in ${logDir}`);
process.exit(passed === times ? 0 : 1);
