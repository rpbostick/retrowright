// Moves focus through the quick menu and the library's dialogs with arrow keys
// or a pad's D-pad. Focus follows document order, which is the order items are
// drawn in; a slot grid marks itself with data-columns so up and down move by
// a whole row.
//
// Deliberate: hand-written rather than the focus-trap package (MIT). The trap
// itself is wrapTab below plus a focusin listener, a dozen lines; what these
// dialogs need beyond it is arrow-key and gamepad movement, which focus-trap
// does not do, so the package would add a dependency (and tabbable with it)
// without replacing the rest of this file.

export type Direction = "up" | "down" | "left" | "right";

/** Shown, while the player is using a gamepad, on items marked data-needs-gesture. */
export const PAD_GESTURE_HINT = "Use the mouse or keyboard for this";

/**
 * True for an item marked data-needs-gesture: a file picker or fullscreen,
 * which the browser opens only for a click or key press. A gamepad press is
 * not a user activation, so a pad's "choose" leaves these alone.
 */
export function needsGesture(element: Element | null): boolean {
  return element instanceof HTMLElement && element.hasAttribute("data-needs-gesture");
}

const FOCUSABLE = "button:not([disabled]), select:not([disabled]), input:not([disabled]):not([type=hidden]), [tabindex]:not([tabindex='-1'])";

export function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.hidden && element.closest("[hidden]") === null);
}

/** Tab and Shift+Tab stay inside `container`, wrapping at its ends, as in a modal dialog. */
export function wrapTab(container: HTMLElement, event: { shiftKey: boolean; preventDefault(): void }): void {
  const items = focusables(container);
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Where focus goes from `current` in `direction`; wraps at the ends. */
export function nextFocus(container: HTMLElement, current: Element | null, direction: Direction): HTMLElement | null {
  const items = focusables(container);
  if (items.length === 0) return null;
  const index = current instanceof HTMLElement ? items.indexOf(current) : -1;
  if (index === -1) return items[0];
  const grid = current!.closest<HTMLElement>("[data-columns]");
  if (grid && (direction === "up" || direction === "down")) {
    const cells = items.filter((item) => grid.contains(item));
    const columns = Number(grid.dataset.columns);
    if (!Number.isInteger(columns) || columns < 1) throw new Error(`data-columns must be a whole number, not "${grid.dataset.columns}".`);
    const cell = cells.indexOf(current as HTMLElement) + (direction === "down" ? columns : -columns);
    if (cell >= 0 && cell < cells.length) return cells[cell];
    // Past the grid's first or last row: leave it like any other list.
    const edge = direction === "down" ? items.indexOf(cells[cells.length - 1]) + 1 : items.indexOf(cells[0]) - 1;
    return items[(edge + items.length) % items.length];
  }
  const step = direction === "down" || direction === "right" ? 1 : -1;
  return items[(index + step + items.length) % items.length];
}

/** True for a slider, whose left and right arrow keys change its value rather than move focus. */
export function isSlider(element: EventTarget | null): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.type === "range";
}

/**
 * The pad's left and right on a select or a slider: what the arrow keys do
 * there with a keyboard. A change event is sent as for a user's change.
 * Returns false when `element` is neither.
 */
export function stepSelect(element: Element | null, direction: "left" | "right"): boolean {
  const step = direction === "right" ? 1 : -1;
  if (element instanceof HTMLSelectElement) {
    const index = Math.min(element.options.length - 1, Math.max(0, element.selectedIndex + step));
    if (index === element.selectedIndex) return true;
    setNativeValue(element, element.options[index].value);
    return true;
  }
  if (isSlider(element)) {
    // stepUp and stepDown change the value without React's setter, so React sees the input event's value as new.
    if (step > 0) element.stepUp();
    else element.stepDown();
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  return false;
}

/**
 * React tracks a control's last value and ignores an event whose value it has
 * already seen, so the value is set through the prototype's setter.
 */
function setNativeValue(element: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (!setter) throw new Error("This browser does not expose the value setter of a select.");
  setter.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
