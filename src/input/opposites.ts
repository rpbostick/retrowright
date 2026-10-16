import { Button } from "../core/types";

/** The directions a NES pad's rocker cannot press together, each with its opposite. */
const OPPOSITE: Partial<Record<Button, Button>> = {
  [Button.Left]: Button.Right,
  [Button.Right]: Button.Left,
  [Button.Up]: Button.Down,
  [Button.Down]: Button.Up,
};

/**
 * `held`, in the order pressed, without the earlier of each opposite pair: the
 * direction pressed last wins, as fight sticks' "last input priority" does.
 * Games are not written for both at once (one platformer walks on in a frozen
 * skid with Left+Right), and the real pad cannot press them.
 */
export function withoutOpposites(held: readonly Button[]): Button[] {
  return held.filter((button, index) => {
    const opposite = OPPOSITE[button];
    return opposite === undefined || !held.slice(index + 1).includes(opposite);
  });
}
