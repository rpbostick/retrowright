import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "../core/types";
import type { PlacedControl, PlacedLayout } from "../touch/layout";
import { TouchTracker } from "../touch/touchTracker";

/** Milliseconds of vibration on a press: a tick, not a buzz. */
const VIBRATE_MS = 12;

interface TouchControlsProps {
  placed: PlacedLayout;
  opacity: number;
  vibrate: boolean;
  /** True while the menu is open: every finger lets go and nothing is pressed. */
  paused: boolean;
  onButton(button: Button, pressed: boolean): void;
  onMenu(): void;
  onFastForward(held: boolean): void;
}

/**
 * The on-screen pad, drawn by us in CSS and SVG from the layout's frames. One
 * layer takes every pointer and hit-tests it against the layout, so touch
 * edges reach past the drawn buttons and a finger can slide between them.
 * Hidden from screen readers: the keyboard and the menu reach everything it does.
 */
export function TouchControls({ placed, opacity, vibrate, paused, onButton, onMenu, onFastForward }: TouchControlsProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<ReadonlyMap<string, readonly Button[]>>(new Map());
  // The tracker outlives renders; it calls the newest props through this ref.
  const latest = useRef({ onButton, onMenu, onFastForward, vibrate });
  latest.current = { onButton, onMenu, onFastForward, vibrate };
  const trackerRef = useRef<TouchTracker | null>(null);
  trackerRef.current ??= new TouchTracker(placed.controls, {
    onButton: (button, pressed) => {
      if (pressed && latest.current.vibrate) navigator.vibrate?.(VIBRATE_MS);
      latest.current.onButton(button, pressed);
    },
    onMenu: () => latest.current.onMenu(),
    onFastForward: (on) => latest.current.onFastForward(on),
    onHeld: (next) => setHeld(new Map(next)),
  });
  const tracker = trackerRef.current;

  useEffect(() => tracker.setControls(placed.controls), [tracker, placed]);
  useEffect(() => {
    if (paused) tracker.releaseAll();
  }, [tracker, paused]);
  useEffect(() => () => tracker.releaseAll(), [tracker]);

  const point = (event: ReactPointerEvent) => {
    const box = layerRef.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  return (
    <div
      ref={layerRef}
      className="touch-layer"
      aria-hidden="true"
      data-orientation={placed.orientation}
      style={{ opacity }}
      onPointerDown={(event) => {
        if (paused || (event.pointerType === "mouse" && event.button !== 0)) return;
        event.preventDefault();
        // A finger is captured by the element it touched without asking; a mouse or pen is captured here so a drag off the layer still ends.
        if (event.pointerType !== "touch" && event.isTrusted) layerRef.current!.setPointerCapture(event.pointerId);
        const { x, y } = point(event);
        tracker.down(event.pointerId, x, y);
      }}
      onPointerMove={(event) => {
        const { x, y } = point(event);
        tracker.move(event.pointerId, x, y);
      }}
      onPointerUp={(event) => {
        const { x, y } = point(event);
        tracker.up(event.pointerId, x, y);
      }}
      onPointerCancel={(event) => tracker.cancel(event.pointerId)}
      onLostPointerCapture={(event) => tracker.cancel(event.pointerId)}
    >
      {placed.controls.map((control) => (
        <ControlView key={control.control.id} placed={control} held={held.get(control.control.id)} />
      ))}
    </div>
  );
}

function ControlView({ placed, held }: { placed: PlacedControl; held: readonly Button[] | undefined }) {
  const { control, frame } = placed;
  const style = { left: frame.x, top: frame.y, width: frame.width, height: frame.height };
  if (control.kind === "dpad") {
    return (
      <div className="touch-control touch-dpad" data-control={control.id} data-held={held?.join(" ") ?? ""} style={style}>
        <DpadDrawing held={held ?? []} />
      </div>
    );
  }
  return (
    <div
      className={`touch-control touch-button ${control.shape}${control.buttons.length > 1 ? " combo" : ""}`}
      data-control={control.id}
      data-pressed={held !== undefined}
      style={{ ...style, fontSize: Math.max(10, Math.min(frame.width, frame.height) * (control.shape === "circle" ? 0.38 : 0.42)) }}
    >
      <span>{control.label}</span>
    </div>
  );
}

const ARMS: Array<{ button: Button; path: string; arrow: string }> = [
  { button: Button.Up, path: "M35 4h30v31H35z", arrow: "M50 12l8 10H42z" },
  { button: Button.Down, path: "M35 65h30v31H35z", arrow: "M50 88l8-10H42z" },
  { button: Button.Left, path: "M4 35h31v30H4z", arrow: "M12 50l10-8v16z" },
  { button: Button.Right, path: "M65 35h31v30H65z", arrow: "M88 50l-10-8v16z" },
];

function DpadDrawing({ held }: { held: readonly Button[] }) {
  return (
    <svg viewBox="0 0 100 100" className="dpad-drawing">
      <path className="dpad-body" d="M35 4h30v31h31v30H65v31H35V65H4V35h31z" />
      {ARMS.map((arm) => (
        <g key={arm.button} className={held.includes(arm.button) ? "dpad-arm lit" : "dpad-arm"} data-arm={arm.button}>
          <path className="dpad-arm-fill" d={arm.path} />
          <path className="dpad-arrow" d={arm.arrow} />
        </g>
      ))}
      <circle className="dpad-hub" cx="50" cy="50" r="9" />
    </svg>
  );
}
