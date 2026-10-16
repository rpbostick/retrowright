import { Button, BUTTONS } from "../core/types";

// A touch layout is data, modelled on the ideas documented for Delta's
// .deltaskin format (per-orientation layouts, button frames, extended touch
// edges, a screen rectangle), in a format of our own. No Delta skin or image
// is used.

export const LAYOUT_FORMAT = "retrowright-touch-layout";
export type Orientation = "portrait" | "landscape";
export const ORIENTATIONS: readonly Orientation[] = ["portrait", "landscape"];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Where a frame goes when the page is wider or taller than the layout scaled
 * to fit: "start" keeps it at the left or top edge, "end" at the right or
 * bottom, "center" shares the spare room on both sides.
 */
export type AnchorSide = "start" | "center" | "end";
export interface Anchor {
  x: AnchorSide;
  y: AnchorSide;
}

/** fastForward: held, the game runs at the fast-forward speed. */
export type ControlKind = "dpad" | "button" | "menu" | "fastForward";
const CONTROL_KINDS: readonly ControlKind[] = ["dpad", "button", "menu", "fastForward"];
export type ControlShape = "circle" | "pill";

export interface LayoutControl {
  id: string;
  kind: ControlKind;
  /** The NES buttons a "button" control holds; two for the A+B area. */
  buttons: Button[];
  label: string;
  shape: ControlShape;
  frame: Rect;
  /** How far the touch area reaches past the drawn frame on each side. */
  extend: Edges;
  anchor: Anchor;
  /** For the D-pad: how wide, in degrees, each diagonal sector is (0 to 90). */
  diagonalDegrees: number;
}

export interface OrientationLayout {
  /** The units the frames are given in; the layout is scaled to the page keeping this aspect. */
  size: { width: number; height: number };
  screen: { frame: Rect; anchor: Anchor };
  controls: LayoutControl[];
}

export interface TouchLayout {
  name: string;
  orientations: Record<Orientation, OrientationLayout>;
}

type Json = Record<string, unknown>;

function fail(where: string, message: string): never {
  throw new Error(`Touch layout: ${where} ${message}`);
}

function object(value: unknown, where: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(where, "must be an object.");
  return value as Json;
}

function number(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(where, `must be a number, not ${JSON.stringify(value)}.`);
  return value;
}

function string(value: unknown, where: string): string {
  if (typeof value !== "string") fail(where, `must be a string, not ${JSON.stringify(value)}.`);
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], where: string): T {
  const found = options.find((option) => option === value);
  if (found === undefined) fail(where, `must be one of ${options.join(", ")}, not ${JSON.stringify(value)}.`);
  return found;
}

function readRect(value: unknown, where: string): Rect {
  const rect = object(value, where);
  const parsed = { x: number(rect.x, `${where}.x`), y: number(rect.y, `${where}.y`), width: number(rect.width, `${where}.width`), height: number(rect.height, `${where}.height`) };
  if (parsed.width <= 0 || parsed.height <= 0) fail(where, "must have a positive width and height.");
  return parsed;
}

function readEdges(value: unknown, where: string): Edges {
  const edges = object(value, where);
  const parsed = { top: number(edges.top, `${where}.top`), right: number(edges.right, `${where}.right`), bottom: number(edges.bottom, `${where}.bottom`), left: number(edges.left, `${where}.left`) };
  if (Object.values(parsed).some((edge) => edge < 0)) fail(where, "must not be negative.");
  return parsed;
}

const SIDES: readonly AnchorSide[] = ["start", "center", "end"];

function readAnchor(value: unknown, where: string): Anchor {
  const anchor = object(value, where);
  return { x: oneOf(anchor.x, SIDES, `${where}.x`), y: oneOf(anchor.y, SIDES, `${where}.y`) };
}

function readControl(value: unknown, where: string): LayoutControl {
  const control = object(value, where);
  const kind = oneOf(control.kind, CONTROL_KINDS, `${where}.kind`);
  const buttons = kind === "button" ? control.buttons : [];
  if (!Array.isArray(buttons) || (kind === "button" && buttons.length === 0)) fail(`${where}.buttons`, "must list the NES buttons it holds.");
  const diagonal = kind === "dpad" ? number(control.diagonalDegrees, `${where}.diagonalDegrees`) : 0;
  if (diagonal < 0 || diagonal > 90) fail(`${where}.diagonalDegrees`, "must be from 0 to 90.");
  return {
    id: string(control.id, `${where}.id`),
    kind,
    buttons: buttons.map((button, index) => oneOf(button, BUTTONS, `${where}.buttons[${index}]`)),
    label: kind === "dpad" ? "" : string(control.label, `${where}.label`),
    shape: kind === "dpad" ? "pill" : oneOf(control.shape, ["circle", "pill"] as const, `${where}.shape`),
    frame: readRect(control.frame, `${where}.frame`),
    extend: readEdges(control.extend, `${where}.extend`),
    anchor: readAnchor(control.anchor, `${where}.anchor`),
    diagonalDegrees: diagonal,
  };
}

function readOrientation(value: unknown, where: string): OrientationLayout {
  const layout = object(value, where);
  const size = object(layout.size, `${where}.size`);
  const screen = object(layout.screen, `${where}.screen`);
  if (!Array.isArray(layout.controls)) fail(`${where}.controls`, "must be a list.");
  const controls = layout.controls.map((control, index) => readControl(control, `${where}.controls[${index}]`));
  const ids = new Set<string>();
  for (const control of controls) {
    if (ids.has(control.id)) fail(`${where}.controls`, `has two controls named "${control.id}".`);
    ids.add(control.id);
  }
  return {
    size: { width: number(size.width, `${where}.size.width`), height: number(size.height, `${where}.size.height`) },
    screen: { frame: readRect(screen.frame, `${where}.screen.frame`), anchor: readAnchor(screen.anchor, `${where}.screen.anchor`) },
    controls,
  };
}

/** Reads a layout file; anything this version cannot use is refused by name. */
export function parseLayout(value: unknown): TouchLayout {
  const layout = object(value, "the file");
  if (layout.format !== LAYOUT_FORMAT) fail("format", `must be "${LAYOUT_FORMAT}", not ${JSON.stringify(layout.format)}.`);
  if (layout.version !== 1) fail("version", `${JSON.stringify(layout.version)} is not version 1.`);
  const orientations = object(layout.orientations, "orientations");
  return {
    name: string(layout.name, "name"),
    orientations: {
      portrait: readOrientation(orientations.portrait, "orientations.portrait"),
      landscape: readOrientation(orientations.landscape, "orientations.landscape"),
    },
  };
}

export function orientationOf(width: number, height: number): Orientation {
  return width > height ? "landscape" : "portrait";
}

/** A control placed on the page, in CSS pixels of the box the layout fills. */
export interface PlacedControl {
  control: LayoutControl;
  frame: Rect;
  /** The frame with its extended edges: where a touch reaches it. */
  touch: Rect;
}

export interface PlacedLayout {
  orientation: Orientation;
  /** The picture's rectangle; the picture keeps its own aspect inside it. */
  screen: Rect;
  controls: PlacedControl[];
}

function offset(side: AnchorSide, spare: number): number {
  return side === "start" ? 0 : side === "center" ? spare / 2 : spare;
}

function scaleAbout(rect: Rect, factor: number): Rect {
  const width = rect.width * factor;
  const height = rect.height * factor;
  return { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height };
}

/**
 * Scales the orientation's layout to fit a box of `width` by `height` CSS
 * pixels, keeping its aspect, and moves each frame into the spare room by its
 * anchor. `controlScale` (the Size setting) grows or shrinks each control
 * about its own centre, touch edges with it.
 */
export function placeLayout(layout: TouchLayout, width: number, height: number, controlScale = 1): PlacedLayout {
  const orientation = orientationOf(width, height);
  const { size, screen, controls } = layout.orientations[orientation];
  const scale = Math.min(width / size.width, height / size.height);
  const spareX = width - size.width * scale;
  const spareY = height - size.height * scale;
  const place = (rect: Rect, anchor: Anchor): Rect => ({
    x: rect.x * scale + offset(anchor.x, spareX),
    y: rect.y * scale + offset(anchor.y, spareY),
    width: rect.width * scale,
    height: rect.height * scale,
  });
  return {
    orientation,
    screen: place(screen.frame, screen.anchor),
    controls: controls.map((control) => {
      const { frame, extend } = control;
      const touch = { x: frame.x - extend.left, y: frame.y - extend.top, width: frame.width + extend.left + extend.right, height: frame.height + extend.top + extend.bottom };
      return {
        control,
        frame: scaleAbout(place(frame, control.anchor), controlScale),
        touch: scaleAbout(place(touch, control.anchor), controlScale),
      };
    }),
  };
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/** True when the two rectangles share some area; touching edges do not count. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function centre(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * The control a touch at (x, y) presses: one whose drawn frame holds the
 * point (the smallest, so the A+B area between A and B wins over their edges),
 * else the one whose touch area holds it with the nearest centre.
 */
export function controlAt(controls: readonly PlacedControl[], x: number, y: number): PlacedControl | null {
  const area = (rect: Rect) => rect.width * rect.height;
  const inFrame = controls.filter((placed) => contains(placed.frame, x, y)).sort((a, b) => area(a.frame) - area(b.frame));
  if (inFrame.length > 0) return inFrame[0];
  const distance = (placed: PlacedControl) => Math.hypot(centre(placed.frame).x - x, centre(placed.frame).y - y);
  const inTouch = controls.filter((placed) => contains(placed.touch, x, y)).sort((a, b) => distance(a) - distance(b));
  return inTouch[0] ?? null;
}

/** Inside this fraction of the D-pad's half-width from its centre, no direction is pressed. */
export const DPAD_DEAD_ZONE = 0.18;

/**
 * The directions a finger at (x, y) holds on a D-pad drawn in `frame`. Each
 * diagonal sector is `diagonalDegrees` wide and holds both of its directions;
 * the rest of the circle holds one. The point may lie outside the frame: a
 * finger that started on the D-pad keeps steering it wherever it slides.
 */
export function dpadDirections(frame: Rect, diagonalDegrees: number, x: number, y: number): Button[] {
  const { x: cx, y: cy } = centre(frame);
  const dx = x - cx;
  const dy = y - cy;
  if (Math.hypot(dx, dy) < DPAD_DEAD_ZONE * (Math.min(frame.width, frame.height) / 2)) return [];
  // Screen y grows downwards, so 90 degrees is Down.
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const reach = 45 + diagonalDegrees / 2;
  const within = (target: number) => Math.abs(((angle - target + 540) % 360) - 180) < reach;
  const held: Button[] = [];
  if (within(-90)) held.push(Button.Up);
  if (within(90)) held.push(Button.Down);
  if (within(180)) held.push(Button.Left);
  if (within(0)) held.push(Button.Right);
  return held;
}
