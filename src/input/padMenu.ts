import { Button, type Player } from "../core/types";
import type { ButtonChange } from "./gamepad";

export type MenuCommand = "up" | "down" | "left" | "right" | "choose" | "back";

/**
 * Menu commands by NES button, so a pad moves through the menu with the same
 * buttons it plays with: A (right or top face button) chooses, B (bottom or
 * left face button) goes back.
 */
const COMMANDS: Partial<Record<Button, MenuCommand>> = {
  [Button.Up]: "up",
  [Button.Down]: "down",
  [Button.Left]: "left",
  [Button.Right]: "right",
  [Button.A]: "choose",
  [Button.B]: "back",
};

export interface PadMenuTarget {
  isMenuOpen(): boolean;
  toggleMenu(): void;
  command(command: MenuCommand): void;
  toGame: ButtonChange;
}

/**
 * Sits between the gamepad poller and the game. Select and Start held
 * together on one pad toggle the menu; the press that completes the chord is
 * kept from the game and the other button is let go, so the game never sees
 * both held. While the menu is open, the pads drive it instead of the game.
 */
export class PadMenuRouter {
  private readonly held: Record<Player, Set<Button>> = { 1: new Set(), 2: new Set() };

  constructor(private readonly target: PadMenuTarget) {}

  button: ButtonChange = (player, button, pressed) => {
    const held = this.held[player];
    if (pressed) held.add(button);
    else held.delete(button);
    const chord = pressed && (button === Button.Select || button === Button.Start) && held.has(Button.Select) && held.has(Button.Start);
    if (chord) {
      if (!this.target.isMenuOpen()) this.target.toGame(player, button === Button.Start ? Button.Select : Button.Start, false);
      this.target.toggleMenu();
      return;
    }
    if (this.target.isMenuOpen()) {
      const command = COMMANDS[button];
      if (pressed && command) this.target.command(command);
      return;
    }
    this.target.toGame(player, button, pressed);
  };

  home = (): void => this.target.toggleMenu();
}
