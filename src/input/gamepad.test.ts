import { describe, expect, it } from "vitest";
import { Button, type Player } from "../core/types";
import { JsnesCore } from "../core/jsnesCore";
import { GamepadPoller } from "./gamepad";
import { ButtonLatch } from "./buttonLatch";
import { buildInes, READ_BOTH_PADS_PROGRAM } from "../test/syntheticRom";
import { FakeGamepadApi } from "../test/fakeGamepad";

function recorder() {
  const events: string[] = [];
  const onChange = (player: Player, button: Button, pressed: boolean) =>
    events.push(`${player}:${button}:${pressed ? "down" : "up"}`);
  return { events, onChange };
}

describe("GamepadPoller", () => {
  it("reports presses and releases once each", () => {
    const api = new FakeGamepadApi();
    const pad = api.connect(0);
    const { events, onChange } = recorder();
    const poller = new GamepadPoller(api.getGamepads, onChange);

    pad.buttons[9].pressed = true; // Start
    poller.poll();
    poller.poll();
    pad.buttons[9].pressed = false;
    pad.buttons[1].pressed = true; // right face button
    poller.poll();
    expect(events).toEqual(["1:Start:down", "1:A:down", "1:Start:up"]);
  });

  it("reads the d-pad and the left stick", () => {
    const api = new FakeGamepadApi();
    const pad = api.connect(0);
    const { events, onChange } = recorder();
    const poller = new GamepadPoller(api.getGamepads, onChange);

    pad.buttons[12].pressed = true;
    pad.axes[0] = -0.9;
    poller.poll();
    pad.axes[0] = 0.2; // inside the dead zone
    poller.poll();
    expect(events).toEqual(["1:Up:down", "1:Left:down", "1:Left:up"]);
  });

  it("gives the second connected pad to player 2, skipping empty slots", () => {
    const api = new FakeGamepadApi();
    api.connect(0);
    api.pads[1] = null;
    const second = api.connect(2);
    const { events, onChange } = recorder();
    const poller = new GamepadPoller(api.getGamepads, onChange);
    second.buttons[0].pressed = true;
    poller.poll();
    expect(events).toEqual(["2:B:down"]);
  });

  it("releases held buttons when the pad disconnects", () => {
    const api = new FakeGamepadApi();
    const pad = api.connect(0);
    const { events, onChange } = recorder();
    const poller = new GamepadPoller(api.getGamepads, onChange);
    pad.buttons[8].pressed = true;
    poller.poll();
    pad.connected = false;
    poller.poll();
    expect(events).toEqual(["1:Select:down", "1:Select:up"]);
  });

  it("reports the Home button once per press, from any pad", () => {
    const api = new FakeGamepadApi();
    api.connect(0);
    const second = api.connect(1);
    let homes = 0;
    const poller = new GamepadPoller(api.getGamepads, () => {}, () => homes++);
    second.buttons[16].pressed = true;
    poller.poll();
    poller.poll();
    second.buttons[16].pressed = false;
    poller.poll();
    second.buttons[16].pressed = true;
    poller.poll();
    expect(homes).toBe(2);
  });

  it("reports the right trigger held and let go for fast-forward, kept from the game", () => {
    const api = new FakeGamepadApi();
    const pad = api.connect(0);
    const { events, onChange } = recorder();
    const held: boolean[] = [];
    const poller = new GamepadPoller(api.getGamepads, onChange, () => {}, (on) => held.push(on));
    pad.buttons[7].pressed = true;
    poller.poll();
    poller.poll();
    pad.buttons[7].pressed = false;
    poller.poll();
    expect(held).toEqual([true, false]);
    expect(events).toEqual([]);
  });

  it("reaches the game: a pad's Start is read by the game", () => {
    const api = new FakeGamepadApi();
    const pad = api.connect(0);
    const core = new JsnesCore({ onFrame() {}, onAudioSample() {}, onBatteryRamWrite() {} });
    core.load(buildInes({ program: READ_BOTH_PADS_PROGRAM }));
    const latch = new ButtonLatch(
      (player, button) => core.buttonDown(player, button),
      (player, button) => core.buttonUp(player, button),
    );
    const poller = new GamepadPoller(api.getGamepads, (player, button, pressed) => latch.set("gamepad", player, button, pressed));
    // READ_BOTH_PADS_PROGRAM keeps pad 1 at $20, Start in bit 4.
    const startRead = () => {
      core.frame();
      return core.peek(0x20) & 0x10;
    };

    pad.buttons[9].pressed = true;
    poller.poll();
    expect(startRead()).toBe(0x10);
    pad.buttons[9].pressed = false;
    poller.poll();
    expect(startRead()).toBe(0);
  });
});

describe("ButtonLatch", () => {
  it("keeps a button down while any source holds it", () => {
    const calls: string[] = [];
    const latch = new ButtonLatch(
      (player, button) => calls.push(`down ${player} ${button}`),
      (player, button) => calls.push(`up ${player} ${button}`),
    );
    latch.set("keyboard", 1, Button.A, true);
    latch.set("gamepad", 1, Button.A, true);
    latch.set("keyboard", 1, Button.A, false);
    expect(calls).toEqual(["down 1 A"]);
    latch.set("gamepad", 1, Button.A, false);
    expect(calls).toEqual(["down 1 A", "up 1 A"]);
  });

  it("releases everything one source holds", () => {
    const calls: string[] = [];
    const latch = new ButtonLatch(
      (player, button) => calls.push(`down ${player} ${button}`),
      (player, button) => calls.push(`up ${player} ${button}`),
    );
    latch.set("keyboard", 1, Button.Left, true);
    latch.set("keyboard", 2, Button.B, true);
    latch.set("gamepad", 1, Button.Start, true);
    latch.releaseSource("keyboard");
    expect(calls).toEqual(["down 1 Left", "down 2 B", "down 1 Start", "up 1 Left", "up 2 B"]);
  });
});
