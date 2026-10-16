import { BUTTONS, type Button } from "../core/types";
import {
  ACTION_LABELS,
  ACTIONS,
  BINDING_SLOTS,
  comboKeyLabel,
  comboLabel,
  keyLabel,
  padButtonOf,
  removeCombo,
  SLOT_LABELS,
  SUGGESTED_COMBOS,
  toggleComboButton,
  unbind,
  unbindCombo,
  type BindingTarget,
  type KeyBindings,
} from "../input/keyBindings";
import { PadDiagram } from "./PadDiagram";

interface ControlsPanelProps {
  bindings: KeyBindings;
  rebinding: BindingTarget | null;
  gamepad: string | null;
  onRebind(target: BindingTarget | null): void;
  onResetDefaults(): void;
  onChangeBindings(bindings: KeyBindings): void;
}

/**
 * A small × beside a binding's key button. Focus moves to that key button
 * first, as the × itself goes once the key is unbound.
 */
function UnbindButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button
      type="button"
      className="unbind"
      aria-label={label}
      title={label}
      onClick={(event) => {
        (event.currentTarget.previousElementSibling as HTMLElement).focus();
        onClick();
      }}
    >
      ×
    </button>
  );
}

const sameButtons = (one: readonly Button[], other: readonly Button[]) => one.length === other.length && one.every((button) => other.includes(button));

export function ControlsPanel({ bindings, rebinding, gamepad, onRebind, onResetDefaults, onChangeBindings }: ControlsPanelProps) {
  const lit = rebinding && "action" in rebinding ? padButtonOf(rebinding.action) : undefined;
  const waitingForNew = (buttons: readonly Button[]) => rebinding !== null && "newCombo" in rebinding && sameButtons(rebinding.newCombo, buttons);
  const suggestions = SUGGESTED_COMBOS.filter((buttons) => !bindings.combos.some((combo) => sameButtons(combo.buttons, buttons)));
  return (
    <div className="controls">
      <PadDiagram lit={lit?.button ?? null} player={lit?.player ?? 1} />
      <p className="hint">Choose a binding to change it, then press the new key or click a mouse button (Esc cancels). × beside a key unbinds it.</p>
      <table className="bindings">
        <thead>
          <tr>
            <th scope="col">Action</th>
            {BINDING_SLOTS.map((slot) => (
              <th scope="col" key={slot}>
                {SLOT_LABELS[slot]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ACTIONS.map((action) => (
            <tr key={action}>
              <th scope="row">{ACTION_LABELS[action]}</th>
              {BINDING_SLOTS.map((slot) => {
                const waiting = rebinding !== null && "action" in rebinding && rebinding.action === action && rebinding.slot === slot;
                const code = bindings[action][slot];
                const shown = code === undefined ? (slot === 0 ? "unbound" : "none") : keyLabel(code);
                return (
                  <td key={slot}>
                    <button
                      type="button"
                      className={waiting ? "key waiting" : "key"}
                      data-action={action}
                      data-slot={slot}
                      aria-label={`${ACTION_LABELS[action]}, ${SLOT_LABELS[slot].toLowerCase()}: ${waiting ? "press a key or click a mouse button" : shown}`}
                      onClick={() => onRebind(waiting ? null : { action, slot })}
                    >
                      {waiting ? "Press a key…" : shown}
                    </button>
                    {code !== undefined && !waiting ? (
                      <UnbindButton label={`Unbind ${keyLabel(code)} from ${ACTION_LABELS[action]}`} onClick={() => onChangeBindings(unbind(bindings, action, slot))} />
                    ) : (
                      <span className="unbind-space" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <h3 id="combos-title">Combos</h3>
      <p className="hint">A combo key holds several of player 1&apos;s buttons at once, for moves such as Down+B.</p>
      {bindings.combos.length > 0 && (
        <table className="bindings combos" aria-labelledby="combos-title">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Buttons</th>
              <th scope="col">
                <span className="visually-hidden">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {bindings.combos.map((combo, index) => {
              const waiting = rebinding !== null && "combo" in rebinding && rebinding.combo === index;
              const label = comboLabel(combo.buttons);
              const key = comboKeyLabel(combo);
              return (
                // Deliberate: keyed by place alone, so the row and the focus in it stay when its key is unbound.
                <tr key={index}>
                  <td>
                    <button
                      type="button"
                      className={waiting ? "key waiting" : "key"}
                      data-combo={index}
                      aria-label={`Combo ${label}, key: ${waiting ? "press a key or click a mouse button" : key}`}
                      onClick={() => onRebind(waiting ? null : { combo: index })}
                    >
                      {waiting ? "Press a key…" : key}
                    </button>
                    {combo.code !== null && !waiting ? (
                      <UnbindButton label={`Unbind ${key} from ${label}`} onClick={() => onChangeBindings(unbindCombo(bindings, index))} />
                    ) : (
                      <span className="unbind-space" />
                    )}
                  </td>
                  <td>
                    <div className="combo-buttons" role="group" aria-label={combo.code === null ? `Buttons of combo ${index + 1}` : `Buttons held by ${key}`}>
                      {BUTTONS.map((button) => (
                        <button
                          type="button"
                          key={button}
                          className="combo-button"
                          data-combo-button={button}
                          aria-pressed={combo.buttons.includes(button)}
                          onClick={() => onChangeBindings(toggleComboButton(bindings, index, button))}
                        >
                          {ACTION_LABELS[button]}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td>
                    <button type="button" data-remove-combo={index} aria-label={combo.code === null ? `Remove combo ${index + 1}, ${label}` : `Remove the combo on ${key}`} onClick={() => onChangeBindings(removeCombo(bindings, index))}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="bar">
        {suggestions.map((buttons) => (
          <button
            type="button"
            key={comboLabel(buttons)}
            className={waitingForNew(buttons) ? "key waiting" : undefined}
            data-add-combo={comboLabel(buttons)}
            onClick={() => onRebind(waitingForNew(buttons) ? null : { newCombo: buttons })}
          >
            {waitingForNew(buttons) ? `Press a key for ${comboLabel(buttons)}…` : `Add ${comboLabel(buttons)}`}
          </button>
        ))}
        <button
          type="button"
          className={waitingForNew([]) ? "key waiting" : undefined}
          data-add-combo="other"
          onClick={() => onRebind(waitingForNew([]) ? null : { newCombo: [] })}
        >
          {waitingForNew([]) ? "Press a key for the new combo…" : "Add another combo…"}
        </button>
      </div>
      <button type="button" onClick={onResetDefaults}>
        Restore default keys
      </button>
      <p className="hint">
        {/* Browsers report a pad only once one of its buttons is pressed. */}
        {gamepad ? `Gamepad: ${gamepad}` : "Press any button on your controller"}
      </p>
    </div>
  );
}
