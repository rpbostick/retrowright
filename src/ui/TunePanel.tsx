import { useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { TuneView, type TuneViewProps } from "./TuneView";

export interface TunePanelProps extends TuneViewProps {
  /** The key that opens and closes the panel, as shown, or undefined with none bound. */
  tuneKey: string | undefined;
  onClose(): void;
}

/**
 * The Tune sliders beside the screen, for players changing a game's feel: a
 * panel of its own, apart from the developer tools. The game keeps running
 * while it is open; keys typed here stay here, and Esc closes it.
 */
export function TunePanel({ tuneKey, onClose, ...tune }: TunePanelProps) {
  const panelRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("[data-tune]")?.focus();
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    // Kept from the page's own Esc handler, which would open the menu.
    event.stopPropagation();
    onClose();
  };

  return (
    <section ref={panelRef} className="tune-panel" aria-labelledby="tune-title" onKeyDown={onKeyDown}>
      <header className="tools-head">
        <h2 id="tune-title">Tune</h2>
        <button type="button" data-tool="tune-close" onClick={onClose}>
          Close{tuneKey ? <kbd>{tuneKey}</kbd> : null}
        </button>
      </header>
      <TuneView {...tune} />
    </section>
  );
}
