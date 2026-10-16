import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import type { VideoDescription } from "../core/types";
import type { Rect } from "../touch/layout";
import { effectiveScaling, pictureSize, type DisplayPrefs } from "./displayPrefs";

/** Room kept below the picture for the controls, so the page fits a laptop screen. */
const RESERVED_HEIGHT = 160;

interface ScreenProps {
  label: string;
  /** The open game's picture; null before a game opens. */
  video: VideoDescription | null;
  display: DisplayPrefs;
  /** Drawn over the picture's top-right corner (the menu button). */
  corner?: ReactNode;
  /**
   * The touch layout's screen rectangle, which the picture is sized into.
   * Without it the picture is sized into the page's width and height, less
   * the room for the controls below.
   */
  fit?: Rect;
}

/**
 * The canvas, sized by the display settings. Its own width and height are
 * the core's frame size, set by ScreenRenderer; the CSS size scales it.
 */
export const Screen = forwardRef<HTMLCanvasElement, ScreenProps>(function Screen({ label, video, display, corner, fit }, canvasRef) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setPage({ width: box.clientWidth, height: window.innerHeight - RESERVED_HEIGHT });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const box = fit ?? page;
  const scaling = effectiveScaling(display.scaling, fit !== undefined);
  const size = video ? pictureSize(video, box.width, box.height, { scaling, aspect: display.aspect }) : null;
  const scanlines = size && display.scanlines;
  return (
    <div
      className={fit ? "screen-box fitted" : "screen-box"}
      ref={boxRef}
      style={fit ? { left: fit.x, top: fit.y, width: fit.width, height: fit.height } : undefined}
    >
      <div className="screen-frame">
        <canvas
          ref={canvasRef}
          className="screen"
          tabIndex={0}
          aria-label={label}
          data-scale={size ? (Number.isInteger(size.scale) ? String(size.scale) : size.scale.toFixed(3)) : undefined}
          data-scaling={scaling}
          data-aspect={display.aspect}
          style={size ? { width: size.width, height: size.height } : undefined}
        />
        {scanlines && (
          <div
            className="scanlines"
            aria-hidden="true"
            data-intensity={display.scanlineIntensity}
            style={{
              // One period per frame line: its lower half darkened, as the gap between a CRT's lines.
              backgroundImage: `linear-gradient(to bottom, transparent 50%, rgba(0, 0, 0, ${display.scanlineIntensity}) 50%)`,
              backgroundSize: `100% ${size.scale}px`,
            }}
          />
        )}
        {corner}
      </div>
    </div>
  );
});
