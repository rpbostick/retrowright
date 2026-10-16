import type { Button } from "../core/types";
import { controlAt, contains, dpadDirections, type PlacedControl } from "./layout";

/** A control that holds no NES button, drawn pressed while a finger is on it. */
const isHoldOnly = (placed: PlacedControl | null) => placed?.control.kind === "menu" || placed?.control.kind === "fastForward";

interface Finger {
  /** The control the finger came down on; null when it came down on none. */
  start: PlacedControl | null;
  /** The control it holds now: the D-pad keeps its finger, a button finger may slide to another button. */
  current: PlacedControl | null;
  buttons: Button[];
}

export interface TouchTrackerEvents {
  /** A button went down (held by its first finger) or up (let go by its last). */
  onButton(button: Button, pressed: boolean): void;
  /** A finger lifted inside the menu control it came down on. */
  onMenu(): void;
  /** The fast-forward control went down (held by its first finger) or up (let go by its last). */
  onFastForward(held: boolean): void;
  /** Which controls are held changed; for drawing their pressed state. */
  onHeld?(held: ReadonlyMap<string, readonly Button[]>): void;
}

/**
 * Turns pointer positions into NES buttons, one finger per pointer id, so a
 * thumb on the D-pad and another on A work together. A finger that comes
 * down on the D-pad steers it until it lifts, sliding between directions and
 * through the diagonals. A finger on A, B or the A+B area may slide between
 * them without lifting. A button stays down while any finger holds it.
 */
export class TouchTracker {
  private readonly fingers = new Map<number, Finger>();
  private readonly holders = new Map<Button, number>();
  /** Fingers that came down on the fast-forward control and have not lifted. */
  private fastForwardFingers = 0;

  constructor(
    private controls: readonly PlacedControl[],
    private readonly events: TouchTrackerEvents,
  ) {}

  /** A new placement (a rotation, a resize, a new Size); fingers already down let go first. */
  setControls(controls: readonly PlacedControl[]): void {
    this.releaseAll();
    this.controls = controls;
  }

  down(pointer: number, x: number, y: number): void {
    this.up(pointer, x, y, false);
    const start = controlAt(this.controls, x, y);
    const finger: Finger = { start, current: start, buttons: [] };
    this.fingers.set(pointer, finger);
    if (start?.control.kind === "fastForward" && ++this.fastForwardFingers === 1) this.events.onFastForward(true);
    this.hold(finger, this.buttonsFor(start, x, y));
  }

  move(pointer: number, x: number, y: number): void {
    const finger = this.fingers.get(pointer);
    if (!finger?.start) return;
    if (finger.start.control.kind === "button") {
      const under = controlAt(this.controls, x, y);
      finger.current = under?.control.kind === "button" ? under : null;
    }
    this.hold(finger, this.buttonsFor(finger.current, x, y));
  }

  /** `activate` is false for a cancelled pointer: the menu opens only for a finger lifted on it. */
  up(pointer: number, x: number, y: number, activate = true): void {
    const finger = this.fingers.get(pointer);
    if (!finger) return;
    this.fingers.delete(pointer);
    if (finger.start?.control.kind === "fastForward" && --this.fastForwardFingers === 0) this.events.onFastForward(false);
    this.hold(finger, []);
    if (activate && finger.start?.control.kind === "menu" && contains(finger.start.touch, x, y)) this.events.onMenu();
  }

  cancel(pointer: number): void {
    this.up(pointer, 0, 0, false);
  }

  /** Lets every finger go (the menu opened, the controls hid, the window lost focus). */
  releaseAll(): void {
    for (const pointer of [...this.fingers.keys()]) this.cancel(pointer);
  }

  private buttonsFor(placed: PlacedControl | null, x: number, y: number): Button[] {
    if (!placed) return [];
    const { control, frame } = placed;
    if (control.kind === "dpad") return dpadDirections(frame, control.diagonalDegrees, x, y);
    return control.buttons;
  }

  private hold(finger: Finger, buttons: Button[]): void {
    const released = finger.buttons.filter((button) => !buttons.includes(button));
    const pressed = buttons.filter((button) => !finger.buttons.includes(button));
    finger.buttons = buttons;
    for (const button of released) {
      const count = (this.holders.get(button) ?? 0) - 1;
      if (count < 0) throw new Error(`Touch: ${button} was let go more often than it was pressed.`);
      this.holders.set(button, count);
      if (count === 0) this.events.onButton(button, false);
    }
    for (const button of pressed) {
      const count = (this.holders.get(button) ?? 0) + 1;
      this.holders.set(button, count);
      if (count === 1) this.events.onButton(button, true);
    }
    if (released.length > 0 || pressed.length > 0 || isHoldOnly(finger.start)) this.events.onHeld?.(this.held());
  }

  /** The buttons each control holds now, by control id; the menu and fast-forward show as held while a finger is on them. */
  held(): Map<string, Button[]> {
    const held = new Map<string, Button[]>();
    for (const finger of this.fingers.values()) {
      const placed = finger.current ?? finger.start;
      if (!placed) continue;
      if (isHoldOnly(placed) || finger.buttons.length > 0) held.set(placed.control.id, [...(held.get(placed.control.id) ?? []), ...finger.buttons]);
    }
    return held;
  }
}
