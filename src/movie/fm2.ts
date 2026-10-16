import { decodeBase64, type Movie } from "./format";
import type { PadMask } from "./pads";
import { MovieRecorder } from "./recorder";

// FCEUX's .fm2 movie (fceux.com/web/help/fm2.html): a text header of
// `key value` lines, then one `|commands|port0|port1|port2|` line per frame.
// Only what an NTSC game on two standard pads uses is read; anything else
// (binary logs, PAL, Four Score, a Zapper, FDS, a movie starting from a save
// state) is refused by name rather than half-converted.

export const FM2_SOFT_RESET = 1;
export const FM2_POWER = 2;
const FM2_KNOWN_COMMANDS = FM2_SOFT_RESET | FM2_POWER;

const GAMEPAD = 1;
/** The text log's button order; the first character is the mask's high bit. */
const GAMEPAD_ORDER = "RLDUTSBA";

export interface Fm2Header {
  version: number;
  emuVersion: number;
  romFilename: string;
  /** Hex MD5 FCEUX took of the ROM it recorded on. */
  romChecksumMd5: string;
  guid: string;
  rerecordCount: number | null;
  /** Device on each pad port: 0 none, 1 gamepad. */
  ports: [number, number];
  comments: string[];
}

export interface Fm2Frame {
  /** Bit field: 1 soft reset, 2 power, applied at the start of the frame. */
  commands: number;
  pad1: PadMask;
  pad2: PadMask;
}

export interface Fm2Movie {
  header: Fm2Header;
  frames: Fm2Frame[];
}

class Fm2FormatError extends Error {
  constructor(message: string) {
    super(`Cannot read this .fm2 movie: ${message}`);
  }
}

function fail(message: string): never {
  throw new Fm2FormatError(message);
}

function integerKey(keys: Map<string, string>, key: string, required: boolean): number | null {
  const value = keys.get(key);
  if (value === undefined) {
    if (required) fail(`the header has no ${key}.`);
    return null;
  }
  if (!/^-?\d+$/.test(value)) fail(`${key} must be a whole number, got ${JSON.stringify(value)}.`);
  return Number(value);
}

function requiredText(keys: Map<string, string>, key: string): string {
  const value = keys.get(key);
  if (value === undefined) fail(`the header has no ${key}.`);
  return value;
}

/** FCEUX writes the 16 MD5 bytes as `base64:...`; older files may hold them as 32 hex digits. */
function romChecksumHex(value: string): string {
  if (value.startsWith("base64:")) {
    const bytes = decodeBase64(value.slice("base64:".length));
    if (bytes.length !== 16) fail(`romChecksum must hold a 16-byte MD5, got ${bytes.length} bytes.`);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  if (/^[0-9a-fA-F]{32}$/.test(value)) return value.toLowerCase();
  return fail(`romChecksum ${JSON.stringify(value)} is neither base64: nor 32 hex digits.`);
}

function parseGamepad(field: string, where: string): PadMask {
  if (field.length !== GAMEPAD_ORDER.length) fail(`${where}: a gamepad field has 8 characters (RLDUTSBA), got ${JSON.stringify(field)}.`);
  let mask = 0;
  for (let index = 0; index < GAMEPAD_ORDER.length; index++) {
    const char = field[index];
    if (char !== "." && char !== " ") mask |= 1 << (GAMEPAD_ORDER.length - 1 - index);
  }
  return mask;
}

function parsePort(field: string, device: number, where: string): PadMask {
  if (device === GAMEPAD) return parseGamepad(field, where);
  if (field !== "") fail(`${where}: the port has no device, so its field must be empty, got ${JSON.stringify(field)}.`);
  return 0;
}

function parseFrame(line: string, ports: [number, number], lineNumber: number): Fm2Frame {
  const where = `line ${lineNumber}`;
  const fields = line.split("|");
  // "|c|p0|p1|p2|" splits into ["", c, p0, p1, p2, ""].
  if (fields.length !== 6 || fields[0] !== "" || fields[5] !== "") fail(`${where}: expected |commands|port0|port1|port2|, got ${JSON.stringify(line)}.`);
  if (!/^\d+$/.test(fields[1])) fail(`${where}: commands must be a whole number, got ${JSON.stringify(fields[1])}.`);
  const commands = Number(fields[1]);
  if (commands & ~FM2_KNOWN_COMMANDS) fail(`${where}: command bits ${commands} include FDS or VS commands, which are not supported.`);
  if (fields[4] !== "") fail(`${where}: the expansion port (port2) must be empty.`);
  return { commands, pad1: parsePort(fields[2], ports[0], `${where} port0`), pad2: parsePort(fields[3], ports[1], `${where} port1`) };
}

export function parseFm2(text: string): Fm2Movie {
  const lines = text.split(/\r?\n/);
  const keys = new Map<string, string>();
  const comments: string[] = [];
  let index = 0;
  for (; index < lines.length && !lines[index].startsWith("|"); index++) {
    const line = lines[index];
    if (line.trim() === "") continue;
    const space = line.indexOf(" ");
    const key = space < 0 ? line : line.slice(0, space);
    const value = space < 0 ? "" : line.slice(space + 1);
    if (index === 0 && key !== "version") fail("the first line must be the version key.");
    if (key === "comment") comments.push(value);
    else if (key !== "subtitle") keys.set(key, value);
  }
  if (keys.size === 0) fail("there is no header.");

  const version = integerKey(keys, "version", true)!;
  if (version !== 3) fail(`version ${version} is not supported; FCEUX writes version 3.`);
  if (integerKey(keys, "binary", false)) fail("the input log is binary; only the text log is supported.");
  if (integerKey(keys, "palFlag", false)) fail("the movie is PAL; only NTSC timing is supported.");
  if (integerKey(keys, "fourscore", false)) fail("the movie uses a Four Score; only two pads are supported.");
  if (integerKey(keys, "FDS", false)) fail("the movie is of a Famicom Disk System game.");
  if (keys.has("savestate")) fail("the movie starts from an embedded save state; only power-on movies are supported.");
  const ports: [number, number] = [integerKey(keys, "port0", true)!, integerKey(keys, "port1", true)!];
  ports.forEach((device, port) => {
    if (device !== 0 && device !== GAMEPAD) fail(`port${port} holds device ${device}; only a gamepad (1) or nothing (0) is supported.`);
  });
  const port2 = integerKey(keys, "port2", true);
  if (port2 !== 0) fail(`port2 holds device ${port2}; the expansion port must be empty (0).`);

  const header: Fm2Header = {
    version,
    emuVersion: integerKey(keys, "emuVersion", true)!,
    romFilename: requiredText(keys, "romFilename"),
    romChecksumMd5: romChecksumHex(requiredText(keys, "romChecksum")),
    guid: requiredText(keys, "guid"),
    rerecordCount: integerKey(keys, "rerecordCount", false),
    ports,
    comments,
  };

  const length = integerKey(keys, "length", false);
  const frames: Fm2Frame[] = [];
  for (; index < lines.length; index++) {
    if (length !== null && length >= 0 && frames.length === length) break;
    const line = lines[index];
    if (line === "") continue;
    frames.push(parseFrame(line, ports, index + 1));
  }
  if (length !== null && length >= 0 && frames.length < length) fail(`the header gives length ${length} but the log has ${frames.length} frames.`);
  return { header, frames };
}

export interface Fm2ConversionOptions {
  rom: Movie["rom"];
  /**
   * Shifts the movie against our frame 0. Positive: that many frames with
   * nothing pressed run first. Negative: that many of the movie's first frames
   * are dropped, which is refused unless they press nothing.
   */
  leadFrames?: number;
}

/**
 * Converts to a power-on movie with empty battery RAM, the start FCEUX gives
 * a movie without a savestate when the game has no .sav. A soft reset becomes
 * a reset event; power at frame 0 is the start itself, and power later on is
 * refused because the movie format has no power-cycle event.
 */
export function fm2ToMovie(fm2: Fm2Movie, options: Fm2ConversionOptions): Movie {
  const lead = options.leadFrames ?? 0;
  if (!Number.isInteger(lead)) fail(`leadFrames must be a whole number, got ${lead}.`);
  const dropped = fm2.frames.slice(0, Math.max(0, -lead));
  // Power at frame 0 is the start itself, so dropping it loses nothing.
  const droppedInput = dropped.findIndex((frame, index) => (frame.commands & ~(index === 0 ? FM2_POWER : 0)) || frame.pad1 || frame.pad2);
  if (droppedInput >= 0) fail(`leadFrames ${lead} would drop frame ${droppedInput}, which has input.`);

  const recorder = new MovieRecorder({
    rom: options.rom,
    core: { name: "fceux", version: String(fm2.header.emuVersion) },
    start: { kind: "power-on", batteryRam: null },
  });
  for (let frame = 0; frame < lead; frame++) recorder.recordFrame(0, 0);
  fm2.frames.slice(dropped.length).forEach((frame, index) => {
    const source = index + dropped.length;
    if (frame.commands & FM2_POWER) {
      if (source !== 0) fail(`frame ${source} powers the console off and on; the movie format has no power-cycle event.`);
    }
    if (frame.commands & FM2_SOFT_RESET) recorder.recordReset();
    recorder.recordFrame(frame.pad1, frame.pad2);
  });
  return recorder.finish();
}
