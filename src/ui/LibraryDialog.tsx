import { useLayoutEffect, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { focusables, nextFocus, wrapTab, type Direction } from "./menuFocus";

const ARROWS: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

interface LibraryDialogProps {
  title: string;
  dialogRef: RefObject<HTMLDivElement>;
  onClose(): void;
  children: ReactNode;
}

/**
 * A small modal dialog over the library (play, manage, remove), following
 * the WAI-ARIA dialog pattern like the quick menu: focus moves in, to the
 * element marked data-autofocus if there is one, Tab stays inside, Esc and a
 * click beside it close it, and focus goes back where it was.
 */
export function LibraryDialog({ title, dialogRef, onClose, children }: LibraryDialogProps) {
  useLayoutEffect(() => {
    const opener = document.activeElement;
    const dialog = dialogRef.current!;
    (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(dialog)[0])?.focus();
    // Focus that leaves the dialog while it is open (a click on the page behind) comes back.
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusables(dialog)[0]?.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      // The listener goes first, or it would pull the returning focus back in.
      document.removeEventListener("focusin", onFocusIn);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [dialogRef]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      wrapTab(dialogRef.current!, event);
      return;
    }
    const direction = ARROWS[event.key];
    // Arrow keys in a text box move its caret.
    if (!direction || event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    nextFocus(dialogRef.current!, document.activeElement, direction)?.focus();
  };

  return (
    <div
      className="menu-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} className="quick-menu library-dialog" role="dialog" aria-modal="true" aria-labelledby="library-dialog-title" onKeyDown={onKeyDown}>
        <header className="menu-head">
          <h2 id="library-dialog-title">{title}</h2>
        </header>
        {children}
      </div>
    </div>
  );
}
