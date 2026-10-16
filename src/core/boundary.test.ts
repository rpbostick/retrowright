import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCANNED = ["src", "harness", "e2e"];
const SOURCE = /\.(ts|tsx|mjs|js)$/;
const JSNES_IMPORT = /from\s+["']jsnes["']|import\(\s*["']jsnes["']\s*\)|require\(\s*["']jsnes["']\s*\)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE.test(entry.name) ? [path] : [];
  });
}

describe("the core boundary", () => {
  it("keeps jsnes imports inside src/core/, so other cores can replace it", () => {
    const files = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)));
    expect(files.length).toBeGreaterThan(20);
    const offenders = files
      .filter((file) => JSNES_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file).split(sep).join("/"))
      .filter((file) => !file.startsWith("src/core/"));
    expect(offenders).toEqual([]);
  });
});
