// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { NES_VIDEO, type VideoDescription } from "../core/types";
import { DEFAULT_DISPLAY_PREFS, effectiveScaling, loadDisplayPrefs, pictureSize, saveDisplayPrefs } from "./displayPrefs";

const GBA_VIDEO: VideoDescription = { width: 240, height: 160, pixelAspect: { width: 1, height: 1 }, frameRate: 59.7275 };

describe("pictureSize", () => {
  it("gives a whole-number scale with integer scaling at every box size, never below one", () => {
    const sizes = [
      [800, 600],
      [1280, 900],
      [1920, 1080],
      [200, 150],
    ].map(([width, height]) => pictureSize(NES_VIDEO, width, height, { scaling: "integer", aspect: "core" }));
    expect(sizes.map((size) => size.scale)).toEqual([2, 3, 4, 1]);
    for (const size of sizes) {
      expect(size.height).toBe(240 * size.scale);
      expect(size.width).toBeCloseTo(((256 * 8) / 7) * size.scale, 9);
    }
  });

  it("widens the picture to 8/7 of its square width with the core's aspect, at the same height", () => {
    const square = pictureSize(NES_VIDEO, 1280, 900, { scaling: "integer", aspect: "square" });
    const nes = pictureSize(NES_VIDEO, 1280, 900, { scaling: "integer", aspect: "core" });
    expect(square).toEqual({ width: 768, height: 720, scale: 3 });
    expect(nes.height).toBe(square.height);
    expect(nes.width / square.width).toBeCloseTo(8 / 7, 12);
  });

  it("fills the box as far as the shape allows with fill scaling", () => {
    expect(pictureSize(NES_VIDEO, 1024, 600, { scaling: "fill", aspect: "square" })).toEqual({ width: 640, height: 600, scale: 2.5 });
    const wide = pictureSize(NES_VIDEO, 585.142857, 10_000, { scaling: "fill", aspect: "core" });
    expect(wide.scale).toBeCloseTo(2, 6);
  });

  it("takes the frame size and pixel shape from the core, so square pixels change nothing", () => {
    const core = pictureSize(GBA_VIDEO, 1000, 700, { scaling: "integer", aspect: "core" });
    expect(core).toEqual({ width: 960, height: 640, scale: 4 });
    expect(pictureSize(GBA_VIDEO, 1000, 700, { scaling: "integer", aspect: "square" })).toEqual(core);
  });
});

describe("effectiveScaling", () => {
  it("fills the touch layout's rectangle and keeps whole multiples on the page until the player chooses", () => {
    expect(effectiveScaling("auto", true)).toBe("fill");
    expect(effectiveScaling("auto", false)).toBe("integer");
    expect(effectiveScaling("integer", true)).toBe("integer");
    expect(effectiveScaling("fill", false)).toBe("fill");
  });
});

describe("display settings", () => {
  afterEach(() => localStorage.clear());

  it("are the defaults with nothing saved: scaling not chosen, the core's aspect, no scanlines", () => {
    expect(loadDisplayPrefs(localStorage)).toEqual({ prefs: DEFAULT_DISPLAY_PREFS });
    expect(DEFAULT_DISPLAY_PREFS).toMatchObject({ scaling: "auto", aspect: "core", scanlines: false, showControls: false, developerTools: false, showConsole: false });
    expect(loadDisplayPrefs(undefined)).toEqual({ prefs: DEFAULT_DISPLAY_PREFS });
  });

  it("come back as saved, a chosen integer scaling, the controls panel, Developer tools and the console too", () => {
    for (const scaling of ["fill", "integer", "auto"] as const) {
      for (const showControls of [true, false]) {
        for (const developerTools of [true, false]) {
          for (const showConsole of [true, false]) {
            const prefs = { scaling, aspect: "square", scanlines: true, scanlineIntensity: 0.6, fastForwardSpeed: 4, showControls, developerTools, showConsole } as const;
            saveDisplayPrefs(localStorage, prefs);
            expect(loadDisplayPrefs(localStorage)).toEqual({ prefs });
          }
        }
      }
    }
  });

  it("read the fourth version's Developer console setting as Developer tools, with the console as it was", () => {
    const fourth = { version: 4, scaling: "fill", aspect: "square", scanlines: true, scanlineIntensity: 0.6, fastForwardSpeed: 4, showControls: true };
    const kept = { scaling: "fill", aspect: "square", scanlines: true, scanlineIntensity: 0.6, fastForwardSpeed: 4, showControls: true };
    localStorage.setItem("retrowright.display", JSON.stringify({ ...fourth, showConsole: true }));
    expect(loadDisplayPrefs(localStorage)).toEqual({ prefs: { ...kept, developerTools: true, showConsole: true } });
    localStorage.setItem("retrowright.display", JSON.stringify({ ...fourth, showConsole: false }));
    expect(loadDisplayPrefs(localStorage)).toEqual({ prefs: { ...kept, developerTools: false, showConsole: false } });
  });

  it("read the third version's settings, from before the developer console, with the console and Developer tools off", () => {
    const third = { version: 3, scaling: "fill", aspect: "square", scanlines: true, scanlineIntensity: 0.6, fastForwardSpeed: 4, showControls: true };
    localStorage.setItem("retrowright.display", JSON.stringify(third));
    expect(loadDisplayPrefs(localStorage)).toEqual({
      prefs: { scaling: "fill", aspect: "square", scanlines: true, scanlineIntensity: 0.6, fastForwardSpeed: 4, showControls: true, developerTools: false, showConsole: false },
    });
  });

  it("read the first version's settings, whose integer scaling was written unchosen, as the default", () => {
    const first = { aspect: "square", scanlines: true, scanlineIntensity: 0.6, fastForwardSpeed: 4 };
    localStorage.setItem("retrowright.display", JSON.stringify({ scaling: "integer", ...first }));
    expect(loadDisplayPrefs(localStorage)).toEqual({ prefs: { scaling: "auto", ...first, showControls: false, developerTools: false, showConsole: false } });
    localStorage.setItem("retrowright.display", JSON.stringify({ scaling: "fill", ...first }));
    expect(loadDisplayPrefs(localStorage)).toEqual({ prefs: { scaling: "fill", ...first, showControls: false, developerTools: false, showConsole: false } });
  });

  it("read the second version's settings, from before the controls panel, with the panel off", () => {
    const second = { version: 2, scaling: "integer", aspect: "square", scanlines: true, scanlineIntensity: 0.6, fastForwardSpeed: 4 };
    localStorage.setItem("retrowright.display", JSON.stringify(second));
    expect(loadDisplayPrefs(localStorage)).toEqual({
      prefs: { scaling: "integer", aspect: "square", scanlines: true, scanlineIntensity: 0.6, fastForwardSpeed: 4, showControls: false, developerTools: false, showConsole: false },
    });
  });

  it("say so and use the defaults when what is saved cannot be read", () => {
    const saved = { version: 5, ...DEFAULT_DISPLAY_PREFS };
    for (const raw of [
      "{",
      "null",
      JSON.stringify({ ...saved, scaling: "stretch" }),
      JSON.stringify({ ...saved, fastForwardSpeed: 8 }),
      JSON.stringify({ ...saved, scanlineIntensity: 2 }),
      JSON.stringify({ ...saved, showControls: "yes" }),
      JSON.stringify({ ...saved, showControls: undefined }),
      JSON.stringify({ ...saved, showConsole: "on" }),
      JSON.stringify({ ...saved, showConsole: undefined }),
      JSON.stringify({ ...saved, developerTools: "on" }),
      JSON.stringify({ ...saved, developerTools: undefined }),
      JSON.stringify({ ...saved, version: 4, showConsole: undefined }),
      JSON.stringify({ ...saved, version: 6 }),
      // "auto" did not exist in the first version.
      JSON.stringify({ ...DEFAULT_DISPLAY_PREFS }),
    ]) {
      localStorage.setItem("retrowright.display", raw);
      const loaded = loadDisplayPrefs(localStorage);
      expect(loaded.prefs, raw).toEqual(DEFAULT_DISPLAY_PREFS);
      expect(loaded.problem, raw).toBe("Saved display settings could not be read, so the defaults are in use.");
    }
  });
});
