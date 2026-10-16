import { BUTTONS } from "../core/types";
import { GAMEPAD_BUTTON_LABELS } from "../input/gamepad";
import {
  ACTION_LABELS,
  BINDING_SLOTS,
  comboKeyLabel,
  comboLabel,
  Hotkey,
  keyLabel,
  player2Action,
  SLOT_LABELS,
  type Action,
  type BindingSlot,
  type KeyBindings,
} from "../input/keyBindings";

interface ControlsSidePanelProps {
  /** The live bindings: a key rebound in the menu shows here at once. */
  bindings: KeyBindings;
}

interface HotkeyRow {
  label: string;
  /** The bound action, or a fixed key for one that cannot be rebound. */
  keys: Action | { fixed: string };
  gamepad: string;
}

const HOTKEY_ROWS: readonly HotkeyRow[] = [
  // Deliberate: Esc is fixed, so the menu can always be reached to rebind the rest.
  { label: "Menu", keys: { fixed: "Esc" }, gamepad: "Select + Start, or Home" },
  { label: ACTION_LABELS[Hotkey.FastForward], keys: Hotkey.FastForward, gamepad: "Right trigger" },
  { label: ACTION_LABELS[Hotkey.Screenshot], keys: Hotkey.Screenshot, gamepad: "none" },
  // The Tune panel's key, not the tools': the tools are behind the Developer tools setting, which most players leave off.
  { label: ACTION_LABELS[Hotkey.Tune], keys: Hotkey.Tune, gamepad: "none" },
  { label: ACTION_LABELS[Hotkey.SaveState], keys: Hotkey.SaveState, gamepad: "none" },
  { label: ACTION_LABELS[Hotkey.LoadState], keys: Hotkey.LoadState, gamepad: "none" },
];

function boundText(bindings: KeyBindings, action: Action, slot: BindingSlot): string {
  const code = bindings[action][slot];
  if (code !== undefined) return keyLabel(code);
  return slot === 0 ? "unbound" : "none";
}

/** The game's buttons and the main hotkeys with both sets of keys and their gamepad buttons, beside the picture; player 2's bound buttons and the combos once any is bound. */
export function ControlsSidePanel({ bindings }: ControlsSidePanelProps) {
  const row = (label: string, keys: readonly string[], gamepad: string) => (
    <tr key={label}>
      <th scope="row">{label}</th>
      {keys.map((text, slot) => (
        <td key={slot} className={slot === 0 ? "side-keys" : "side-keys side-secondary"}>
          {text}
        </td>
      ))}
      <td>{gamepad}</td>
    </tr>
  );
  const head = (first: string) => (
    <thead>
      <tr>
        <th scope="col">{first}</th>
        {BINDING_SLOTS.map((slot) => (
          <th scope="col" key={slot}>
            {SLOT_LABELS[slot]}
          </th>
        ))}
        <th scope="col">Gamepad</th>
      </tr>
    </thead>
  );
  const bound = (action: Action) => BINDING_SLOTS.map((slot) => boundText(bindings, action, slot));
  // Only player 2's buttons with a key show; the second gamepad alone needs no table.
  const player2Bound = BUTTONS.filter((button) => bindings[player2Action(button)].length > 0);
  return (
    <aside className="controls-side" aria-labelledby="controls-side-title">
      <h2 id="controls-side-title">Controls</h2>
      <table className="side-table">
        {head("Button")}
        <tbody>{BUTTONS.map((button) => row(ACTION_LABELS[button], bound(button), GAMEPAD_BUTTON_LABELS[button]))}</tbody>
      </table>
      {player2Bound.length > 0 && (
        <table className="side-table">
          {head("Player 2")}
          <tbody>{player2Bound.map((button) => row(ACTION_LABELS[button], bound(player2Action(button)), "Second gamepad"))}</tbody>
        </table>
      )}
      {bindings.combos.length > 0 && (
        <table className="side-table">
          <thead>
            <tr>
              <th scope="col">Combo</th>
              <th scope="col">Key</th>
            </tr>
          </thead>
          <tbody>
            {bindings.combos.map((combo, index) => (
              <tr key={`${index}:${combo.code}`}>
                <th scope="row">{comboLabel(combo.buttons)}</th>
                <td className="side-keys">{comboKeyLabel(combo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table className="side-table">
        {head("Hotkey")}
        <tbody>{HOTKEY_ROWS.map((hotkey) => row(hotkey.label, typeof hotkey.keys === "object" ? [hotkey.keys.fixed, "none"] : bound(hotkey.keys), hotkey.gamepad))}</tbody>
      </table>
      <p className="hint">The mouse buttons act over the picture. Change keys in the menu's Controls…; this panel in its Display and speed….</p>
    </aside>
  );
}
