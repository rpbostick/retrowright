import { commandNames, runLine, type CommandContext, type ConsoleWatch } from "./commands";
import { completions } from "./suggest";

// One console's scrollback, command history and watches. It outlives the
// panel, so hiding the console and showing it again keeps what it said.

export type ConsoleLineKind = "input" | "answer" | "error";

export interface ConsoleLine {
  id: number;
  kind: ConsoleLineKind;
  text: string;
}

export const SCROLLBACK_LINES = 500;
export const HISTORY_LENGTH = 100;

/** Commands whose second word is a value's name (help's is a command's). */
const TAKES_VALUE_NAME = new Set(["get", "set", "watch", "unwatch"]);

export class ConsoleSession {
  lines: ConsoleLine[] = [];
  /** Lines typed, oldest first, without repeats of the one before. */
  history: string[] = [];
  watches: ConsoleWatch[] = [];
  private nextId = 0;

  /** Runs a typed line and adds it and its answer, or its error, to the scrollback. */
  async submit(text: string, context: Omit<CommandContext, "watches" | "clearScrollback">): Promise<void> {
    const line = text.trim();
    if (line === "") return;
    if (this.history[this.history.length - 1] !== line) this.history = [...this.history, line].slice(-HISTORY_LENGTH);
    this.add("input", line);
    try {
      const answer = await runLine(line, { ...context, watches: this.watches, clearScrollback: () => (this.lines = []) });
      if (answer !== "") this.add("answer", answer);
    } catch (error) {
      this.add("error", error instanceof Error ? error.message : String(error));
    }
  }

  private add(kind: ConsoleLineKind, text: string): void {
    this.lines = [...this.lines, { id: this.nextId++, kind, text }].slice(-SCROLLBACK_LINES);
  }
}

/**
 * Tab completion of the line typed so far: the first word from the command
 * names, the second of get, set, watch and unwatch from the value names and
 * of help from the command names. `text` comes back completed as far as the
 * matches share, with a space after a single match; `options` lists the
 * matches when there are several.
 */
export function completeLine(text: string, context: Pick<CommandContext, "game" | "values">): { text: string; options: string[] } {
  const words = text.split(" ");
  let names: string[];
  if (words.length === 1) names = commandNames(context);
  else if (words.length === 2 && words[0] === "help") names = commandNames(context);
  else if (words.length === 2 && TAKES_VALUE_NAME.has(words[0])) names = context.values.map((value) => value.name);
  else return { text, options: [] };
  const typed = words[words.length - 1];
  const { shared, matches } = completions(typed, names);
  const head = words.slice(0, -1).map((word) => `${word} `).join("");
  if (matches.length === 1) return { text: `${head}${matches[0]} `, options: [] };
  return { text: `${head}${shared}`, options: matches.length > 1 ? matches : [] };
}
