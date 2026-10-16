import { useEffect, useState } from "react";
import { STATE_SLOTS, type StateRecord, type StateSlot } from "../storage/gameStore";

/** Narrower than this, the grid shows two columns instead of four. */
const NARROW_QUERY = "(max-width: 600px)";

export function savedAtText(savedAt: number): string {
  return new Date(savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Column count for both the CSS grid and arrow-key movement, which must
 * agree: up and down move by one row. jsdom has no matchMedia; four columns then.
 */
function useColumns(): number {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW_QUERY).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(NARROW_QUERY);
    if (!query) return;
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow ? 2 : 4;
}

interface SlotGridProps {
  mode: "save" | "load";
  slots: StateRecord[];
  currentSlot: StateSlot;
  onPick(slot: StateSlot): void;
}

/** Eight save-state slots as cards with the frame each was saved on. */
export function SlotGrid({ mode, slots, currentSlot, onPick }: SlotGridProps) {
  const columns = useColumns();
  const bySlot = new Map(slots.map((record) => [record.slot, record]));
  return (
    <ul className="slot-grid" data-columns={columns} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {STATE_SLOTS.map((slot) => {
        const record = bySlot.get(slot);
        const when = record ? savedAtText(record.savedAt) : null;
        const action = mode === "save" ? "Save to" : "Load";
        return (
          <li key={slot}>
            <button
              type="button"
              className={`slot-card${record ? "" : " empty"}${slot === currentSlot ? " current" : ""}`}
              data-slot={slot}
              // Deliberate: aria-disabled, not disabled, so an empty slot keeps its place in arrow-key movement by rows.
              aria-disabled={mode === "load" && !record}
              // The visible words in their order ("Empty", "Slot 2", the time), so speech control by the shown text finds the card (WCAG 2.5.3).
              aria-label={`${action} ${record ? (record.thumbnail ? "" : "no picture, ") : "empty "}slot ${slot}${when ? `, ${when}` : ""}${slot === currentSlot ? ", current slot" : ""}`}
              onClick={() => {
                if (mode === "save" || record) onPick(slot);
              }}
            >
              <span className="slot-picture">
                {record?.thumbnail ? <img src={record.thumbnail} alt="" /> : <span className="slot-blank">{record ? "No picture" : "Empty"}</span>}
              </span>{" "}
              {/* The spaces keep the words apart in the text read from the card (its spans are blocks on screen). */}
              <span className="slot-name">Slot {slot}</span>{" "}
              <span className="slot-time">{when ?? "—"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
