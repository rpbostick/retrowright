import { describe, expect, it } from "vitest";
import { JsnesCore } from "../core/jsnesCore";
import { Button } from "../core/types";
import { buildInes, FLAG_OPPOSITES_PROGRAM, READ_BOTH_PADS_PROGRAM } from "./syntheticRom";

describe("READ_BOTH_PADS_PROGRAM", () => {
  it("keeps pad 1's buttons in $20 and pad 2's in $21, A as bit 7 and Right as bit 0", () => {
    const core = new JsnesCore({ onFrame: () => {}, onAudioSample: () => {}, onBatteryRamWrite: () => {} });
    core.load(buildInes({ program: READ_BOTH_PADS_PROGRAM }));
    core.frame();
    expect([core.peek(0x20), core.peek(0x21)]).toEqual([0, 0]);
    core.buttonDown(1, Button.Down);
    core.buttonDown(1, Button.B);
    core.buttonDown(2, Button.A);
    core.buttonDown(2, Button.Right);
    core.frame();
    expect([core.peek(0x20), core.peek(0x21)]).toEqual([0x44, 0x81]);
    core.buttonUp(1, Button.B);
    core.buttonUp(2, Button.A);
    core.frame();
    expect([core.peek(0x20), core.peek(0x21)]).toEqual([0x04, 0x01]);
  });
});

describe("FLAG_OPPOSITES_PROGRAM", () => {
  const flagAfter = (press: (core: JsnesCore) => void) => {
    const core = new JsnesCore({ onFrame: () => {}, onAudioSample: () => {}, onBatteryRamWrite: () => {} });
    core.load(buildInes({ program: FLAG_OPPOSITES_PROGRAM }));
    core.frame();
    const before = core.peek(0x22);
    press(core);
    core.frame();
    const during = core.peek(0x22);
    for (const button of [Button.Up, Button.Down, Button.Left, Button.Right]) {
      core.buttonUp(1, button);
      core.buttonUp(2, button);
    }
    core.frame();
    return [before, during, core.peek(0x22)];
  };

  it("leaves $22 at 0 while no pad reads both of a pair, and reads the pads as READ_BOTH_PADS_PROGRAM does", () => {
    const core = new JsnesCore({ onFrame: () => {}, onAudioSample: () => {}, onBatteryRamWrite: () => {} });
    core.load(buildInes({ program: FLAG_OPPOSITES_PROGRAM }));
    core.buttonDown(1, Button.Left);
    core.buttonDown(1, Button.Up);
    core.buttonDown(2, Button.Right);
    core.buttonDown(2, Button.Down);
    core.frame();
    expect([core.peek(0x20), core.peek(0x21), core.peek(0x22)]).toEqual([0x0a, 0x05, 0]);
  });

  it.each([
    [1, Button.Left, Button.Right],
    [1, Button.Up, Button.Down],
    [2, Button.Left, Button.Right],
    [2, Button.Up, Button.Down],
  ] as const)("sets $22 to 1 for good once pad %i reads %s with %s", (pad, first, second) => {
    expect(
      flagAfter((core) => {
        core.buttonDown(pad, first);
        core.buttonDown(pad, second);
      }),
    ).toEqual([0, 1, 1]);
  });
});
