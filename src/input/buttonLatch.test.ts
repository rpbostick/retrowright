import { describe, expect, it } from "vitest";
import { Button } from "../core/types";
import { ButtonLatch } from "./buttonLatch";

function latchWithLog() {
  const log: string[] = [];
  const latch = new ButtonLatch(
    (player, button) => log.push(`down ${player}:${button}`),
    (player, button) => log.push(`up ${player}:${button}`),
  );
  return { latch, log };
}

describe("ButtonLatch", () => {
  it("keeps Down held by its own key when a combo key holding Down+B is let go", () => {
    const { latch, log } = latchWithLog();
    latch.set("keyboard:KeyS", 1, Button.Down, true);
    latch.set("keyboard:KeyC", 1, Button.Down, true);
    latch.set("keyboard:KeyC", 1, Button.B, true);
    latch.releaseSource("keyboard:KeyC");
    expect(log).toEqual(["down 1:Down", "down 1:B", "up 1:B"]);
    latch.releaseSource("keyboard:KeyS");
    expect(log).toEqual(["down 1:Down", "down 1:B", "up 1:B", "up 1:Down"]);
  });

  it("lets go of every key's buttons, on both pads, when the keyboard is let go", () => {
    const { latch, log } = latchWithLog();
    latch.set("keyboard:KeyC", 1, Button.Down, true);
    latch.set("keyboard:KeyC", 1, Button.B, true);
    latch.set("keyboard:KeyM", 2, Button.A, true);
    latch.set("mouse:Mouse0", 1, Button.A, true);
    latch.set("gamepad", 1, Button.Down, true);
    latch.releaseSource("keyboard");
    expect(log).toEqual(["down 1:Down", "down 1:B", "down 2:A", "down 1:A", "up 1:B", "up 2:A"]);
    latch.releaseSource("mouse");
    expect(log.at(-1)).toBe("up 1:A");
  });
});
