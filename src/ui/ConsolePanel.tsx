import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CommandContext } from "../console/commands";
import { completeLine, ConsoleSession } from "../console/session";

export interface ConsolePanelProps {
  session: ConsoleSession;
  context: Omit<CommandContext, "watches" | "clearScrollback">;
  /** The key that shows and hides the console, as shown, or undefined with none bound. */
  consoleKey: string | undefined;
  /** Focus the input when the panel appears: true when the key brought it, false when the setting did at a game's start. */
  autoFocus: boolean;
  /** Escape: focus goes back to the picture. */
  onLeave(): void;
}

/** Re-renders the caller once per animation frame while `on`, so watches follow the game. */
function useFramesWhile(on: boolean): void {
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (!on) return;
    let handle = requestAnimationFrame(function next() {
      setFrame((frame) => frame + 1);
      handle = requestAnimationFrame(next);
    });
    return () => cancelAnimationFrame(handle);
  }, [on]);
}

/**
 * The developer console beside the picture: a scrollback, the watches, and
 * an input with history (Up and Down) and Tab completion. Keys typed into it
 * stay in it; Escape gives focus back to the game.
 */
export function ConsolePanel({ session, context, consoleKey, autoFocus, onLeave }: ConsolePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  /** Where Up and Down are in the history; null while a new line is typed. */
  const [historyAt, setHistoryAt] = useState<number | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [, setVersion] = useState(0);
  useFramesWhile(session.watches.length > 0);

  useLayoutEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const lineCount = session.lines.length;
  const lastId = session.lines[lineCount - 1]?.id;
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lastId, lineCount]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const line = text;
    setText("");
    setHistoryAt(null);
    setOptions([]);
    await session.submit(line, context);
    setVersion((version) => version + 1);
  };

  const recall = (step: -1 | 1) => {
    const history = session.history;
    if (history.length === 0) return;
    const from = historyAt ?? history.length;
    const at = Math.min(history.length, Math.max(0, from + step));
    setHistoryAt(at === history.length ? null : at);
    setText(at === history.length ? "" : history[at]);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      // Kept from the page's own Esc handler, which would open the menu.
      event.stopPropagation();
      onLeave();
      return;
    }
    if (event.target !== inputRef.current) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      recall(event.key === "ArrowUp" ? -1 : 1);
    } else if (event.key === "Tab" && !event.shiftKey && text.trim() !== "") {
      event.preventDefault();
      const completed = completeLine(text, context);
      setText(completed.text);
      setOptions(completed.options);
    }
  };

  return (
    <section className="console-panel" aria-labelledby="console-title" onKeyDown={onKeyDown}>
      <header className="tools-head">
        <h2 id="console-title">Console</h2>
        <span className="hint">
          Esc: back to the game{consoleKey ? <>; <kbd>{consoleKey}</kbd> there hides this</> : null}
        </span>
      </header>
      {/* Deliberate: focusable, so the keyboard alone can scroll back through it. */}
      <div className="console-log" ref={logRef} role="log" aria-live="polite" aria-label="Console output" tabIndex={0}>
        {session.lines.length === 0 && <p className="hint">Type help for the commands.</p>}
        {session.lines.map((line) => (
          <pre key={line.id} className={`console-line ${line.kind}`} data-kind={line.kind}>
            {line.kind === "input" ? `> ${line.text}` : line.text}
          </pre>
        ))}
      </div>
      {session.watches.length > 0 && (
        <dl className="console-watches" aria-label="Watches">
          {session.watches.map((watch) => (
            <div key={watch.label} data-watch={watch.label}>
              <dt>{watch.label}</dt>
              <dd>{readWatch(watch.read)}</dd>
            </div>
          ))}
        </dl>
      )}
      {options.length > 0 && <p className="hint console-options">{options.join("  ")}</p>}
      <form className="console-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="console-input">Command</label>
        <input
          id="console-input"
          ref={inputRef}
          type="text"
          value={text}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value);
            setHistoryAt(null);
          }}
        />
      </form>
    </section>
  );
}

/** A watch's value now, or why it cannot be read (the game closed, or the address became unreadable). */
function readWatch(read: () => string): string {
  try {
    return read();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
