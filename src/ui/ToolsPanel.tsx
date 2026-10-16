import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ValueFormat } from "../tools/ramSearch";
import { formatAddress, loadWatches, saveWatches, type Watch } from "../tools/watchList";
import { MemoryViewer, type MemoryHost } from "./MemoryViewer";
import { RamSearchView } from "./RamSearchView";
import { WatchListView } from "./WatchListView";

export interface ToolsPanelProps {
  host: MemoryHost;
  /** The open game's SHA-256: its watch list is kept under it. */
  romSha256: string;
  /** undefined when the browser blocks localStorage. */
  storage: Storage | undefined;
  /** The key that opens and closes the panel, as shown, or undefined with none bound. */
  toolsKey: string | undefined;
  onClose(): void;
  onProblem(message: string): void;
}

/** Re-renders the caller once per animation frame, so values read in render follow the game. */
function useAnimationFrames(): void {
  const [, setFrame] = useState(0);
  useEffect(() => {
    let handle = requestAnimationFrame(function next() {
      setFrame((frame) => frame + 1);
      handle = requestAnimationFrame(next);
    });
    return () => cancelAnimationFrame(handle);
  }, []);
}

/**
 * The tools beside the screen: RAM search, watch list and memory viewer. The
 * game keeps running while it is open. Keys typed here stay here (the page
 * leaves the game's keys to a control outside the game section); Esc closes it.
 */
export function ToolsPanel({ host, romSha256, storage, toolsKey, onClose, onProblem }: ToolsPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [initialWatches] = useState(() => loadWatches(storage, romSha256));
  const [watches, setWatches] = useState(initialWatches.watches);
  const [viewerOpen, setViewerOpen] = useState(false);
  useAnimationFrames();

  useEffect(() => {
    if (initialWatches.problem) onProblem(initialWatches.problem);
  }, [initialWatches, onProblem]);

  useLayoutEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("input[name=comparison]:checked")?.focus();
  }, []);

  const changeWatches = useCallback(
    (next: Watch[]) => {
      setWatches(next);
      saveWatches(storage, romSha256, next);
    },
    [storage, romSha256],
  );

  const watch = (address: number, { size, signed }: ValueFormat) =>
    changeWatches([...watches, { address, name: formatAddress(address), size, format: signed ? "signed" : "decimal" }]);

  const peek = useCallback((address: number) => host.peek(address), [host]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    // Kept from the page's own Esc handler, which would open the menu.
    event.stopPropagation();
    onClose();
  };

  return (
    <section ref={panelRef} className="tools-panel" aria-labelledby="tools-title" onKeyDown={onKeyDown}>
      <header className="tools-head">
        <h2 id="tools-title">Tools</h2>
        <button type="button" data-tool="close" onClick={onClose}>
          Close{toolsKey ? <kbd>{toolsKey}</kbd> : null}
        </button>
      </header>
      <p className="hint">The game keeps running while the tools are open; the menu pauses it. Esc here closes the tools.</p>
      <RamSearchView peek={peek} onWatch={watch} />
      <WatchListView peek={peek} watches={watches} onChange={changeWatches} />
      <section className="tool memory" aria-labelledby="memory-title">
        <h3 id="memory-title">
          <button type="button" data-tool="memory-toggle" aria-expanded={viewerOpen} onClick={() => setViewerOpen(!viewerOpen)}>
            Memory viewer
          </button>
        </h3>
        {viewerOpen && <MemoryViewer host={host} />}
      </section>
    </section>
  );
}
