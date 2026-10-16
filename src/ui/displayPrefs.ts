import type { VideoDescription } from "../core/types";

// How the picture is drawn: its scaling, pixel shape and scanlines, and the
// fast-forward speed. Kept for every game alike: the research behind these
// options (docs/research/emulator-ux.md, section 3) names no setting players
// expect per game.

/** integer: the largest whole multiple of the frame that fits. fill: as large as fits. */
export type Scaling = "integer" | "fill";
/** core: the pixel shape the core describes (8:7 for the NES). square: one to one. */
export type PixelAspect = "core" | "square";

export interface DisplayPrefs {
  /**
   * The player's choice, or "auto" until they make one: integer on the page,
   * fill in the touch layout's screen rectangle, where a phone's picture
   * would otherwise draw at 1x in a much larger area.
   */
  scaling: Scaling | "auto";
  aspect: PixelAspect;
  scanlines: boolean;
  /** How dark each scanline's gap is, from SCANLINE_RANGE. */
  scanlineIntensity: number;
  /** Frames run per frame due while fast-forward is held or on, from FAST_FORWARD_SPEEDS. */
  fastForwardSpeed: number;
  /** The panel beside the picture listing the bindings; never shown in touch play. */
  showControls: boolean;
  /** The Developer tools setting: the tools panel, its F4 and the console's key are offered only while it is on. */
  developerTools: boolean;
  /** The developer console beside the picture, shown by its key; shown only while developerTools is on, and never in touch play. */
  showConsole: boolean;
}

export const SCANLINE_RANGE = { min: 0.1, max: 0.9, step: 0.05 } as const;
export const FAST_FORWARD_SPEEDS: readonly number[] = [2, 3, 4];

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = { scaling: "auto", aspect: "core", scanlines: false, scanlineIntensity: 0.35, fastForwardSpeed: 3, showControls: false, developerTools: false, showConsole: false };

const STORAGE_KEY = "retrowright.display";
/**
 * Version 1 (no `version` field) had no "auto" and wrote "integer" from the
 * first start whether or not the player chose it; read back, its "integer"
 * becomes "auto", while its "fill", never the default, stays a choice.
 * Versions 1 and 2 had no controls panel; read back, it is off. Versions 1
 * to 3 had no developer console; read back, it is off. Version 4's
 * showConsole was the Display setting "Developer console", which also opened
 * the console; read back, it turns Developer tools on with the console
 * showing, as before.
 */
const STORED_VERSION = 5;
const BEFORE_DEVELOPER_TOOLS_VERSION = 4;
const BEFORE_CONSOLE_VERSION = 3;

/** The scaling drawn: the player's choice, or by default fill in the touch layout's rectangle and integer elsewhere. */
export function effectiveScaling(scaling: DisplayPrefs["scaling"], inTouchLayout: boolean): Scaling {
  if (scaling !== "auto") return scaling;
  return inTouchLayout ? "fill" : "integer";
}

export interface LoadedDisplayPrefs {
  prefs: DisplayPrefs;
  /** Said to the player when saved settings could not be read and the defaults are used instead. */
  problem?: string;
}

function readPrefs(value: unknown): DisplayPrefs | null {
  if (typeof value !== "object" || value === null) return null;
  const prefs = value as Partial<DisplayPrefs> & { version?: unknown };
  let scaling: DisplayPrefs["scaling"];
  if (prefs.version === undefined) {
    if (prefs.scaling !== "integer" && prefs.scaling !== "fill") return null;
    scaling = prefs.scaling === "integer" ? "auto" : "fill";
  } else if (prefs.version === 2 || prefs.version === BEFORE_CONSOLE_VERSION || prefs.version === BEFORE_DEVELOPER_TOOLS_VERSION || prefs.version === STORED_VERSION) {
    if (prefs.scaling !== "auto" && prefs.scaling !== "integer" && prefs.scaling !== "fill") return null;
    scaling = prefs.scaling;
  } else {
    return null;
  }
  let showControls = false;
  if (prefs.version === BEFORE_CONSOLE_VERSION || prefs.version === BEFORE_DEVELOPER_TOOLS_VERSION || prefs.version === STORED_VERSION) {
    if (typeof prefs.showControls !== "boolean") return null;
    showControls = prefs.showControls;
  }
  let showConsole = false;
  if (prefs.version === BEFORE_DEVELOPER_TOOLS_VERSION || prefs.version === STORED_VERSION) {
    if (typeof prefs.showConsole !== "boolean") return null;
    showConsole = prefs.showConsole;
  }
  let developerTools = showConsole;
  if (prefs.version === STORED_VERSION) {
    if (typeof prefs.developerTools !== "boolean") return null;
    developerTools = prefs.developerTools;
  }
  if (prefs.aspect !== "core" && prefs.aspect !== "square") return null;
  if (typeof prefs.scanlines !== "boolean") return null;
  const intensity = prefs.scanlineIntensity;
  if (typeof intensity !== "number" || intensity < SCANLINE_RANGE.min || intensity > SCANLINE_RANGE.max) return null;
  if (typeof prefs.fastForwardSpeed !== "number" || !FAST_FORWARD_SPEEDS.includes(prefs.fastForwardSpeed)) return null;
  return { scaling, aspect: prefs.aspect, scanlines: prefs.scanlines, scanlineIntensity: intensity, fastForwardSpeed: prefs.fastForwardSpeed, showControls, developerTools, showConsole };
}

export function loadDisplayPrefs(storage: Storage | undefined): LoadedDisplayPrefs {
  const raw = storage?.getItem(STORAGE_KEY);
  if (raw === null || raw === undefined) return { prefs: DEFAULT_DISPLAY_PREFS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const prefs = readPrefs(parsed);
  if (!prefs) return { prefs: DEFAULT_DISPLAY_PREFS, problem: "Saved display settings could not be read, so the defaults are in use." };
  return { prefs };
}

export function saveDisplayPrefs(storage: Storage | undefined, prefs: DisplayPrefs): void {
  storage?.setItem(STORAGE_KEY, JSON.stringify({ version: STORED_VERSION, ...prefs }));
}

/** The core's pixel shape as text, e.g. "8:7". */
export function aspectText(video: VideoDescription): string {
  return `${video.pixelAspect.width}:${video.pixelAspect.height}`;
}

export function hasSquarePixels(video: VideoDescription): boolean {
  return video.pixelAspect.width === video.pixelAspect.height;
}

export interface PictureSize {
  /** CSS pixels. */
  width: number;
  height: number;
  /** CSS pixels per frame line: a whole number when scaling is "integer". */
  scale: number;
}

/**
 * The picture's size in a box of `boxWidth` by `boxHeight` CSS pixels. The
 * pixel aspect widens each pixel and leaves its height alone, so with
 * integer scaling every frame line is a whole number of CSS pixels tall and
 * the width is the core's aspect times that, as RetroArch's integer scale
 * does for a non-square pixel aspect. Never below one line per pixel.
 */
export function pictureSize(video: VideoDescription, boxWidth: number, boxHeight: number, prefs: { scaling: Scaling; aspect: PixelAspect }): PictureSize {
  const pixelWidth = prefs.aspect === "core" ? video.pixelAspect.width / video.pixelAspect.height : 1;
  const fit = Math.min(boxWidth / (video.width * pixelWidth), boxHeight / video.height);
  const scale = prefs.scaling === "integer" ? Math.max(1, Math.floor(fit)) : fit;
  return { width: video.width * pixelWidth * scale, height: video.height * scale, scale };
}
