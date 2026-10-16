import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// retrowright names no game project built on it: a game's own tunables,
// console commands and links come from files found at run time
// (src/ui/gameFiles.ts). A project that wants its names kept out of the
// app's source, documentation and build lists them in a file of its own,
// outside this repository's history, and the tests scan for them
// (harness/nameScan.test.ts, and the build in harness/testRomsPlugin.test.ts).
//
// The file holds one pattern a line; blank lines and lines starting with #
// are skipped. A pattern written `/source/flags` is that regular expression;
// any other line is a regular expression matched in any case.

/** Names the pattern file; a variable naming no file stops the scan. */
export const NAME_SCAN_VARIABLE = "RETROWRIGHT_NAME_SCAN";
/** The pattern file looked for at the repository root when the variable is unset; git-ignored. */
export const NAME_SCAN_FILE = ".name-scan";

export interface NamePatterns {
  /** The file the patterns were read from. */
  source: string;
  patterns: RegExp[];
}

/** The patterns in a pattern file's text; a line that is no valid regular expression throws, naming it. */
export function parseNamePatterns(text: string, source: string): RegExp[] {
  const patterns: RegExp[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const literal = /^\/(.+)\/([a-z]*)$/.exec(line);
    try {
      // g and y would make exec carry its position from one text to the next.
      patterns.push(literal ? new RegExp(literal[1], literal[2].replace(/[gy]/g, "")) : new RegExp(line, "i"));
    } catch (error) {
      throw new Error(`${source}, line ${index + 1}: ${(error as Error).message}`);
    }
  });
  return patterns;
}

/**
 * The patterns of the file `env` names, else of `.name-scan` under `root`, or
 * null when the variable is unset and there is no such file: the public
 * repository has none, and then there is nothing to scan for.
 */
export function loadNamePatterns(root: string, env: NodeJS.ProcessEnv = process.env): NamePatterns | null {
  const named = env[NAME_SCAN_VARIABLE];
  if (named !== undefined && named !== "") {
    if (!existsSync(named)) throw new Error(`${NAME_SCAN_VARIABLE} names ${named}, which does not exist.`);
    return { source: named, patterns: parseNamePatterns(readFileSync(named, "utf8"), named) };
  }
  const local = join(root, NAME_SCAN_FILE);
  if (!existsSync(local)) return null;
  return { source: local, patterns: parseNamePatterns(readFileSync(local, "utf8"), local) };
}

/** Each pattern found in `text`, as the text it matched. */
export function namesIn(text: string, patterns: readonly RegExp[]): string[] {
  return patterns.flatMap((pattern) => {
    const match = pattern.exec(text);
    return match ? [match[0]] : [];
  });
}
