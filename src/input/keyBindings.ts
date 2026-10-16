import { Button, BUTTONS, type Player } from "../core/types";

// Keys are matched on KeyboardEvent.code (the physical key), so Z/X stay
// next to each other on AZERTY and other layouts. Mouse buttons share the
// same lists as "Mouse" + MouseEvent.button ("Mouse0" is the left button,
// "Mouse2" the right), so they show and are rebound as keys are.

/**
 * A button of player 2's pad, bound to keys like player 1's, so one person
 * can press the extra moves a game reads from pad 2.
 */
export type Player2Action = `P2${Button}`;
export const player2Action = (button: Button): Player2Action => `P2${button}`;
export const PLAYER2_ACTIONS: readonly Player2Action[] = BUTTONS.map(player2Action);

export enum Hotkey {
  SaveState = "SaveState",
  LoadState = "LoadState",
  Slot1 = "Slot1",
  Slot2 = "Slot2",
  Slot3 = "Slot3",
  Record = "Record",
  Mark = "Mark",
  /** Held: the game runs at the fast-forward speed until the key is let go. */
  FastForward = "FastForward",
  Screenshot = "Screenshot",
  /** Opens or closes the tools panel (RAM search, watch list, memory viewer) while the Developer tools setting is on. */
  Tools = "Tools",
  /** Downloads the instant replay: a movie of the last minute or so played. */
  SaveReplay = "SaveReplay",
  /** Shows or hides the developer console while the Developer tools setting is on. */
  Console = "Console",
  /** Opens or closes the Tune panel, for a game with a bundled tunables file. */
  Tune = "Tune",
}

export type Action = Button | Player2Action | Hotkey;

/** One key or mouse button that holds several of player 1's buttons at once, as Down+B. */
export interface Combo {
  /** null once unbound: the combo keeps its buttons until a key is bound to it again. */
  code: string | null;
  buttons: Button[];
}

export type KeyBindings = Record<Action, string[]> & { combos: Combo[] };

/** Offered in the Controls view with one click; none is bound by default. */
export const SUGGESTED_COMBOS: readonly (readonly Button[])[] = [
  [Button.Down, Button.B],
  [Button.Down, Button.A],
];

export const ACTIONS: readonly Action[] = [
  ...BUTTONS,
  Hotkey.SaveState,
  Hotkey.LoadState,
  Hotkey.Slot1,
  Hotkey.Slot2,
  Hotkey.Slot3,
  Hotkey.Record,
  Hotkey.Mark,
  Hotkey.FastForward,
  Hotkey.Screenshot,
  Hotkey.Tools,
  Hotkey.SaveReplay,
  Hotkey.Console,
  Hotkey.Tune,
  ...PLAYER2_ACTIONS,
];

/** Actions added after bindings were first stored; older saved bindings lack them. */
const ADDED_LATER: readonly Action[] = [Hotkey.Record, Hotkey.Mark, Hotkey.FastForward, Hotkey.Screenshot, Hotkey.Tools, Hotkey.SaveReplay, Hotkey.Console, Hotkey.Tune, ...PLAYER2_ACTIONS];

const BUTTON_LABELS: Record<Button, string> = {
  [Button.Up]: "Up",
  [Button.Down]: "Down",
  [Button.Left]: "Left",
  [Button.Right]: "Right",
  [Button.B]: "B",
  [Button.A]: "A",
  [Button.Select]: "Select",
  [Button.Start]: "Start",
};

export const ACTION_LABELS: Record<Action, string> = {
  ...BUTTON_LABELS,
  ...(Object.fromEntries(BUTTONS.map((button) => [player2Action(button), `Player 2 ${BUTTON_LABELS[button]}`])) as Record<Player2Action, string>),
  [Hotkey.SaveState]: "Save state",
  [Hotkey.LoadState]: "Load state",
  [Hotkey.Slot1]: "State slot 1",
  [Hotkey.Slot2]: "State slot 2",
  [Hotkey.Slot3]: "State slot 3",
  [Hotkey.Record]: "Record / stop",
  [Hotkey.Mark]: "Mark checkpoint",
  [Hotkey.FastForward]: "Fast-forward (hold)",
  [Hotkey.Screenshot]: "Screenshot",
  [Hotkey.Tools]: "Tools panel",
  [Hotkey.SaveReplay]: "Save the last minute",
  [Hotkey.Console]: "Developer console",
  [Hotkey.Tune]: "Tune panel",
};

/** An action's first bound code is its primary binding, the second its secondary. */
export type BindingSlot = 0 | 1;
export const BINDING_SLOTS: readonly BindingSlot[] = [0, 1];
export const SLOT_LABELS: Record<BindingSlot, string> = { 0: "Primary", 1: "Secondary" };
/**
 * The binding the Controls view waits to change: an action's key, the key of
 * the combo at `combo` in the list, or the key of a new combo of `buttons`.
 */
export type BindingTarget = { action: Action; slot: BindingSlot } | { combo: number } | { newCombo: readonly Button[] };

export const mouseCode = (button: number) => `Mouse${button}`;

/** A button on one of the two pads. */
export interface PadButton {
  player: Player;
  button: Button;
}

/** The pad button an action presses, or undefined for a hotkey. */
export function padButtonOf(action: Action): PadButton | undefined {
  if ((BUTTONS as readonly Action[]).includes(action)) return { player: 1, button: action as Button };
  const index = (PLAYER2_ACTIONS as readonly Action[]).indexOf(action);
  return index >= 0 ? { player: 2, button: BUTTONS[index] } : undefined;
}

/** Every pad button a key or mouse button holds: its own button, or each button of its combo. */
export function padButtonsForCode(bindings: KeyBindings, code: string): PadButton[] {
  const action = actionForCode(bindings, code);
  const own = action === undefined ? undefined : padButtonOf(action);
  if (own) return [own];
  const combo = bindings.combos.find((candidate) => candidate.code === code);
  return combo ? combo.buttons.map((button) => ({ player: 1, button })) : [];
}

/** "Down+B", in the pad's own button order. */
export function comboLabel(buttons: readonly Button[]): string {
  return buttons.length === 0 ? "no buttons" : BUTTONS.filter((button) => buttons.includes(button)).map((button) => BUTTON_LABELS[button]).join("+");
}

/**
 * The second control set: WASD steers while the mouse over the picture
 * presses A and B. Added after bindings were first stored, so older saved
 * bindings gain each code that is still free.
 */
const SECOND_SET: Partial<Record<Action, string>> = {
  [Button.Up]: "KeyW",
  [Button.Left]: "KeyA",
  [Button.Down]: "KeyS",
  [Button.Right]: "KeyD",
  [Button.A]: mouseCode(0),
  [Button.B]: mouseCode(2),
};

export const DEFAULT_BINDINGS: KeyBindings = {
  [Button.Up]: ["ArrowUp", "KeyW"],
  [Button.Down]: ["ArrowDown", "KeyS"],
  [Button.Left]: ["ArrowLeft", "KeyA"],
  [Button.Right]: ["ArrowRight", "KeyD"],
  [Button.B]: ["KeyZ", "Mouse2"],
  [Button.A]: ["KeyX", "Mouse0"],
  [Button.Select]: ["ShiftLeft", "ShiftRight"],
  [Button.Start]: ["Enter", "NumpadEnter"],
  // F5 and F7 as in FCEUX; the page stops the browser's own F5 reload.
  [Hotkey.SaveState]: ["F5"],
  [Hotkey.LoadState]: ["F7"],
  [Hotkey.Slot1]: ["Digit1"],
  [Hotkey.Slot2]: ["Digit2"],
  [Hotkey.Slot3]: ["Digit3"],
  [Hotkey.Record]: ["F9"],
  [Hotkey.Mark]: ["F8"],
  // Tab as in Mesen's hold-to-fast-forward; the page keeps it from moving focus while a game runs.
  [Hotkey.FastForward]: ["Tab"],
  // Deliberate: F2, not the F12 of FCEUX and Mesen, which opens the browser's developer tools before the page sees it.
  [Hotkey.Screenshot]: ["F2"],
  // F4: Firefox and Chrome keep F1, F6 and F10-F12 for themselves, and the other keys here are taken.
  [Hotkey.Tools]: ["F4"],
  // F3, next to F4's tools: its find-again is the browser's, and the page stops it as it stops F5's reload.
  [Hotkey.Tune]: ["F3"],
  // R for replay: every free function key is one a browser keeps (see F4), and no game button or hotkey uses R.
  [Hotkey.SaveReplay]: ["KeyR"],
  // Backquote, as the console key of Quake and the games after it; typed into the console it is a character.
  [Hotkey.Console]: ["Backquote"],
  ...(Object.fromEntries(PLAYER2_ACTIONS.map((action) => [action, []])) as unknown as Record<Player2Action, string[]>),
  combos: [],
};

export function actionForCode(bindings: KeyBindings, code: string): Action | undefined {
  return ACTIONS.find((action) => bindings[action].includes(code));
}

/** The bindings with `code` taken away from every action and combo, so a code has one meaning. */
function withoutCode(bindings: KeyBindings, code: string): KeyBindings {
  const next = { combos: bindings.combos.filter((combo) => combo.code !== code) } as KeyBindings;
  for (const action of ACTIONS) next[action] = bindings[action].filter((bound) => bound !== code);
  return next;
}

/**
 * Binds `code` to `action` in `slot`, keeping the action's other binding, and
 * takes it away from wherever else it was bound. An empty slot is filled from
 * the front, so an action never has a secondary without a primary.
 */
export function rebind(bindings: KeyBindings, action: Action, code: string, slot: BindingSlot = 0): KeyBindings {
  const next = withoutCode(bindings, code);
  const own = [...bindings[action]];
  if (slot < own.length) own[slot] = code;
  else own.push(code);
  next[action] = own.filter((bound, index) => bound !== code || index === own.indexOf(code));
  return next;
}

/** Binds `code` to the combo at `index`, taking it away from wherever else it was bound. */
export function rebindCombo(bindings: KeyBindings, index: number, code: string): KeyBindings {
  const combo = bindings.combos[index];
  if (!combo) throw new Error(`There is no combo ${index}.`);
  const combos = bindings.combos.flatMap((other, at) => (at === index ? [{ ...combo, code }] : other.code === code ? [] : [other]));
  return { ...withoutCode(bindings, code), combos };
}

/** Adds a combo of `buttons` on `code`, taking the code away from wherever else it was bound. */
export function addCombo(bindings: KeyBindings, code: string, buttons: readonly Button[]): KeyBindings {
  const next = withoutCode(bindings, code);
  return { ...next, combos: [...next.combos, { code, buttons: [...buttons] }] };
}

/** The combo at `index` with `button` put in or taken out. */
export function toggleComboButton(bindings: KeyBindings, index: number, button: Button): KeyBindings {
  const combo = bindings.combos[index];
  if (!combo) throw new Error(`There is no combo ${index}.`);
  const buttons = combo.buttons.includes(button) ? combo.buttons.filter((held) => held !== button) : BUTTONS.filter((held) => held === button || combo.buttons.includes(held));
  return { ...bindings, combos: bindings.combos.map((other, at) => (at === index ? { ...combo, buttons } : other)) };
}

/** Takes the code in `slot` away from `action`; a secondary left alone moves up to primary. */
export function unbind(bindings: KeyBindings, action: Action, slot: BindingSlot): KeyBindings {
  if (bindings[action][slot] === undefined) throw new Error(`${action} has no key in slot ${slot}.`);
  return { ...bindings, [action]: bindings[action].filter((_, at) => at !== slot) };
}

/** Takes the key away from the combo at `index`, keeping its buttons. */
export function unbindCombo(bindings: KeyBindings, index: number): KeyBindings {
  const combo = bindings.combos[index];
  if (!combo) throw new Error(`There is no combo ${index}.`);
  return { ...bindings, combos: bindings.combos.map((other, at) => (at === index ? { ...combo, code: null } : other)) };
}

export function removeCombo(bindings: KeyBindings, index: number): KeyBindings {
  return { ...bindings, combos: bindings.combos.filter((_, at) => at !== index) };
}

/** Binds `code` to whatever the Controls view waits on. */
export function bindTarget(bindings: KeyBindings, target: BindingTarget, code: string): KeyBindings {
  if ("action" in target) return rebind(bindings, target.action, code, target.slot);
  if ("combo" in target) return rebindCombo(bindings, target.combo, code);
  return addCombo(bindings, code, target.newCombo);
}

const NAMED_KEYS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  ControlLeft: "Left Ctrl",
  ControlRight: "Right Ctrl",
  AltLeft: "Left Alt",
  AltRight: "Right Alt",
  Space: "Space",
  NumpadEnter: "Numpad Enter",
  Backquote: "`",
  Mouse0: "Left click",
  Mouse1: "Middle click",
  Mouse2: "Right click",
};

export function keyLabel(code: string): string {
  if (NAMED_KEYS[code]) return NAMED_KEYS[code];
  const mouse = /^Mouse(\d+)$/.exec(code);
  if (mouse) return `Mouse button ${Number(mouse[1]) + 1}`;
  const letterOrDigit = /^(?:Key|Digit)(.)$/.exec(code);
  if (letterOrDigit) return letterOrDigit[1];
  const numpad = /^Numpad(.+)$/.exec(code);
  if (numpad) return `Numpad ${numpad[1]}`;
  return code;
}

export function comboKeyLabel(combo: Combo): string {
  return combo.code === null ? "unbound" : keyLabel(combo.code);
}

const STORAGE_KEY = "retrowright.keyBindings.v1";
/**
 * Stored beside the actions from the second control set on. Bindings without
 * it were saved before that set existed; version 2 before combos and player
 * 2's keys. Deliberate: a field in the same value rather than a new storage
 * key, so a backup of any shape restores through the same key.
 */
const FORMAT_VERSION = 3;
const BEFORE_COMBOS_VERSION = 2;

export type LoadedBindings = { bindings: KeyBindings; problem?: string };

function isCodeList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((code) => typeof code === "string");
}

/**
 * A combo's `code` may be null, as unbinding a combo's key leaves it. Builds
 * from before that reject saved bindings holding one and fall back to the
 * defaults. Deliberate: no version bump, as a bump would make them reject
 * every format 3 binding, not only the ones with an unbound combo.
 */
function isCombo(value: unknown): value is Combo {
  if (typeof value !== "object" || value === null) return false;
  const { code, buttons } = value as Record<string, unknown>;
  return (typeof code === "string" || code === null) && Array.isArray(buttons) && buttons.every((button) => (BUTTONS as readonly unknown[]).includes(button));
}

/**
 * Accepts bindings saved before some actions, the second control set or
 * combos existed: those actions get their default keys, each action its
 * second set code, minus any code the saved bindings already use elsewhere,
 * and the combos none.
 */
function migrateBindings(value: unknown): KeyBindings | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const beforeSecondSet = !("version" in record);
  const beforeCombos = beforeSecondSet || record.version === BEFORE_COMBOS_VERSION;
  if (!beforeCombos && record.version !== FORMAT_VERSION) return null;
  let combos: Combo[] = [];
  if (!beforeCombos) {
    if (!Array.isArray(record.combos) || !record.combos.every(isCombo)) return null;
    combos = record.combos.map((combo) => ({ code: combo.code, buttons: [...combo.buttons] }));
  }
  const bindings = { combos } as KeyBindings;
  for (const action of ACTIONS) {
    if (isCodeList(record[action])) bindings[action] = record[action];
    else if (!(action in record) && ADDED_LATER.includes(action)) bindings[action] = [];
    else return null;
  }
  const used = new Set([...ACTIONS.flatMap((action) => bindings[action]), ...combos.map((combo) => combo.code)]);
  for (const action of ADDED_LATER) {
    if (!(action in record)) bindings[action] = DEFAULT_BINDINGS[action].filter((code) => !used.has(code));
  }
  if (beforeSecondSet) {
    const taken = new Set(ACTIONS.flatMap((action) => bindings[action]));
    for (const action of ACTIONS) {
      const code = SECOND_SET[action];
      if (code !== undefined && !taken.has(code)) bindings[action] = [...bindings[action], code];
    }
  }
  return bindings;
}

/** `storage` is undefined when the browser blocks localStorage. */
export function loadBindings(storage: Storage | undefined): LoadedBindings {
  const raw = storage?.getItem(STORAGE_KEY);
  if (raw === null || raw === undefined) return { bindings: DEFAULT_BINDINGS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const bindings = migrateBindings(parsed);
  if (!bindings) {
    return { bindings: DEFAULT_BINDINGS, problem: "Saved key bindings could not be read, so the defaults are in use." };
  }
  return { bindings };
}

export function saveBindings(storage: Storage | undefined, bindings: KeyBindings): void {
  storage?.setItem(STORAGE_KEY, JSON.stringify({ version: FORMAT_VERSION, ...bindings }));
}
