import { useRef } from "react";
import { shownValue, type Tunables, type TunedValues } from "../tune/tunables";

export interface TuneViewProps {
  tunables: Tunables;
  values: TunedValues;
  /** Writes one value into the running game and keeps it. */
  onChange(key: string, value: number): void;
  onReset(): void;
  onSaveVersion(): void;
  /** A tunables file (or game profile) picked for the game, in place of the one it has. */
  onLoadFile(file: File): void;
}

/**
 * One slider per tunable byte of the game, or a list for a byte that picks one
 * of a few ways, after the inspector panels of game engines: changing one
 * writes the byte into the running game at once.
 */
export function TuneView({ tunables, values, onChange, onReset, onSaveVersion, onLoadFile }: TuneViewProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="tune">
      <p className="hint">Changes go into the running game at once and are kept for this game in the browser.</p>
      {/* Deliberate: out of the Tab order, which Firefox gives a list that scrolls: each control in it scrolls into view as it takes focus. */}
      <ul className="tune-list" tabIndex={-1}>
        {tunables.values.map((tunable) => {
          const id = `tune-${tunable.key}`;
          return (
            <li key={tunable.key}>
              <label htmlFor={id}>{tunable.name}</label>
              <output htmlFor={id} data-tune-value={tunable.key}>
                {shownValue(tunable, values[tunable.key])}
              </output>
              {tunable.choices ? (
                <select
                  id={id}
                  data-tune={tunable.key}
                  value={values[tunable.key]}
                  aria-describedby={`${id}-description`}
                  onChange={(event) => onChange(tunable.key, Number(event.target.value))}
                >
                  {tunable.choices.map((choice, index) => (
                    <option key={choice} value={tunable.min + index}>
                      {choice}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  type="range"
                  data-tune={tunable.key}
                  min={tunable.min}
                  max={tunable.max}
                  step={1}
                  value={values[tunable.key]}
                  aria-describedby={`${id}-description`}
                  onChange={(event) => onChange(tunable.key, Number(event.target.value))}
                />
              )}
              <p id={`${id}-description`} className="hint">
                {tunable.description} Default {shownValue(tunable, tunable.default)}.
              </p>
            </li>
          );
        })}
      </ul>
      <div className="tune-actions">
        <button type="button" data-tool="tune-reset" onClick={onReset}>
          Reset
        </button>
        <button type="button" data-tool="tune-save" onClick={onSaveVersion}>
          Save as new version…
        </button>
        <button type="button" data-tool="tune-load" onClick={() => fileInput.current?.click()}>
          Load tunables…
        </button>
        <input
          ref={fileInput}
          id="tune-file-input"
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onLoadFile(file);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
