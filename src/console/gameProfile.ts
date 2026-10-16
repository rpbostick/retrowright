import { parseAddressText } from "../tools/numberText";
import { ramValue, type ConsoleMemory, type FrameWaiter, type GameCommand, type GameConsoleTable, type NamedValue } from "./gameTable";

// A game profile: a game's named RAM values and console commands as data, in a
// JSON file found for the game at run time (src/ui/gameFiles.ts), so the
// console's code names no game. A command is a list of steps: checks of RAM,
// writes to it and waits of a number of frames, with the typed arguments put
// into values and sentences where a step names them in braces.

export const PROFILE_FORMAT = "retrowright-game-profile";
export const PROFILE_VERSION = 1;

/** How a value reads: a number (decimal, hex or signed), or one decimal digit per byte, most significant first. */
export type ProfileValueFormat = "decimal" | "hex" | "signed" | "digits";

export interface ProfileValue {
  name: string;
  description: string;
  /** "$075F": where the value is in RAM. */
  address: string;
  /** Bytes, little-endian for a number, most significant first for digits; 1 by default. */
  bytes?: number;
  format?: ProfileValueFormat;
  /** Added to the stored number to show it, as 1 for a count the game keeps from 0. */
  shownOffset?: number;
  min?: number;
  max?: number;
  readOnly?: boolean;
}

/** A number typed as a command's argument. */
export interface NumberArgument {
  name: string;
  min: number;
  max: number;
}

/** A word typed as a command's argument, one of `choices`; each choice names the numbers its steps use, as {stage.world}. */
export interface ChoiceArgument {
  name: string;
  choices: Record<string, Record<string, number>>;
}

export type ProfileArgument = NumberArgument | ChoiceArgument;

/** A value read for a check: a value's name or a "$hex" RAM address, compared with a number. */
export interface Condition {
  read: string;
  equals?: number;
  notEquals?: number;
}

/** A number in a step: as written, an argument in braces ("{n}", "{stage.world}"), or a palette entry the PPU holds now. */
export type Operand = number | string | { palette: number };

export type ProfileStep =
  | { require: Condition[]; message: string }
  | { stopWhen: Condition[]; reply: string }
  | { when: Condition[]; steps: ProfileStep[] }
  | { set: string; value: Operand }
  | { write: string; value: Operand }
  | { write: string; bytes: Operand[]; offsetBy?: string }
  | { increase: string; by: number }
  | { wait: number };

export interface ProfileCommand {
  name: string;
  usage: string;
  help: string;
  args?: ProfileArgument[];
  steps: ProfileStep[];
  /** The answer once every step has run. */
  reply: string;
}

export interface GameProfile {
  format: typeof PROFILE_FORMAT;
  version: typeof PROFILE_VERSION;
  /** The game, as help names it. */
  title: string;
  /** The ROMs the profile is for, by SHA-256 of the whole file. */
  romSha256: string[];
  values: ProfileValue[];
  commands: ProfileCommand[];
}

/** The longest wait a step may ask for: a minute of frames. */
export const MAX_WAIT_FRAMES = 3600;

const FORMATS: readonly ProfileValueFormat[] = ["decimal", "hex", "signed", "digits"];
const STEP_KINDS = ["require", "stopWhen", "when", "set", "write", "increase", "wait"] as const;

class ProfileError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ramAddress(text: unknown, where: string): number {
  const address = typeof text === "string" && text.startsWith("$") ? parseAddressText(text) : null;
  if (address === null) throw new ProfileError(`${where} has no RAM address written as "$hex"`);
  return address;
}

function checkConditions(conditions: unknown, names: ReadonlySet<string>, where: string): void {
  if (!Array.isArray(conditions) || conditions.length === 0) throw new ProfileError(`${where} has no list of conditions`);
  for (const condition of conditions) {
    if (!isObject(condition) || typeof condition.read !== "string") throw new ProfileError(`${where} has a condition with nothing to read`);
    if (!names.has(condition.read)) ramAddress(condition.read, `${where}'s condition on ${condition.read}`);
    const compared = ["equals", "notEquals"].filter((key) => key in condition);
    if (compared.length !== 1 || !Number.isInteger(condition[compared[0]])) throw new ProfileError(`${where} has a condition that is not one of equals or notEquals a whole number`);
  }
}

function checkOperand(operand: unknown, where: string): void {
  if (Number.isInteger(operand) || (typeof operand === "string" && /^\{[A-Za-z][\w.]*\}$/.test(operand))) return;
  if (isObject(operand) && Number.isInteger(operand.palette) && (operand.palette as number) >= 0 && (operand.palette as number) < 32) return;
  throw new ProfileError(`${where} has ${JSON.stringify(operand)}, which is neither a whole number, an argument in braces nor a palette entry 0 to 31`);
}

function checkSteps(steps: unknown, names: ReadonlySet<string>, where: string): void {
  if (!Array.isArray(steps)) throw new ProfileError(`${where} has no list of steps`);
  steps.forEach((step, index) => {
    const at = `${where}, step ${index + 1},`;
    if (!isObject(step)) throw new ProfileError(`${at} is not an object`);
    const kinds = STEP_KINDS.filter((kind) => kind in step);
    if (kinds.length !== 1) throw new ProfileError(`${at} is not one of ${STEP_KINDS.join(", ")}`);
    switch (kinds[0]) {
      case "require":
        checkConditions(step.require, names, at);
        if (typeof step.message !== "string") throw new ProfileError(`${at} has no message`);
        break;
      case "stopWhen":
        checkConditions(step.stopWhen, names, at);
        if (typeof step.reply !== "string") throw new ProfileError(`${at} has no reply`);
        break;
      case "when":
        checkConditions(step.when, names, at);
        checkSteps(step.steps, names, at);
        break;
      case "set":
        if (typeof step.set !== "string" || !names.has(step.set)) throw new ProfileError(`${at} sets ${JSON.stringify(step.set)}, which is not a value of the profile`);
        checkOperand(step.value, at);
        break;
      case "write":
        ramAddress(step.write, at);
        if ("bytes" in step === "value" in step) throw new ProfileError(`${at} needs a value or bytes, not both`);
        if ("value" in step) checkOperand(step.value, at);
        else if (!Array.isArray(step.bytes) || step.bytes.length === 0) throw new ProfileError(`${at} has no list of bytes`);
        else step.bytes.forEach((byte) => checkOperand(byte, at));
        if (step.offsetBy !== undefined) ramAddress(step.offsetBy, `${at} offsetBy`);
        break;
      case "increase":
        ramAddress(step.increase, at);
        if (!Number.isInteger(step.by)) throw new ProfileError(`${at} has no whole number to increase by`);
        break;
      case "wait":
        if (!Number.isInteger(step.wait) || (step.wait as number) < 1 || (step.wait as number) > MAX_WAIT_FRAMES) throw new ProfileError(`${at} waits ${JSON.stringify(step.wait)} frames, not 1 to ${MAX_WAIT_FRAMES}`);
        break;
    }
  });
}

function checkArgument(argument: unknown, where: string): void {
  if (!isObject(argument) || typeof argument.name !== "string") throw new ProfileError(`${where} has an argument with no name`);
  if ("choices" in argument) {
    if (!isObject(argument.choices) || Object.keys(argument.choices).length === 0) throw new ProfileError(`${where}'s argument ${argument.name} has no choices`);
    for (const [word, numbers] of Object.entries(argument.choices)) {
      if (!isObject(numbers) || !Object.values(numbers).every(Number.isInteger)) throw new ProfileError(`${where}'s choice ${word} does not name whole numbers`);
    }
  } else if (!Number.isInteger(argument.min) || !Number.isInteger(argument.max) || (argument.min as number) > (argument.max as number)) {
    throw new ProfileError(`${where}'s argument ${argument.name} has neither choices nor whole numbers min <= max`);
  }
}

/** Checks a parsed game profile and throws, naming `source`, when it is not one this page reads. */
export function parseGameProfile(data: unknown, source: string): GameProfile {
  try {
    if (!isObject(data)) throw new ProfileError("it is not a JSON object");
    if (data.format !== PROFILE_FORMAT) throw new ProfileError(`its format is ${JSON.stringify(data.format)}, not "${PROFILE_FORMAT}"`);
    if (data.version !== PROFILE_VERSION) throw new ProfileError(`its version is ${JSON.stringify(data.version)}, not ${PROFILE_VERSION}`);
    if (typeof data.title !== "string" || data.title === "") throw new ProfileError("it has no title");
    if (!Array.isArray(data.romSha256) || data.romSha256.length === 0 || !data.romSha256.every((sha) => typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha))) {
      throw new ProfileError("romSha256 is not a list of SHA-256s in lower-case hex");
    }
    if (!Array.isArray(data.values) || !Array.isArray(data.commands)) throw new ProfileError("values and commands are not lists");
    const names = new Set<string>();
    for (const value of data.values as unknown[]) {
      if (!isObject(value) || typeof value.name !== "string" || names.has(value.name)) throw new ProfileError(`value ${JSON.stringify(isObject(value) ? value.name : value)} has no name of its own`);
      names.add(value.name);
      const where = `value ${value.name}`;
      if (typeof value.description !== "string") throw new ProfileError(`${where} has no description`);
      ramAddress(value.address, where);
      if (value.format !== undefined && !FORMATS.includes(value.format as ProfileValueFormat)) throw new ProfileError(`${where} has format ${JSON.stringify(value.format)}, not one of ${FORMATS.join(", ")}`);
      if (value.bytes !== undefined && (!Number.isInteger(value.bytes) || (value.bytes as number) < 1 || (value.bytes as number) > (value.format === "digits" ? 6 : 3))) {
        throw new ProfileError(`${where} has ${JSON.stringify(value.bytes)} bytes, not 1 to ${value.format === "digits" ? 6 : 3}`);
      }
      if (value.format === "signed" && (value.bytes ?? 1) !== 1) throw new ProfileError(`${where}: only a one-byte value can be signed`);
      for (const key of ["shownOffset", "min", "max"]) if (value[key] !== undefined && !Number.isInteger(value[key])) throw new ProfileError(`${where} has a ${key} that is not a whole number`);
    }
    const commands = new Set<string>();
    for (const command of data.commands as unknown[]) {
      if (!isObject(command) || typeof command.name !== "string" || !/^[a-z][\w-]*$/i.test(command.name) || commands.has(command.name)) {
        throw new ProfileError(`command ${JSON.stringify(isObject(command) ? command.name : command)} has no one-word name of its own`);
      }
      commands.add(command.name);
      const where = `command ${command.name}`;
      if (typeof command.usage !== "string" || typeof command.help !== "string" || typeof command.reply !== "string") throw new ProfileError(`${where} has no usage, help or reply`);
      if (command.args !== undefined && !Array.isArray(command.args)) throw new ProfileError(`${where}'s args is not a list`);
      ((command.args as unknown[] | undefined) ?? []).forEach((argument) => checkArgument(argument, where));
      checkSteps(command.steps, names, where);
    }
    return data as unknown as GameProfile;
  } catch (error) {
    if (error instanceof ProfileError) throw new Error(`${source} is not a game profile this page reads: ${error.message}.`);
    throw error;
  }
}

function digitsValue(value: ProfileValue, address: number): NamedValue {
  const digits = value.bytes ?? 1;
  const largest = 10 ** digits - 1;
  const named: NamedValue = {
    name: value.name,
    description: value.description,
    min: value.min ?? 0,
    max: value.max ?? largest,
    read: (memory) => Array.from({ length: digits }, (_, index) => memory.peek(address + index)).reduce((total, digit) => total * 10 + digit, 0),
  };
  if (!value.readOnly) {
    named.write = (memory, number) => {
      for (let index = 0; index < digits; index++) memory.poke(address + index, Math.floor(number / 10 ** (digits - 1 - index)) % 10);
    };
  }
  return named;
}

/** A profile value as the console's named value. */
export function profileValue(value: ProfileValue): NamedValue {
  const address = parseAddressText(value.address)!;
  if (value.format === "digits") return digitsValue(value, address);
  const named = ramValue({
    name: value.name,
    description: value.description,
    address,
    bytes: (value.bytes ?? 1) as 1 | 2 | 3,
    shownOffset: value.shownOffset,
    signed: value.format === "signed",
    min: value.min,
    max: value.max,
    readOnly: value.readOnly,
  });
  if (value.format === "hex") named.show = (number) => `$${number.toString(16).toUpperCase().padStart((value.bytes ?? 1) * 2, "0")}`;
  return named;
}

type Arguments = Record<string, string | number | Record<string, number>>;

function readArguments(command: ProfileCommand, typed: readonly string[]): Arguments {
  const declared = command.args ?? [];
  const usage = () => new Error(`Usage: ${command.usage}.`);
  if (typed.length !== declared.length) throw usage();
  const values: Arguments = {};
  declared.forEach((argument, index) => {
    const text = typed[index];
    if ("choices" in argument) {
      if (!Object.hasOwn(argument.choices, text)) throw usage();
      values[argument.name] = text;
      for (const [field, number] of Object.entries(argument.choices[text])) values[`${argument.name}.${field}`] = number;
    } else {
      const number = /^-?\d+$/.test(text) ? Number(text) : NaN;
      if (!(number >= argument.min && number <= argument.max)) throw new Error(`Usage: ${command.usage}, with ${argument.name} from ${argument.min} to ${argument.max}.`);
      values[argument.name] = number;
    }
  });
  return values;
}

/** A sentence with each {argument} put in. */
function fillIn(text: string, values: Arguments): string {
  return text.replace(/\{([A-Za-z][\w.]*)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

class CommandRun {
  constructor(
    private readonly memory: ConsoleMemory,
    private readonly wait: FrameWaiter,
    private readonly values: ReadonlyMap<string, NamedValue>,
    private readonly typed: Arguments,
    private readonly commandName: string,
  ) {}

  private operand(operand: Operand): number {
    if (typeof operand === "number") return operand;
    if (typeof operand === "object") {
      const palette = this.memory.palette();
      if (!palette) throw new Error(`This core cannot show its palette, so ${this.commandName} cannot be run.`);
      return palette[operand.palette];
    }
    const value = this.typed[operand.slice(1, -1)];
    if (typeof value !== "number") throw new Error(`${this.commandName}: ${operand} is not a number the command was given.`);
    return value;
  }

  private read(target: string): number {
    const named = this.values.get(target);
    return named ? named.read(this.memory) : this.memory.peek(parseAddressText(target)!);
  }

  private holds(conditions: readonly Condition[]): boolean {
    return conditions.every((condition) => {
      const value = this.read(condition.read);
      return condition.equals !== undefined ? value === condition.equals : value !== condition.notEquals;
    });
  }

  /** Runs the steps; resolves to a reply when one stops the command early, else null. */
  async steps(steps: readonly ProfileStep[]): Promise<string | null> {
    for (const step of steps) {
      if ("require" in step) {
        if (!this.holds(step.require)) throw new Error(fillIn(step.message, this.typed));
      } else if ("stopWhen" in step) {
        if (this.holds(step.stopWhen)) return fillIn(step.reply, this.typed);
      } else if ("when" in step) {
        if (this.holds(step.when)) {
          const reply = await this.steps(step.steps);
          if (reply !== null) return reply;
        }
      } else if ("set" in step) {
        this.values.get(step.set)!.write!(this.memory, this.operand(step.value));
      } else if ("write" in step) {
        const start = parseAddressText(step.write)! + ("offsetBy" in step && step.offsetBy ? this.memory.peek(parseAddressText(step.offsetBy)!) : 0);
        const bytes = "bytes" in step ? step.bytes.map((byte) => this.operand(byte)) : [this.operand(step.value)];
        bytes.forEach((byte, index) => this.memory.poke(start + index, byte & 0xff));
      } else if ("increase" in step) {
        const address = parseAddressText(step.increase)!;
        this.memory.poke(address, (this.memory.peek(address) + step.by) & 0xff);
      } else {
        await this.wait(step.wait);
      }
    }
    return null;
  }
}

function everyStep(steps: readonly ProfileStep[]): ProfileStep[] {
  return steps.flatMap((step) => ("when" in step ? [step, ...everyStep(step.steps)] : [step]));
}

/** The console table a profile gives: its values, and its commands run step by step. */
export function profileConsoleTable(profile: GameProfile): GameConsoleTable {
  const values = profile.values.map(profileValue);
  const byName = new Map(values.map((value) => [value.name, value]));
  for (const step of profile.commands.flatMap((command) => everyStep(command.steps))) {
    if ("set" in step && !byName.get(step.set)?.write) throw new Error(`${profile.title}: a command sets ${step.set}, which is read only.`);
  }
  const commands: GameCommand[] = profile.commands.map((command) => ({
    name: command.name,
    usage: command.usage,
    help: command.help,
    async run(args, memory, wait) {
      const typed = readArguments(command, args);
      const reply = await new CommandRun(memory, wait, byName, typed, command.name).steps(command.steps);
      return reply ?? fillIn(command.reply, typed);
    },
  }));
  return { title: profile.title, values, commands };
}
