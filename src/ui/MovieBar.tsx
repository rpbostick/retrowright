import { useRef } from "react";
import type { MovieStatus, RecordStart } from "../player/player";
import { PAD_GESTURE_HINT } from "./menuFocus";

export type RecordChoice = "power-on-keep" | "power-on-clear" | "current-state";

export const RECORD_CHOICES: Record<RecordChoice, { label: string; start: RecordStart }> = {
  "power-on-keep": { label: "power-on, keep battery RAM", start: { from: "power-on", keepBatteryRam: true } },
  "power-on-clear": { label: "power-on, clear battery RAM", start: { from: "power-on", keepBatteryRam: false } },
  "current-state": { label: "the current state", start: { from: "current-state" } },
};

/** REC and the frame count while recording, or the replay's progress; nothing when idle. */
export function MovieIndicator({ status }: { status: MovieStatus }) {
  if (status.mode === "recording") {
    return (
      <span className="rec-indicator" role="status">
        <span className="rec-dot" aria-hidden="true" />
        REC frame {status.frame}
      </span>
    );
  }
  if (status.mode === "playing") {
    return (
      <span className="play-indicator" role="status">
        ▶ movie frame {status.frame} / {status.frames}
      </span>
    );
  }
  return null;
}

interface MovieBarProps {
  enabled: boolean;
  /** A gamepad cannot open the file picker; Play movie… then says so. */
  padInUse: boolean;
  status: MovieStatus;
  choice: RecordChoice;
  onChoice(choice: RecordChoice): void;
  onToggleRecord(): void;
  onMark(): void;
  onPlayFile(file: File): void;
  onStopMovie(): void;
}

/** Record, mark and replay input movies; shown in the menu's Movies view. */
export function MovieBar({ enabled, padInUse, status, choice, onChoice, onToggleRecord, onMark, onPlayFile, onStopMovie }: MovieBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const recording = status.mode === "recording";
  const playing = status.mode === "playing";
  return (
    <div className="bar movie-bar">
      <button type="button" className={recording ? "record stop" : "record"} onClick={onToggleRecord} disabled={!enabled || playing}>
        {recording ? "Stop and save" : "Record"}
      </button>
      {recording ? (
        <>
          <MovieIndicator status={status} />
          <button type="button" className="mark" onClick={onMark}>
            Mark
          </button>
        </>
      ) : (
        <label className="record-from">
          from
          <select value={choice} onChange={(event) => onChoice(event.target.value as RecordChoice)} disabled={!enabled || playing}>
            {Object.entries(RECORD_CHOICES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {playing ? (
        <>
          <MovieIndicator status={status} />
          <button type="button" className="stop-movie" onClick={onStopMovie}>
            Stop movie
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="play-movie"
            data-needs-gesture=""
            aria-describedby={padInUse ? "play-movie-hint" : undefined}
            onClick={() => inputRef.current?.click()}
            disabled={!enabled || recording}
          >
            Play movie…
          </button>
          {padInUse && (
            <span className="hint" id="play-movie-hint">
              {PAD_GESTURE_HINT}
            </span>
          )}
          <input
            ref={inputRef}
            id="movie-input"
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onPlayFile(file);
              event.target.value = "";
            }}
          />
        </>
      )}
    </div>
  );
}
