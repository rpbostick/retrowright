import { describe, expect, it } from "vitest";
import { Button, BUTTONS } from "../core/types";
import { contains, controlAt, dpadDirections, ORIENTATIONS, overlaps, parseLayout, placeLayout, type Rect } from "./layout";
import { PHONE_LAYOUT } from "./layouts";
import phone from "./layouts/phone.json";

const touchArea = (control: { frame: Rect; extend: { top: number; right: number; bottom: number; left: number } }): Rect => ({
  x: control.frame.x - control.extend.left,
  y: control.frame.y - control.extend.top,
  width: control.frame.width + control.extend.left + control.extend.right,
  height: control.frame.height + control.extend.top + control.extend.bottom,
});

/** Scaling by a ratio such as 430 / 390 leaves rounding of about 1e-13 px at the edges. */
const EPSILON = 1e-6;
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - EPSILON &&
  inner.y >= outer.y - EPSILON &&
  inner.x + inner.width <= outer.x + outer.width + EPSILON &&
  inner.y + inner.height <= outer.y + outer.height + EPSILON;

const isAB = (buttons: Button[]) => buttons.length === 2 && buttons.includes(Button.A) && buttons.includes(Button.B);

/** The one pair of controls whose touch areas may overlap: the A+B area with A, or with B. */
const abWithAOrB = (first: Button[], second: Button[]) =>
  (isAB(first) && second.length === 1 && (second[0] === Button.A || second[0] === Button.B)) ||
  (isAB(second) && first.length === 1 && (first[0] === Button.A || first[0] === Button.B));

/** Page sizes the layout must work at: phones with and without browser bars, and tablets. */
const PAGES: Array<[number, number]> = [
  [390, 664],
  [375, 553],
  [390, 844],
  [430, 932],
  [844, 340],
  [667, 375],
  [932, 430],
  [768, 1024],
  [1024, 768],
  [820, 1180],
];

describe("the built-in phone layout", () => {
  for (const orientation of ORIENTATIONS) {
    describe(orientation, () => {
      const layout = PHONE_LAYOUT.orientations[orientation];
      const bounds: Rect = { x: 0, y: 0, ...layout.size };

      it("has every NES button, the A+B area, the menu and fast-forward", () => {
        expect(layout.controls.some((control) => control.kind === "fastForward")).toBe(true);
        const held = new Set(layout.controls.flatMap((control) => control.buttons));
        expect(layout.controls.some((control) => control.kind === "dpad")).toBe(true);
        for (const button of BUTTONS.filter((name) => ![Button.Up, Button.Down, Button.Left, Button.Right].includes(name))) expect(held).toContain(button);
        expect(layout.controls.some((control) => control.kind === "button" && isAB(control.buttons))).toBe(true);
        expect(layout.controls.some((control) => control.kind === "menu")).toBe(true);
      });

      it("keeps the screen and every control's frame and touch area inside the layout", () => {
        expect(inside(layout.screen.frame, bounds)).toBe(true);
        for (const control of layout.controls) {
          expect(inside(control.frame, bounds), `${control.id} frame`).toBe(true);
          expect(inside(touchArea(control), bounds), `${control.id} touch area`).toBe(true);
        }
      });

      it("draws no control over the picture", () => {
        for (const control of layout.controls) expect(overlaps(control.frame, layout.screen.frame), control.id).toBe(false);
      });

      it("has no overlapping touch areas except the A+B area's with A and B", () => {
        const controls = layout.controls;
        for (const [index, first] of controls.entries()) {
          for (const second of controls.slice(index + 1)) {
            if (abWithAOrB(first.buttons, second.buttons)) continue;
            expect(overlaps(touchArea(first), touchArea(second)), `${first.id} and ${second.id}`).toBe(false);
          }
        }
      });

      it("stays free of overlaps when placed on phone and tablet pages of every shape", () => {
        for (const [width, height] of PAGES) {
          if ((width > height ? "landscape" : "portrait") !== orientation) continue;
          const placed = placeLayout(PHONE_LAYOUT, width, height);
          const page: Rect = { x: 0, y: 0, width, height };
          expect(inside(placed.screen, page), `screen at ${width}x${height}`).toBe(true);
          for (const [index, first] of placed.controls.entries()) {
            expect(inside(first.touch, page), `${first.control.id} at ${width}x${height}`).toBe(true);
            expect(overlaps(first.frame, placed.screen), `${first.control.id} over the screen at ${width}x${height}`).toBe(false);
            for (const second of placed.controls.slice(index + 1)) {
              if (abWithAOrB(first.control.buttons, second.control.buttons)) continue;
              expect(overlaps(first.touch, second.touch), `${first.control.id} and ${second.control.id} at ${width}x${height}`).toBe(false);
            }
          }
        }
      });
    });
  }

  it("puts the picture above the controls in portrait and the controls beside it in landscape", () => {
    const portrait = placeLayout(PHONE_LAYOUT, 390, 664);
    expect(portrait.orientation).toBe("portrait");
    const dpad = portrait.controls.find((placed) => placed.control.kind === "dpad")!;
    expect(dpad.frame.y).toBeGreaterThanOrEqual(portrait.screen.y + portrait.screen.height);
    const landscape = placeLayout(PHONE_LAYOUT, 844, 340);
    expect(landscape.orientation).toBe("landscape");
    const left = landscape.controls.find((placed) => placed.control.kind === "dpad")!;
    const a = landscape.controls.find((placed) => placed.control.id === "a")!;
    expect(left.frame.x + left.frame.width).toBeLessThanOrEqual(landscape.screen.x);
    expect(a.frame.x).toBeGreaterThanOrEqual(landscape.screen.x + landscape.screen.width);
  });

  it("scales up on a tablet and grows each control about its centre with the Size setting", () => {
    const phonePage = placeLayout(PHONE_LAYOUT, 390, 640);
    const tablet = placeLayout(PHONE_LAYOUT, 780, 1280);
    const phoneA = phonePage.controls.find((placed) => placed.control.id === "a")!;
    const tabletA = tablet.controls.find((placed) => placed.control.id === "a")!;
    expect(tabletA.frame.width).toBeCloseTo(phoneA.frame.width * 2);
    const bigger = placeLayout(PHONE_LAYOUT, 390, 640, 1.2).controls.find((placed) => placed.control.id === "a")!;
    expect(bigger.frame.width).toBeCloseTo(phoneA.frame.width * 1.2);
    expect(bigger.frame.x + bigger.frame.width / 2).toBeCloseTo(phoneA.frame.x + phoneA.frame.width / 2);
  });

  it("gives a touch between A and B to the A+B area, and a touch on an extended edge to its control", () => {
    const placed = placeLayout(PHONE_LAYOUT, 390, 640).controls;
    const ab = placed.find((control) => isAB(control.control.buttons))!;
    const a = placed.find((control) => control.control.id === "a")!;
    expect(controlAt(placed, ab.frame.x + ab.frame.width / 2, ab.frame.y + ab.frame.height / 2)?.control.id).toBe("ab");
    // Just above A's drawn frame, inside its extended top edge.
    expect(contains(a.frame, a.frame.x + 30, a.frame.y - 10)).toBe(false);
    expect(controlAt(placed, a.frame.x + 30, a.frame.y - 10)?.control.id).toBe("a");
    expect(controlAt(placed, 200, 380)).toBeNull();
  });
});

describe("parseLayout", () => {
  it("refuses a layout that names a button the NES does not have, or leaves out an orientation", () => {
    const bad = structuredClone(phone) as { orientations: { portrait: { controls: Array<{ buttons?: string[] }> }; landscape?: unknown } };
    bad.orientations.portrait.controls[3].buttons = ["X"];
    expect(() => parseLayout(bad)).toThrow('orientations.portrait.controls[3].buttons[0] must be one of Up, Down, Left, Right, B, A, Select, Start, not "X".');
    const noLandscape = structuredClone(phone) as { orientations: { landscape?: unknown } };
    delete noLandscape.orientations.landscape;
    expect(() => parseLayout(noLandscape)).toThrow("orientations.landscape must be an object.");
  });
});

describe("the D-pad", () => {
  const frame: Rect = { x: 0, y: 0, width: 100, height: 100 };
  const at = (degrees: number, radius = 40) => {
    const radians = (degrees * Math.PI) / 180;
    return dpadDirections(frame, 30, 50 + radius * Math.cos(radians), 50 + radius * Math.sin(radians));
  };

  it("holds one direction on each arm", () => {
    expect(at(0)).toEqual([Button.Right]);
    expect(at(90)).toEqual([Button.Down]);
    expect(at(180)).toEqual([Button.Left]);
    expect(at(-90)).toEqual([Button.Up]);
  });

  it("holds two directions in each diagonal sector, 30 degrees wide", () => {
    expect(at(45)).toEqual([Button.Down, Button.Right]);
    expect(at(-45)).toEqual([Button.Up, Button.Right]);
    expect(at(135)).toEqual([Button.Down, Button.Left]);
    expect(at(-135)).toEqual([Button.Up, Button.Left]);
    expect(at(31)).toEqual([Button.Down, Button.Right]);
    expect(at(29)).toEqual([Button.Right]);
    expect(at(59)).toEqual([Button.Down, Button.Right]);
    expect(at(61)).toEqual([Button.Down]);
  });

  it("holds nothing in the dead centre, and keeps steering outside its frame", () => {
    expect(at(0, 5)).toEqual([]);
    expect(at(180, 120)).toEqual([Button.Left]);
  });
});
