import type { Button, Player } from "../core/types";

/**
 * Each key and mouse button is a source of its own ("keyboard:KeyS"), so
 * letting go of a combo key does not let go of Down still held by its own key.
 */
export type InputSource = "keyboard" | "mouse" | "gamepad" | "touch" | `keyboard:${string}` | `mouse:${string}`;

/**
 * Merges several input sources onto the NES pads: a button stays down while
 * any source holds it, so releasing a key does not cancel the same button
 * still held on the gamepad.
 */
export class ButtonLatch {
  private readonly holders = new Map<string, Set<InputSource>>();

  constructor(
    private readonly down: (player: Player, button: Button) => void,
    private readonly up: (player: Player, button: Button) => void,
  ) {}

  set(source: InputSource, player: Player, button: Button, pressed: boolean): void {
    const key = `${player}:${button}`;
    const holders = this.holders.get(key) ?? new Set<InputSource>();
    const wasHeld = holders.size > 0;
    if (pressed) holders.add(source);
    else holders.delete(source);
    this.holders.set(key, holders);
    if (!wasHeld && holders.size > 0) this.down(player, button);
    if (wasHeld && holders.size === 0) this.up(player, button);
  }

  /** Lets go of everything one source holds (a lost keyboard focus, say); "keyboard" and "mouse" take in each of their keys or buttons. */
  releaseSource(source: InputSource): void {
    for (const [key, holders] of this.holders) {
      const [player, button] = key.split(":") as [string, Button];
      for (const holder of [...holders]) {
        if (holder === source || holder.startsWith(`${source}:`)) this.set(holder, Number(player) as Player, button, false);
      }
    }
  }
}
