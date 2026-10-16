import { RATE_RANGE } from "../player/player";
import { STATE_SLOTS, type StateSlot } from "../storage/gameStore";
import { parseAddressText, parseValueText } from "../tools/numberText";
import { formatAddress } from "../tools/watchList";
import type { ConsoleMemory, GameConsoleTable, NamedValue } from "./gameTable";
import { didYouMean } from "./suggest";

// The developer console's commands for any game, and the running of a typed
// line. Addresses are hex (with or without $ or 0x), as the tools write
// them; other numbers are decimal unless written $1F or 0x1F.

/** What the console drives: the player and the page's own actions (saves, screenshots, movies). */
export interface ConsoleHost {
  memory: ConsoleMemory;
  /** True while the console's pause holds the game. */
  isPaused(): boolean;
  pause(): void;
  resume(): void;
  /** Runs paused frames at once. */
  step(frames: number): void;
  /** Resolves once the game has run that many more frames: stepped at once while paused, else as it runs. */
  waitFrames(frames: number): Promise<void>;
  framesRun(): number;
  rate(): number;
  setRate(rate: number): void;
  reset(): void;
  /** Each answers with the sentence to show, or throws one. */
  saveState(slot: StateSlot): Promise<string>;
  loadState(slot: StateSlot): Promise<string>;
  screenshot(): Promise<string>;
  record(): string;
  stop(): string;
  replay(): string;
}

/** A value shown under the input each frame until unwatched. */
export interface ConsoleWatch {
  /** "$0010", or a named value's name. */
  label: string;
  read(): string;
}

export interface CommandContext {
  host: ConsoleHost;
  /** The open game's own table, or null for a game without one. */
  game: GameConsoleTable | null;
  /** Every value get, set and list reach: the game's and its tunables'. */
  values: readonly NamedValue[];
  watches: ConsoleWatch[];
  clearScrollback(): void;
}

interface Command {
  name: string;
  usage: string;
  help: string;
  run(args: readonly string[], context: CommandContext): string | Promise<string>;
}

export const MAX_STEP = 3600;
export const MAX_PEEK = 256;
const PEEK_ROW = 8;

const hex2 = (value: number) => value.toString(16).toUpperCase().padStart(2, "0");

function usageError(command: { usage: string }): Error {
  return new Error(`Usage: ${command.usage}.`);
}

function wholeNumber(text: string, what: string, min: number, max: number): number {
  const value = parseValueText(text);
  if (value === null) throw new Error(`${what} must be a whole number, not "${text}".`);
  if (value < min || value > max) throw new Error(`${what} must be ${min} to ${max}, not ${value}.`);
  return value;
}

function address(text: string): number {
  const value = parseAddressText(text);
  if (value === null) throw new Error(`"${text}" is not an address; write it in hex, as $0010 or 10.`);
  return value;
}

function slot(text: string): StateSlot {
  return wholeNumber(text, "The slot", STATE_SLOTS[0], STATE_SLOTS[STATE_SLOTS.length - 1]) as StateSlot;
}

function findValue(name: string, context: CommandContext): NamedValue {
  const found = context.values.find((value) => value.name === name);
  if (found) return found;
  const names = context.values.map((value) => value.name);
  if (names.length === 0) throw new Error(`This game has no named values, so there is no ${name}.`);
  throw new Error(`No value named ${name}${didYouMean(name, names) || "."}`);
}

const shown = (value: NamedValue, number: number) => (value.show ? value.show(number) : String(number));

function peekLines(memory: ConsoleMemory, first: number, count: number): string {
  if (count === 1) {
    const byte = memory.peek(first);
    return `${formatAddress(first)} = $${hex2(byte)} (${byte})`;
  }
  const rows: string[] = [];
  for (let row = first; row < first + count; row += PEEK_ROW) {
    const bytes: string[] = [];
    for (let at = row; at < Math.min(row + PEEK_ROW, first + count); at++) bytes.push(hex2(memory.peek(at)));
    rows.push(`${formatAddress(row)}: ${bytes.join(" ")}`);
  }
  return rows.join("\n");
}

/** The address or named value a watch or unwatch names, as its label and reader. */
function watchTarget(text: string, context: CommandContext): ConsoleWatch {
  const named = context.values.find((value) => value.name === text);
  if (named) return { label: named.name, read: () => shown(named, named.read(context.host.memory)) };
  if (parseAddressText(text) === null) {
    const names = context.values.map((value) => value.name);
    throw new Error(`"${text}" is neither an address nor a value's name${didYouMean(text, names) || "."}`);
  }
  const at = address(text);
  context.host.memory.peek(at);
  return {
    label: formatAddress(at),
    read: () => {
      const byte = context.host.memory.peek(at);
      return `$${hex2(byte)} (${byte})`;
    },
  };
}

const COMMANDS: readonly Command[] = [
  {
    name: "help",
    usage: "help [command]",
    help: "Lists the commands, or says what one does.",
    run(args, context) {
      const all = allCommands(context);
      if (args.length > 1) throw usageError(this);
      if (args.length === 1) {
        const command = all.find((candidate) => candidate.name === args[0]);
        if (!command) throw new Error(`No command named ${args[0]}${didYouMean(args[0], all.map((candidate) => candidate.name)) || "."}`);
        return `${command.usage}: ${command.help}`;
      }
      const lines = COMMANDS.map((command) => `${command.usage}: ${command.help}`);
      if (context.game && context.game.commands.length > 0) {
        lines.push(`For ${context.game.title}:`, ...context.game.commands.map((command) => `${command.usage}: ${command.help}`));
      }
      return lines.join("\n");
    },
  },
  {
    name: "pause",
    usage: "pause",
    help: "Pauses the game.",
    run(args, { host }) {
      if (args.length > 0) throw usageError(this);
      if (host.isPaused()) return `Already paused, at frame ${host.framesRun()}.`;
      host.pause();
      return `Paused at frame ${host.framesRun()}.`;
    },
  },
  {
    name: "resume",
    usage: "resume",
    help: "Runs the game again after pause or step.",
    run(args, { host }) {
      if (args.length > 0) throw usageError(this);
      if (!host.isPaused()) return "The game is already running.";
      host.resume();
      return "Running.";
    },
  },
  {
    name: "step",
    usage: `step [frames]`,
    help: `Pauses the game and runs that many frames (1 unless given, up to ${MAX_STEP}).`,
    run(args, { host }) {
      if (args.length > 1) throw usageError(this);
      const frames = args.length === 1 ? wholeNumber(args[0], "The frames to step", 1, MAX_STEP) : 1;
      if (!host.isPaused()) host.pause();
      host.step(frames);
      return `Stepped ${frames} frame${frames === 1 ? "" : "s"}; paused at frame ${host.framesRun()}.`;
    },
  },
  {
    name: "speed",
    usage: "speed [x]",
    help: `Sets the game's speed, ${RATE_RANGE.min} to ${RATE_RANGE.max} times normal (1); alone, says it. Sound is off at any speed but 1.`,
    run(args, { host }) {
      if (args.length > 1) throw usageError(this);
      if (args.length === 0) return `Speed ${host.rate()}×.`;
      const rate = /^\d*\.?\d+$/.test(args[0]) ? Number(args[0]) : NaN;
      if (!(rate >= RATE_RANGE.min && rate <= RATE_RANGE.max)) throw new Error(`The speed must be a number from ${RATE_RANGE.min} to ${RATE_RANGE.max}, not "${args[0]}".`);
      host.setRate(rate);
      return `Speed ${rate}×.`;
    },
  },
  {
    name: "reset",
    usage: "reset",
    help: "Resets the game, as the menu's Reset does.",
    run(args, { host }) {
      if (args.length > 0) throw usageError(this);
      host.reset();
      return "Reset.";
    },
  },
  {
    name: "peek",
    usage: "peek <addr> [n]",
    help: `Shows n bytes (1 unless given, up to ${MAX_PEEK}) from a hex address: RAM, cartridge RAM or ROM.`,
    run(args, { host }) {
      if (args.length < 1 || args.length > 2) throw usageError(this);
      const first = address(args[0]);
      const count = args.length === 2 ? wholeNumber(args[1], "The number of bytes", 1, MAX_PEEK) : 1;
      if (first + count > 0x10000) throw new Error(`${count} bytes from ${formatAddress(first)} run past $FFFF.`);
      return peekLines(host.memory, first, count);
    },
  },
  {
    name: "poke",
    usage: "poke <addr> <value>",
    help: "Writes a byte (0 to 255) to RAM at a hex address: $0000-$1FFF or cartridge RAM at $6000-$7FFF.",
    run(args, { host }) {
      if (args.length !== 2) throw usageError(this);
      const at = address(args[0]);
      const value = wholeNumber(args[1], "The value", 0, 0xff);
      host.memory.poke(at, value);
      return `${formatAddress(at)} = $${hex2(value)} (${value})`;
    },
  },
  {
    name: "watch",
    usage: "watch <addr or name>",
    help: "Shows a byte, or a named value, under the input every frame until unwatch.",
    run(args, context) {
      if (args.length !== 1) throw usageError(this);
      const target = watchTarget(args[0], context);
      if (context.watches.some((watch) => watch.label === target.label)) return `Already watching ${target.label}.`;
      context.watches.push(target);
      return `Watching ${target.label}: ${target.read()}.`;
    },
  },
  {
    name: "unwatch",
    usage: "unwatch [addr or name]",
    help: "Stops showing a watch, or every watch.",
    run(args, context) {
      if (args.length > 1) throw usageError(this);
      if (args.length === 0) {
        const count = context.watches.splice(0).length;
        return count === 0 ? "Nothing is watched." : `Stopped ${count} watch${count === 1 ? "" : "es"}.`;
      }
      const named = context.values.some((value) => value.name === args[0]);
      const label = named || parseAddressText(args[0]) === null ? args[0] : formatAddress(address(args[0]));
      const index = context.watches.findIndex((watch) => watch.label === label);
      if (index < 0) throw new Error(`${label} is not watched.`);
      context.watches.splice(index, 1);
      return `Stopped watching ${label}.`;
    },
  },
  {
    name: "save",
    usage: "save <slot>",
    help: `Saves a state to a slot (${STATE_SLOTS[0]} to ${STATE_SLOTS[STATE_SLOTS.length - 1]}), as F5 does.`,
    run(args, { host }) {
      if (args.length !== 1) throw usageError(this);
      return host.saveState(slot(args[0]));
    },
  },
  {
    name: "load",
    usage: "load <slot>",
    help: "Loads the state in a slot, as F7 does.",
    run(args, { host }) {
      if (args.length !== 1) throw usageError(this);
      return host.loadState(slot(args[0]));
    },
  },
  {
    name: "screenshot",
    usage: "screenshot",
    help: "Saves the picture as a PNG, as F2 does.",
    run(args, { host }) {
      if (args.length > 0) throw usageError(this);
      return host.screenshot();
    },
  },
  {
    name: "record",
    usage: "record",
    help: "Starts recording a movie, from the start chosen in Record and play movie.",
    run(args, { host }) {
      if (args.length > 0) throw usageError(this);
      return host.record();
    },
  },
  {
    name: "stop",
    usage: "stop",
    help: "Stops the recording and downloads it, or stops the movie playing.",
    run(args, { host }) {
      if (args.length > 0) throw usageError(this);
      return host.stop();
    },
  },
  {
    name: "replay",
    usage: "replay",
    help: "Downloads the instant replay, the last minute played, as a movie.",
    run(args, { host }) {
      if (args.length > 0) throw usageError(this);
      return host.replay();
    },
  },
  {
    name: "clear",
    usage: "clear",
    help: "Empties the console's scrollback.",
    run(args, context) {
      if (args.length > 0) throw usageError(this);
      context.clearScrollback();
      return "";
    },
  },
  {
    name: "list",
    usage: "list",
    help: "Lists the game's named values with what each is now.",
    run(args, context) {
      if (args.length > 0) throw usageError(this);
      if (context.values.length === 0) return "This game has no named values.";
      return context.values.map((value) => `${value.name} = ${shown(value, value.read(context.host.memory))}: ${value.description}`).join("\n");
    },
  },
  {
    name: "get",
    usage: "get <name>",
    help: "Shows a named value of the game.",
    run(args, context) {
      if (args.length !== 1) throw usageError(this);
      const value = findValue(args[0], context);
      return `${value.name} = ${shown(value, value.read(context.host.memory))}`;
    },
  },
  {
    name: "set",
    usage: "set <name> <value>",
    help: "Changes a named value of the game; a tunable changes as the Tune section changes it.",
    run(args, context) {
      if (args.length !== 2) throw usageError(this);
      const value = findValue(args[0], context);
      if (!value.write) throw new Error(`${value.name} can be read but not set.`);
      const number = wholeNumber(args[1], value.name, value.min, value.max);
      const before = value.read(context.host.memory);
      value.write(context.host.memory, number);
      return `${value.name} = ${shown(value, value.read(context.host.memory))} (was ${shown(value, before)})`;
    },
  },
];

function allCommands(context: Pick<CommandContext, "game">): readonly Pick<Command, "name" | "usage" | "help">[] {
  return [...COMMANDS, ...(context.game?.commands ?? [])];
}

/** Every command name the context offers, the game's after the console's own. */
export function commandNames(context: Pick<CommandContext, "game">): string[] {
  return allCommands(context).map((command) => command.name);
}

/**
 * Runs one typed line and resolves to its answer (empty for a blank line or
 * clear); rejects with a plain sentence when the line cannot be run.
 */
export async function runLine(line: string, context: CommandContext): Promise<string> {
  const [name, ...args] = line.trim().split(/\s+/).filter((word) => word !== "");
  if (name === undefined) return "";
  const own = COMMANDS.find((command) => command.name === name);
  if (own) return own.run(args, context);
  const gameCommand = context.game?.commands.find((command) => command.name === name);
  if (gameCommand) return gameCommand.run(args, context.host.memory, (frames) => context.host.waitFrames(frames));
  throw new Error(`No command named ${name}${didYouMean(name, commandNames(context)) || "."} Type help for the list.`);
}
