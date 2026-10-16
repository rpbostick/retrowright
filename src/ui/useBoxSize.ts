import { useEffect, useState, type RefObject } from "react";

/**
 * The content box of an element (inside its padding, which holds the
 * safe-area insets), kept up to date through rotations and resizes while
 * `active`. Zero by zero until the first measurement.
 */
export function useBoxSize(ref: RefObject<HTMLElement>, active: boolean): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, active]);
  return size;
}
