import { describe, expect, it } from "vitest";
import { Button } from "../core/types";
import { placeLayout, type PlacedControl } from "./layout";
import { PHONE_LAYOUT } from "./layouts";
import { TouchTracker } from "./touchTracker";

function setup() {
  const controls = placeLayout(PHONE_LAYOUT, 390, 640).controls;
  const log: string[] = [];
  let menus = 0;
  const tracker = new TouchTracker(controls, {
    onButton: (button, pressed) => log.push(`${pressed ? "+" : "-"}${button}`),
    onMenu: () => menus++,
    onFastForward: (held) => log.push(held ? "+fast" : "-fast"),
  });
  const find = (id: string) => controls.find((placed) => placed.control.id === id)!;
  return { tracker, log, find, menus: () => menus };
}

const centre = (placed: PlacedControl) => ({ x: placed.frame.x + placed.frame.width / 2, y: placed.frame.y + placed.frame.height / 2 });
/** A point on the D-pad at `degrees` (0 is right, 90 is down), 40% of its width from the centre. */
function onDpad(dpad: PlacedControl, degrees: number) {
  const { x, y } = centre(dpad);
  const radians = (degrees * Math.PI) / 180;
  return { x: x + 0.4 * dpad.frame.width * Math.cos(radians), y: y + 0.4 * dpad.frame.width * Math.sin(radians) };
}

describe("TouchTracker", () => {
  it("slides around the D-pad without lifting: right, through the diagonal, to down, then up and off its frame", () => {
    const { tracker, log, find } = setup();
    const dpad = find("dpad");
    const go = (degrees: number) => onDpad(dpad, degrees);
    tracker.down(1, go(0).x, go(0).y);
    expect(log).toEqual(["+Right"]);
    tracker.move(1, go(45).x, go(45).y);
    expect(log).toEqual(["+Right", "+Down"]);
    tracker.move(1, go(90).x, go(90).y);
    expect(log).toEqual(["+Right", "+Down", "-Right"]);
    tracker.move(1, go(-90).x, go(-90).y);
    expect(log.slice(3)).toEqual(["-Down", "+Up"]);
    // Off the D-pad's frame and touch area, above it: the finger still steers it.
    tracker.move(1, centre(dpad).x, dpad.touch.y - 30);
    expect(log.slice(5)).toEqual([]);
    tracker.up(1, centre(dpad).x, dpad.touch.y - 30);
    expect(log.slice(5)).toEqual(["-Up"]);
  });

  it("holds a direction and A at once with two fingers", () => {
    const { tracker, log, find } = setup();
    const left = onDpad(find("dpad"), 180);
    tracker.down(1, left.x, left.y);
    tracker.down(2, centre(find("a")).x, centre(find("a")).y);
    expect(log).toEqual(["+Left", "+A"]);
    tracker.up(2, 0, 0);
    expect(log).toEqual(["+Left", "+A", "-A"]);
    tracker.up(1, 0, 0);
    expect(log).toEqual(["+Left", "+A", "-A", "-Left"]);
  });

  it("slides from B through the A+B area to A, and keeps B down while another finger holds it", () => {
    const { tracker, log, find } = setup();
    const [b, ab, a] = [centre(find("b")), centre(find("ab")), centre(find("a"))];
    tracker.down(1, b.x, b.y);
    tracker.move(1, ab.x, ab.y);
    expect(log).toEqual(["+B", "+A"]);
    tracker.down(2, b.x, b.y); // a second finger on B
    tracker.move(1, a.x, a.y);
    expect(log).toEqual(["+B", "+A"]);
    tracker.up(2, b.x, b.y);
    expect(log).toEqual(["+B", "+A", "-B"]);
    tracker.releaseAll();
    expect(log).toEqual(["+B", "+A", "-B", "-A"]);
  });

  it("does not let a button finger slide onto the D-pad, and lets go of it off every button", () => {
    const { tracker, log, find } = setup();
    const b = centre(find("b"));
    tracker.down(1, b.x, b.y);
    const right = onDpad(find("dpad"), 0);
    tracker.move(1, right.x, right.y);
    expect(log).toEqual(["+B", "-B"]);
  });

  it("opens the menu for a finger lifted on the menu button, not for a cancelled one", () => {
    const { tracker, log, find, menus } = setup();
    const menu = centre(find("menu"));
    tracker.down(1, menu.x, menu.y);
    expect(menus()).toBe(0);
    tracker.up(1, menu.x, menu.y);
    expect(menus()).toBe(1);
    tracker.down(2, menu.x, menu.y);
    tracker.cancel(2);
    tracker.down(3, menu.x, menu.y);
    tracker.up(3, 5, 5); // lifted far away
    expect(menus()).toBe(1);
    expect(log).toEqual([]);
  });

  it("holds fast-forward while any finger that came down on it stays, even sliding off, and presses no NES button", () => {
    const { tracker, log, find } = setup();
    const fast = centre(find("fast"));
    tracker.down(1, fast.x, fast.y);
    tracker.down(2, fast.x, fast.y);
    tracker.move(1, 5, 5);
    expect(log).toEqual(["+fast"]);
    expect(tracker.held()).toEqual(new Map([["fast", []]]));
    tracker.up(1, 5, 5);
    expect(log).toEqual(["+fast"]);
    tracker.cancel(2);
    expect(log).toEqual(["+fast", "-fast"]);
  });

  it("lets every finger go when the controls are placed again (a rotation)", () => {
    const { tracker, log, find } = setup();
    const a = centre(find("a"));
    tracker.down(1, a.x, a.y);
    tracker.setControls(placeLayout(PHONE_LAYOUT, 844, 340).controls);
    expect(log).toEqual(["+A", "-A"]);
    expect(tracker.held().size).toBe(0);
  });

  it("reports which control holds which buttons, for the pressed look", () => {
    const { tracker, find } = setup();
    const downRight = onDpad(find("dpad"), 45);
    tracker.down(1, downRight.x, downRight.y);
    expect(tracker.held()).toEqual(new Map([["dpad", [Button.Down, Button.Right]]]));
  });
});
