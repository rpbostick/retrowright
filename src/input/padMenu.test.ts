import { describe, expect, it } from "vitest";
import { GamepadPoller } from "./gamepad";
import { PadMenuRouter, type MenuCommand } from "./padMenu";
import { FakeGamepadApi } from "../test/fakeGamepad";

function setup() {
  const api = new FakeGamepadApi();
  const pad = api.connect(0);
  const log = { game: [] as string[], commands: [] as MenuCommand[], toggles: 0 };
  let open = false;
  const router = new PadMenuRouter({
    isMenuOpen: () => open,
    toggleMenu: () => {
      open = !open;
      log.toggles++;
    },
    command: (command) => log.commands.push(command),
    toGame: (player, button, pressed) => log.game.push(`${player}:${button}:${pressed ? "down" : "up"}`),
  });
  const poller = new GamepadPoller(api.getGamepads, router.button, router.home);
  return { pad, poller, log, isOpen: () => open };
}

describe("PadMenuRouter", () => {
  it("opens the menu on Select+Start, and the game never sees both held", () => {
    const { pad, poller, log, isOpen } = setup();
    pad.buttons[8].pressed = true; // Select
    poller.poll();
    pad.buttons[9].pressed = true; // Start
    poller.poll();
    expect(isOpen()).toBe(true);
    expect(log.game).toEqual(["1:Select:down", "1:Select:up"]);
  });

  it("drives the menu while it is open: D-pad moves, A chooses, B goes back", () => {
    const { pad, poller, log } = setup();
    pad.buttons[8].pressed = true;
    pad.buttons[9].pressed = true;
    poller.poll();
    pad.buttons[8].pressed = false;
    pad.buttons[9].pressed = false;
    poller.poll();
    for (const index of [13, 12, 15, 14, 1, 0]) {
      pad.buttons[index].pressed = true;
      poller.poll();
      pad.buttons[index].pressed = false;
      poller.poll();
    }
    expect(log.commands).toEqual(["down", "up", "right", "left", "choose", "back"]);
    // Only the chord's own Select, let go as it completed; nothing after the menu opened.
    expect(log.game).toEqual(["1:Select:down", "1:Select:up"]);
  });

  it("closes the menu on Select+Start again, and on the Home button", () => {
    const { pad, poller, log, isOpen } = setup();
    pad.buttons[16].pressed = true;
    poller.poll();
    expect(isOpen()).toBe(true);
    pad.buttons[16].pressed = false;
    pad.buttons[9].pressed = true;
    poller.poll();
    pad.buttons[8].pressed = true;
    poller.poll();
    expect(isOpen()).toBe(false);
    expect(log.toggles).toBe(2);
    expect(log.commands).toEqual([]);
  });

  it("passes every other button to the game while the menu is closed", () => {
    const { pad, poller, log } = setup();
    pad.buttons[1].pressed = true;
    poller.poll();
    pad.buttons[1].pressed = false;
    poller.poll();
    expect(log.game).toEqual(["1:A:down", "1:A:up"]);
    expect(log.commands).toEqual([]);
  });
});
