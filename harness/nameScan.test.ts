import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadNamePatterns, NAME_SCAN_FILE, NAME_SCAN_VARIABLE, namesIn, parseNamePatterns } from "./nameScan";

// The built page is scanned too, in harness/testRomsPlugin.test.ts's build.

const ROOT = resolve(import.meta.dirname, "..");
const scan = loadNamePatterns(ROOT);

/** Every tracked file but the lockfile, whose integrity hashes are random letters a short name can match by chance. */
function trackedFiles(): string[] {
  const run = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ls-files failed: ${run.stderr}`);
  return run.stdout.split("\0").filter((file) => file !== "" && file !== "package-lock.json");
}

describe("the repository's tracked files", () => {
  it.skipIf(scan === null)(`name nothing the pattern file lists (${NAME_SCAN_VARIABLE}, else ${NAME_SCAN_FILE}; skipped without one)`, async () => {
    const files = trackedFiles();
    expect(files.length).toBeGreaterThan(100);
    const found: string[] = [];
    for (const file of files) {
      for (const name of namesIn(await readFile(join(ROOT, file), "latin1"), scan!.patterns)) found.push(`${name} in ${file}`);
    }
    expect(found).toEqual([]);
  });
});

describe("the pattern file", () => {
  let folder: string;
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), "retrowright-name-scan-"));
  });
  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("finds a planted name in any case, and a /pattern/ in its own case only", () => {
    const patterns = parseNamePatterns("# a comment\n\nzorblax\n/Quux_Speed/\n/[0-9a-f]{64}/i\n", "planted");
    expect(patterns).toHaveLength(3);
    expect(namesIn("A BUILD OF ZORBLAX-pedal", patterns)).toEqual(["ZORBLAX"]);
    expect(namesIn("Quux_Speed at $0057, quux_speed", patterns)).toEqual(["Quux_Speed"]);
    expect(namesIn("quux_speed", patterns)).toEqual([]);
    expect(namesIn("Final Fantasy's map byte", patterns)).toEqual([]);
    const hash = "AB".repeat(32);
    expect(namesIn(`sha256 ${hash}`, patterns)).toEqual([hash]);
  });

  it("finds a name in every text it scans, not only the first, with a g flag given", () => {
    const patterns = parseNamePatterns("/zorblax/gi\n", "planted");
    expect(namesIn("zorblax", patterns)).toEqual(["zorblax"]);
    expect(namesIn("zorblax", patterns)).toEqual(["zorblax"]);
  });

  it("refuses a line that is no regular expression, naming its line", () => {
    expect(() => parseNamePatterns("zorblax\n(unclosed\n", "names.txt")).toThrow("names.txt, line 2");
  });

  it("is read from the file the variable names, else from .name-scan at the root, else there is none", async () => {
    const named = join(folder, "names.txt");
    await writeFile(named, "zorblax\n");
    expect(loadNamePatterns(folder, { [NAME_SCAN_VARIABLE]: named })?.patterns.map(String)).toEqual(["/zorblax/i"]);
    expect(loadNamePatterns(folder, {})).toBeNull();
    await writeFile(join(folder, NAME_SCAN_FILE), "/Quux/\n");
    expect(loadNamePatterns(folder, {})?.patterns.map(String)).toEqual(["/Quux/"]);
  });

  it("stops the scan when the variable names no file", () => {
    expect(() => loadNamePatterns(folder, { [NAME_SCAN_VARIABLE]: join(folder, "missing.txt") })).toThrow(`${NAME_SCAN_VARIABLE} names`);
  });
});
