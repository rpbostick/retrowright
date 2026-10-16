import type { SaveState } from "../core/types";
import type { PadMask } from "./pads";

// The .rwmovie.json input movie. Modelled on FCEUX's .fm2 and BizHawk's .bk2:
// a header naming the ROM by hash and the core, how the machine starts, and
// the pads per emulated frame. Unlike .fm2, which writes one line per frame,
// inputs are stored as runs: an entry holds from its frame until the next.
//
// Frame numbers count emulated frames from the start: frame 0 is the first
// core.frame() call. An input run or event "at frame N" applies just before
// frame N runs; a checkpoint "at frame N" is checked after N frames have run.

export const MOVIE_FORMAT = "retrowright-movie";
export const MOVIE_VERSION = 1;
export const MOVIE_EXTENSION = ".rwmovie.json";

export type MovieStart =
  /** Power-on; battery RAM is all zeros, or the given 8 KB image in base64. */
  | { kind: "power-on"; batteryRam: string | null }
  /** Loads the ROM, then this save state, before frame 0. */
  | { kind: "save-state"; state: SaveState };

export interface InputRun {
  frame: number;
  pad1: PadMask;
  pad2: PadMask;
}

/** As in .fm2, a reset is a command at a frame rather than an input. */
export interface MovieEvent {
  frame: number;
  kind: "reset";
}

export interface CheckpointExpectation {
  /** Assertions such as `party[0].hp >= 30`, `map == "Coneria Castle 1F"` or `$0048 == 8`. */
  memory?: string[];
  /** screenHash() of the picture of the last frame run. */
  screenHash?: string;
}

export interface Checkpoint {
  frame: number;
  name: string;
  expect: CheckpointExpectation;
}

export interface Movie {
  format: typeof MOVIE_FORMAT;
  version: typeof MOVIE_VERSION;
  rom: { name: string; sha256: string };
  core: { name: string; version: string };
  start: MovieStart;
  /** Frames the movie runs in all. */
  frames: number;
  /** Sorted by frame, one entry per change; pads are 0 before the first. */
  inputs: InputRun[];
  events: MovieEvent[];
  checkpoints: Checkpoint[];
}

class MovieFormatError extends Error {
  constructor(message: string) {
    super(`Not a valid retrowright movie: ${message}`);
  }
}

function fail(message: string): never {
  throw new MovieFormatError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function frameNumber(value: unknown, where: string, frames: number): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > frames) {
    fail(`${where}: frame must be a whole number from 0 to ${frames}, got ${JSON.stringify(value)}.`);
  }
  return value as number;
}

function padMask(value: unknown, where: string): PadMask {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xff) {
    fail(`${where}: a pad must be a bit mask from 0 to 255, got ${JSON.stringify(value)}.`);
  }
  return value as number;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string" || value === "") fail(`${where} must be a non-empty string.`);
  return value;
}

function parseStart(value: unknown): MovieStart {
  if (!isRecord(value)) fail("start is missing.");
  if (value.kind === "power-on") {
    if (value.batteryRam !== null && typeof value.batteryRam !== "string") fail("start.batteryRam must be null or base64 text.");
    return { kind: "power-on", batteryRam: value.batteryRam };
  }
  if (value.kind === "save-state") {
    const state = value.state;
    if (!isRecord(state) || typeof state.core !== "string" || !("data" in state)) fail("start.state is not a save state.");
    return { kind: "save-state", state: { core: state.core, data: state.data } };
  }
  return fail(`start.kind must be "power-on" or "save-state", got ${JSON.stringify(value.kind)}.`);
}

function sortedByFrame<T extends { frame: number }>(items: T[], what: string, strictly: boolean): T[] {
  for (let index = 1; index < items.length; index++) {
    const previous = items[index - 1].frame;
    const current = items[index].frame;
    if (current < previous || (strictly && current === previous)) fail(`${what} must be in frame order (entry ${index}).`);
  }
  return items;
}

/** Checks a parsed JSON value field by field; throws naming the first problem. */
export function parseMovie(json: unknown): Movie {
  if (!isRecord(json)) fail("the file is not a JSON object.");
  if (json.format !== MOVIE_FORMAT) fail(`format must be "${MOVIE_FORMAT}", got ${JSON.stringify(json.format)}.`);
  if (json.version !== MOVIE_VERSION) fail(`version ${JSON.stringify(json.version)} is not supported; this build reads version ${MOVIE_VERSION}.`);
  if (!isRecord(json.rom)) fail("rom is missing.");
  const sha256 = text(json.rom.sha256, "rom.sha256");
  if (!/^[0-9a-f]{64}$/.test(sha256)) fail("rom.sha256 must be 64 lowercase hex digits.");
  if (!isRecord(json.core)) fail("core is missing.");
  if (!Number.isInteger(json.frames) || (json.frames as number) < 0) fail("frames must be a whole number.");
  const frames = json.frames as number;
  if (!Array.isArray(json.inputs) || !Array.isArray(json.events) || !Array.isArray(json.checkpoints)) {
    fail("inputs, events and checkpoints must be arrays.");
  }
  const inputs = json.inputs.map((run: unknown, index: number): InputRun => {
    if (!isRecord(run)) fail(`inputs[${index}] is not an object.`);
    return {
      frame: frameNumber(run.frame, `inputs[${index}]`, frames),
      pad1: padMask(run.pad1, `inputs[${index}].pad1`),
      pad2: padMask(run.pad2, `inputs[${index}].pad2`),
    };
  });
  const events = json.events.map((event: unknown, index: number): MovieEvent => {
    if (!isRecord(event)) fail(`events[${index}] is not an object.`);
    if (event.kind !== "reset") fail(`events[${index}].kind must be "reset".`);
    return { frame: frameNumber(event.frame, `events[${index}]`, frames), kind: "reset" };
  });
  const checkpoints = json.checkpoints.map((checkpoint: unknown, index: number): Checkpoint => {
    if (!isRecord(checkpoint)) fail(`checkpoints[${index}] is not an object.`);
    const expectation = checkpoint.expect;
    if (!isRecord(expectation)) fail(`checkpoints[${index}].expect is missing.`);
    const result: CheckpointExpectation = {};
    if (expectation.memory !== undefined) {
      if (!Array.isArray(expectation.memory) || !expectation.memory.every((line) => typeof line === "string")) {
        fail(`checkpoints[${index}].expect.memory must be a list of assertions.`);
      }
      result.memory = expectation.memory as string[];
    }
    if (expectation.screenHash !== undefined) result.screenHash = text(expectation.screenHash, `checkpoints[${index}].expect.screenHash`);
    return { frame: frameNumber(checkpoint.frame, `checkpoints[${index}]`, frames), name: text(checkpoint.name, `checkpoints[${index}].name`), expect: result };
  });
  return {
    format: MOVIE_FORMAT,
    version: MOVIE_VERSION,
    rom: { name: text(json.rom.name, "rom.name"), sha256 },
    core: { name: text(json.core.name, "core.name"), version: text(json.core.version, "core.version") },
    start: parseStart(json.start),
    frames,
    inputs: sortedByFrame(inputs, "inputs", true),
    events: sortedByFrame(events, "events", false),
    checkpoints: sortedByFrame(checkpoints, "checkpoints", false),
  };
}

/** Pretty JSON with one input run per line, so a diff of two movies reads by frame. */
export function serializeMovie(movie: Movie): string {
  const { inputs, events, checkpoints, ...header } = movie;
  const lines = (items: unknown[]) => (items.length ? `[\n    ${items.map((item) => JSON.stringify(item)).join(",\n    ")}\n  ]` : "[]");
  const headerJson = JSON.stringify(header, null, 2).replace(/\n}$/, "");
  return `${headerJson},\n  "inputs": ${lines(inputs)},\n  "events": ${lines(events)},\n  "checkpoints": ${JSON.stringify(checkpoints, null, 2).replace(/\n/g, "\n  ")}\n}\n`;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
