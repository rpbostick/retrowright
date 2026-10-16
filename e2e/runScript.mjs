// Runs one npm script as a child process for e2e/all.mjs and e2e/repeat.mjs.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

/**
 * Runs `npm run <script>` from `cwd` with its output in `logPath`, and
 * resolves to its exit code and output. A process that cannot start resolves
 * as exit 1 with the error in its output, so it gets a FAIL line like any
 * other failure; Node may emit 'close' after 'error', so only the first of
 * the two counts.
 */
export function runScript(script, logPath, cwd) {
  return new Promise((done) => {
    const log = createWriteStream(logPath);
    let output = "";
    let finished = false;
    const finish = (status, ending) => {
      if (finished) return;
      finished = true;
      log.end(ending, () => done({ status, output }));
    };
    const child = spawn("npm", ["run", "--silent", script], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const collect = (chunk) => {
      output += chunk;
      log.write(chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => {
      output += `\n${error.message}\n`;
      finish(1, `\n${error.message}\nexit 1 (could not start)\n`);
    });
    child.once("close", (code, signal) => finish(code ?? 1, `\nexit ${code ?? 1}${signal ? ` (${signal})` : ""}\n`));
  });
}
