// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMovie } from "../movie/format";
import { sha256Hex } from "../storage/gameStore";
import { FakeGamepadApi } from "../test/fakeGamepad";
import { openNewerVersion, openVersion1 } from "../test/otherTab";
import { buildInes } from "../test/syntheticRom";
import { placeLayout } from "../touch/layout";
import { PHONE_LAYOUT } from "../touch/layouts";
import { parseTunables } from "../tune/tunables";
import { App } from "./App";
import { LOCAL_FOLDER_META } from "./gameFiles";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom draws nothing: a 2D context that accepts the calls, and a fixed thumbnail.
const THUMBNAIL = "data:image/png;base64,iVBORw0KGgo=";
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
  return {
    canvas: this,
    createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData() {},
    drawImage() {},
  };
} as unknown as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toDataURL = () => THUMBNAIL;
/** jsdom lays nothing out: every observed box reports a phone's page in portrait. */
const PAGE = { width: 390, height: 664 };
globalThis.ResizeObserver = class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([{ contentRect: PAGE } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  disconnect() {}
  unobserve() {}
};

const gamepads = new FakeGamepadApi();
Object.defineProperty(navigator, "getGamepads", { configurable: true, value: gamepads.getGamepads });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // A fresh browser store per test: nothing saved by one test is read by the next.
  Object.defineProperty(window, "indexedDB", { configurable: true, value: new IDBFactory() });
  // Settings too: a scaling chosen in one test is not the next one's default.
  localStorage.clear();
  document.head.querySelector(`meta[name="${LOCAL_FOLDER_META}"]`)?.remove();
  gamepads.pads = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function waitFor<T>(description: string, probe: () => T, timeoutMs = 3000): Promise<NonNullable<T>> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value as NonNullable<T>;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${description}. Notices: "${container.querySelector(".notices")?.textContent ?? ""}"`);
    }
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  }
}

const debug = () => window.__retrowright!;
const dialog = () => container.querySelector("[role=dialog]");

function romFile(name: string, rom: Uint8Array): File {
  const file = new File([rom as Uint8Array<ArrayBuffer>], name);
  // jsdom's File has no arrayBuffer().
  Object.defineProperty(file, "arrayBuffer", { value: async () => rom.slice().buffer });
  return file;
}

async function showLibrary() {
  act(() => root.render(<App />));
  await waitFor("the file input", () => container.querySelector<HTMLInputElement>("#rom-input"));
  // Wait for the store to open: the Library says whether it persists only after.
  await waitFor("the player", () => window.__retrowright);
}

/** Chooses files in the library's Add games… picker. */
async function addFiles(...files: File[]) {
  const input = container.querySelector<HTMLInputElement>("#rom-input")!;
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const cards = () => [...container.querySelectorAll<HTMLElement>(".card-open")];
const noticeText = () => container.querySelector(".notices")?.textContent ?? "";

/** Adds one ROM, which starts at once. */
async function startGame() {
  await showLibrary();
  await addFiles(romFile("synthetic.nes", buildInes({ battery: true })));
  await waitFor("the game to run", () => debug().game && debug().framesRun > 5);
}

/** Turns the Display setting Developer tools on in the menu, and goes back to the game. */
function turnOnDeveloperTools() {
  pressKey("Escape");
  act(() => container.querySelector<HTMLElement>("[data-item=display]")!.click());
  act(() => container.querySelector<HTMLElement>("[data-item=developer-tools]")!.click());
  pressKey("Escape");
  pressKey("Escape");
  act(() => container.querySelector<HTMLElement>("canvas.screen")!.focus());
}

/** The rows of the controls panel's table whose first column is headed `heading`, as [label, keys]. */
const sideTable = (heading: string) =>
  [...container.querySelectorAll(".controls-side table")]
    .find((table) => table.querySelector("thead th")?.textContent === heading)
    ?.querySelectorAll("tbody tr");

/** Closes the page without Quit, and opens it again on the same browser storage. */
async function reopenPage() {
  await act(async () => root.unmount());
  root = createRoot(container);
  await showLibrary();
}

async function expectRunning() {
  const before = debug().framesRun;
  await waitFor("frames to run", () => debug().framesRun > before + 2);
  expect(debug().paused).toBe(false);
}

async function expectPaused() {
  expect(debug().paused).toBe(true);
  const before = debug().framesRun;
  await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
  expect(debug().framesRun).toBe(before);
}

function pressKey(code: string, key = code, target: Element = document.activeElement ?? document.body) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true }));
    target.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true, cancelable: true }));
  });
}

describe("App and the quick menu", () => {
  it("Esc opens the menu and pauses; Resume closes it, resumes and gives focus back to the game", async () => {
    await startGame();
    pressKey("Escape");
    expect(dialog()).not.toBeNull();
    await expectPaused();
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    act(() => container.querySelector<HTMLElement>("[data-item=resume]")!.click());
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("canvas.screen"));
    await expectRunning();
  });

  it("the menu buttons open the menu and pause; Esc closes it and resumes", async () => {
    await startGame();
    act(() => container.querySelector<HTMLElement>(".menu-corner")!.click());
    expect(dialog()).not.toBeNull();
    await expectPaused();
    pressKey("Escape");
    expect(dialog()).toBeNull();
    await expectRunning();
    act(() => container.querySelector<HTMLElement>(".play-bar .menu-open")!.click());
    expect(dialog()).not.toBeNull();
    await expectPaused();
  });

  it("Select+Start on a gamepad opens the menu and pauses; pressing them again closes it", async () => {
    await startGame();
    const pad = gamepads.connect(0);
    pad.buttons[8].pressed = true;
    pad.buttons[9].pressed = true;
    await waitFor("the menu to open", dialog);
    await expectPaused();
    pad.buttons[8].pressed = false;
    pad.buttons[9].pressed = false;
    // The open menu polls the pad itself: the D-pad moves focus.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    pad.buttons[13].pressed = true;
    await waitFor("focus to move down", () => (document.activeElement as HTMLElement).dataset.item === "save");
    pad.buttons[13].pressed = false;
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    pad.buttons[8].pressed = true;
    pad.buttons[9].pressed = true;
    await waitFor("the menu to close", () => !dialog());
    await expectRunning();
  });

  it("F5 saves to the current slot with a thumbnail; the slot grid shows it and F7 loads it", async () => {
    await startGame();
    pressKey("F5");
    await waitFor("the save notice", () => container.querySelector(".notices")?.textContent?.includes("Saved to slot 1."));
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=load]")!.click());
    const card = await waitFor("slot 1's card", () => container.querySelector<HTMLElement>("[data-slot='1']:not([aria-disabled=true])"));
    expect(card.querySelector("img")?.getAttribute("src")).toBe(THUMBNAIL);
    pressKey("Escape");
    pressKey("Escape");
    pressKey("F7");
    await waitFor("the load notice", () => container.querySelector(".notices")?.textContent?.includes("Loaded slot 1."));
  });

  it("Tab fast-forwards only from the picture; from the play bar, and with Shift, it moves focus to Menu, Mute and the volume", async () => {
    await startGame();
    const canvas = container.querySelector<HTMLCanvasElement>("canvas.screen")!;
    /** Dispatches a key press on `target` and says whether the page kept it from the browser's own handling. */
    const keyDown = (target: Element, code: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true, ...init });
      act(() => void target.dispatchEvent(event));
      return event.defaultPrevented;
    };
    const keyUp = (target: Element, code: string) => act(() => void target.dispatchEvent(new KeyboardEvent("keyup", { code, key: code, bubbles: true, cancelable: true })));

    expect(document.activeElement).toBe(canvas);
    expect(keyDown(canvas, "Tab")).toBe(true);
    expect(debug().speed).toBe(3);
    keyUp(canvas, "Tab");
    expect(debug().speed).toBe(1);

    // Shift+Tab from the picture moves focus: the browser's default is left alone and nothing speeds up.
    expect(keyDown(canvas, "Tab", { shiftKey: true })).toBe(false);
    expect(debug().speed).toBe(1);

    const menu = container.querySelector<HTMLElement>(".play-bar .menu-open")!;
    const mute = container.querySelector<HTMLElement>(".play-bar .mute")!;
    const volume = container.querySelector<HTMLElement>(".play-bar input[type=range]")!;
    for (const [control, shift] of [
      [menu, false],
      [mute, false],
      [volume, false],
      [mute, true],
    ] as const) {
      act(() => control.focus());
      expect(keyDown(control, "Tab", { shiftKey: shift }), control.className).toBe(false);
      expect(debug().speed).toBe(1);
    }
    // A control reached by Tab takes Enter and the arrows; the game does not see them.
    act(() => mute.focus());
    expect(keyDown(mute, "Enter")).toBe(false);
    expect(keyDown(volume, "ArrowRight")).toBe(false);
    expect(debug().heldButtons()).toEqual([]);
    // Hotkeys still act there: F5 saves instead of reloading the page.
    expect(keyDown(mute, "F5")).toBe(true);
    await waitFor("the save notice", () => noticeText().includes("Saved to slot 1."));
    // After a click the keys drive the game again, wherever focus is.
    act(() => void mute.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(keyDown(mute, "ArrowRight")).toBe(true);
    expect(debug().heldButtons()).toEqual(["1:Right"]);
    keyUp(mute, "ArrowRight");
  });

  it("a focused control outside the game keeps Enter: a notice's Dismiss and the Theme button act instead of Start", async () => {
    await startGame();
    pressKey("F5");
    await waitFor("the save notice", () => noticeText().includes("Saved to slot 1."));
    const theme = container.querySelector<HTMLElement>("button.theme")!;
    const themeBefore = theme.textContent;
    /** Presses Enter on `control` as a browser would: the button is clicked unless the page prevents the key's default. */
    const enterOn = (control: HTMLElement) => {
      act(() => control.focus());
      const event = new KeyboardEvent("keydown", { code: "Enter", key: "Enter", bubbles: true, cancelable: true });
      act(() => void control.dispatchEvent(event));
      expect(event.defaultPrevented, control.getAttribute("aria-label") ?? "").toBe(false);
      expect(debug().heldButtons()).toEqual([]);
      if (!event.defaultPrevented) act(() => control.click());
      act(() => void control.dispatchEvent(new KeyboardEvent("keyup", { code: "Enter", key: "Enter", bubbles: true, cancelable: true })));
    };
    const saved = [...container.querySelectorAll(".notice")].find((notice) => notice.textContent?.includes("Saved to slot 1."))!;
    enterOn(saved.querySelector<HTMLElement>("[aria-label=Dismiss]")!);
    expect(noticeText()).not.toContain("Saved to slot 1.");
    enterOn(theme);
    expect(theme.textContent).not.toBe(themeBefore);
  });

  /** A mouse click as a browser makes it: pointerdown, focus on the control, then click. */
  function clickWithPointer(control: HTMLElement) {
    act(() => {
      control.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      control.focus();
      control.click();
    });
  }

  /**
   * A mouse click as a browser delivers it: React renders what the click
   * changed before the click reaches the window, as a real click lets the
   * microtasks run between listeners. A click dispatched from a script runs
   * them only after every listener, so the document's listener renders first.
   */
  async function mouseClick(control: HTMLElement) {
    const render = () => flushSync(() => {});
    document.addEventListener("click", render);
    act(() => void control.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    control.focus();
    control.click();
    document.removeEventListener("click", render);
    await act(async () => {});
  }

  /** Presses and lets go of the right arrow where focus is, and says whether the game saw it held. */
  function arrowMovesPlayer(): boolean {
    const target = document.activeElement ?? document.body;
    act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight", key: "ArrowRight", bubbles: true, cancelable: true })));
    const held = debug().heldButtons().includes("1:Right");
    act(() => void target.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight", key: "ArrowRight", bubbles: true, cancelable: true })));
    return held;
  }

  it("gives the keys back to the game after a mouse click on Theme", async () => {
    await startGame();
    clickWithPointer(container.querySelector<HTMLElement>("button.theme")!);
    expect(document.activeElement).toBe(container.querySelector("canvas.screen"));
    expect(arrowMovesPlayer()).toBe(true);
  });

  it("gives the keys back to the game after a mouse click on a notice's Dismiss", async () => {
    await startGame();
    pressKey("F5");
    const saved = await waitFor("the save notice", () => [...container.querySelectorAll(".notice")].find((notice) => notice.textContent?.includes("Saved to slot 1.")));
    clickWithPointer(saved.querySelector<HTMLElement>("[aria-label=Dismiss]")!);
    expect(noticeText()).not.toContain("Saved to slot 1.");
    expect(document.activeElement).toBe(container.querySelector("canvas.screen"));
    expect(arrowMovesPlayer()).toBe(true);
  });

  it("leaves a control reached by Tab outside the game its keys", async () => {
    await startGame();
    const theme = container.querySelector<HTMLElement>("button.theme")!;
    act(() => theme.focus());
    pressKey("Tab", "Tab", theme);
    act(() => theme.focus());
    expect(arrowMovesPlayer()).toBe(false);
    expect(document.activeElement).toBe(theme);
  });

  it("F4 opens the tools panel beside the running game; its keys stay in it, and Esc closes it and gives focus back to the picture", async () => {
    await startGame();
    turnOnDeveloperTools();
    const canvas = container.querySelector<HTMLCanvasElement>("canvas.screen")!;
    pressKey("F4");
    const panel = container.querySelector<HTMLElement>(".tools-panel")!;
    expect(panel).not.toBeNull();
    expect(panel.contains(document.activeElement)).toBe(true);
    await expectRunning();
    expect(arrowMovesPlayer()).toBe(false);
    // A click inside the panel leaves focus there.
    clickWithPointer(panel.querySelector<HTMLElement>("[data-tool=filter]")!);
    expect(panel.contains(document.activeElement)).toBe(true);
    pressKey("Escape");
    expect(container.querySelector(".tools-panel")).toBeNull();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(canvas);
    expect(arrowMovesPlayer()).toBe(true);
  });

  it("opens the tools panel from the menu's Tools item, with focus in the panel, and the menu's pause ends", async () => {
    await startGame();
    turnOnDeveloperTools();
    pressKey("Escape");
    await mouseClick(container.querySelector<HTMLElement>("[data-item=tools]")!);
    expect(dialog()).toBeNull();
    expect(container.querySelector(".tools-panel")!.contains(document.activeElement)).toBe(true);
    await expectRunning();
    pressKey("F4", "F4", container.querySelector("[data-tool=close]")!);
    expect(container.querySelector(".tools-panel")).toBeNull();
  });

  it("with Developer tools off, as by default, offers no Tools item, and F4 and the backtick do nothing", async () => {
    await startGame();
    pressKey("Escape");
    expect(container.querySelector("[data-item=tools]")).toBeNull();
    act(() => container.querySelector<HTMLElement>("[data-item=display]")!.click());
    expect(container.querySelector("[data-item=developer-tools]")?.textContent).toBe("Developer tools: off");
    pressKey("Escape");
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("canvas.screen")!.focus());
    pressKey("F4");
    pressKey("Backquote", "`");
    expect(container.querySelector(".tools-panel, .console-panel")).toBeNull();
    await expectRunning();

    // Turned on, both open; turned off again, both go.
    turnOnDeveloperTools();
    pressKey("F4");
    expect(container.querySelector(".tools-panel")).not.toBeNull();
    act(() => container.querySelector<HTMLElement>("canvas.screen")!.focus());
    pressKey("Backquote", "`");
    expect(container.querySelector(".console-panel")).not.toBeNull();
    act(() => container.querySelector<HTMLElement>("canvas.screen")!.focus());
    turnOnDeveloperTools();
    expect(container.querySelector(".tools-panel, .console-panel")).toBeNull();
  });

  it("offers Tune… and F3 only for a game with tunables, opening the Tune panel with focus on its first value", async () => {
    // Without tunables: no Tune item, and F3 does nothing.
    await startGame();
    pressKey("Escape");
    expect(container.querySelector("[data-item=tune]")).toBeNull();
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("canvas.screen")!.focus());
    pressKey("F3");
    expect(container.querySelector(".tune-panel")).toBeNull();

    const rom = buildInes();
    rom[16 + 0x200] = 8;
    // Kept in the browser as the Tune panel's Load tunables… keeps one.
    localStorage.setItem(
      `retrowright.tunables.${await sha256Hex(rom)}`,
      JSON.stringify(
        parseTunables(
        {
          format: "retrowright-tunables",
          version: 1,
          romSha256: await sha256Hex(rom),
          patch: "test.bps",
          values: [{ key: "push", name: "Push", description: "Speed one tap adds.", romOffset: 16 + 0x200, cpuAddress: 0x8200, min: 0, max: 32, default: 8 }],
        },
        "test.tunables.json",
        ),
      ),
    );
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=quit]")!.click());
    await waitFor("the library", () => cards().length > 0);
    await addFiles(romFile("tunable.nes", rom));
    await waitFor("the tunable game to run", () => debug().game === "tunable.nes" && debug().framesRun > 5);

    pressKey("Escape");
    const item = container.querySelector<HTMLElement>("[data-item=tune]")!;
    expect(item.textContent).toContain("F3");
    // With the pointer, as a mouse clicks it: the item is gone once the click reaches the page, which must not take focus back to the picture.
    await mouseClick(item);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("[data-tune=push]"));
    await expectRunning();
    pressKey("Escape");
    expect(container.querySelector(".tune-panel")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("canvas.screen"));

    pressKey("F3");
    const panel = container.querySelector(".tune-panel")!;
    expect(panel.querySelector("h2")?.textContent).toBe("Tune");
    expect(panel.querySelector("[data-tool=comparison-equal], [data-tool=memory-toggle]")).toBeNull();
    expect(container.querySelector(".side-panels")?.contains(panel)).toBe(true);
    expect(container.querySelector("main")?.className).toBe("layout with-tune");
  });

  it("loads a tunables file picked in the menu for a game without one, keeps it for the game, and refuses one for another ROM", async () => {
    await startGame();
    const sha = debug().romId as string;
    const tunables = (romSha256: string) => ({
      format: "retrowright-tunables",
      version: 1,
      romSha256,
      patch: "feel.bps",
      values: [{ key: "grip", name: "Grip", description: "How the tyres hold.", romOffset: 16 + 0x200, cpuAddress: 0x8200, min: 0, max: 255, default: 0 }],
    });
    const pick = async (text: string) => {
      pressKey("Escape");
      const input = container.querySelector<HTMLInputElement>("#game-file-input")!;
      const file = new File([text], "feel.tunables.json");
      // jsdom's File has no text().
      Object.defineProperty(file, "text", { value: async () => text });
      Object.defineProperty(input, "files", { configurable: true, value: [file] });
      await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
    };
    await pick(JSON.stringify(tunables("f".repeat(64))));
    await waitFor("the refusal", () => noticeText().includes("feel.tunables.json is for another ROM"));
    expect(container.querySelector(".tune-panel")).toBeNull();
    await pick(JSON.stringify(tunables(sha)));
    await waitFor("the Tune panel", () => container.querySelector(".tune-panel"));
    expect(JSON.parse(localStorage.getItem(`retrowright.tunables.${sha}`)!).values[0].key).toBe("grip");
    expect(container.querySelector("[data-tune=grip]")).not.toBeNull();
  });

  it("Quit to library closes the game and shows the library with focus on Continue", async () => {
    await startGame();
    pressKey("Escape");
    await act(async () => container.querySelector<HTMLElement>("[data-item=quit]")!.click());
    await waitFor("the library", () => container.querySelector(".continue-button"));
    expect(dialog()).toBeNull();
    expect(debug().game).toBeNull();
    expect(container.querySelector(".menu-corner")).toBeNull();
    expect(container.querySelector<HTMLElement>(".stage")!.hidden).toBe(true);
    await waitFor("focus on Continue", () => document.activeElement?.textContent === "Continue");
  });

  it("a recording started, marked and stopped in the paused menu downloads nothing and says why", async () => {
    await startGame();
    const downloads: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    try {
      pressKey("F8");
      expect(noticeText()).toContain("Marks are added while recording; nothing was marked.");
      pressKey("Escape");
      act(() => container.querySelector<HTMLElement>("[data-item=movie]")!.click());
      act(() => container.querySelector<HTMLElement>("button.record")!.click());
      expect(debug().movieStatus().mode).toBe("recording");
      for (let mark = 0; mark < 3; mark++) act(() => container.querySelector<HTMLElement>("button.mark")!.click());
      act(() => container.querySelector<HTMLElement>("button.record")!.click());
      expect(noticeText()).toContain("Nothing was recorded: no frame ran while recording");
      expect(downloads).toEqual([]);
      expect(debug().movieStatus().mode).toBe("idle");
      expect(container.querySelector("button.record")!.textContent).toBe("Record");
      expect(debug().lastRecording()).toBeNull();
    } finally {
      click.mockRestore();
    }
  });

  it("R and the menu's Save the last minute download the instant replay; turned off, it is kept off", async () => {
    await startGame();
    const blobs = catchDownloads();
    const downloads: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    try {
      pressKey("KeyR", "r");
      expect(noticeText()).toMatch(/Saved the last \d+ seconds \(\d+ frames\) as a movie/);
      expect(downloads).toEqual([expect.stringMatching(/^synthetic-replay-.+\.rwmovie\.json$/)]);
      const movie = parseMovie(JSON.parse(await blobText(blobs[0])));
      expect(movie.start.kind).toBe("save-state");
      expect(movie.checkpoints.map((checkpoint) => checkpoint.name)).toEqual(["end"]);
      pressKey("Escape");
      act(() => container.querySelector<HTMLElement>("[data-item=save-replay]")!.click());
      expect(downloads).toHaveLength(2);
      act(() => container.querySelector<HTMLElement>("[data-item=movie]")!.click());
      const length = container.querySelector<HTMLSelectElement>("[data-item=replay-seconds]")!;
      act(() => {
        length.value = "0";
        length.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(localStorage.getItem("retrowright.replay")).toBe('{"seconds":0}');
      pressKey("Escape");
      pressKey("Escape");
      pressKey("KeyR", "r");
      expect(noticeText()).toContain("The instant replay is off");
      expect(downloads).toHaveLength(2);
    } finally {
      click.mockRestore();
    }
  });

  it("Quit to library forgets the closed game's current slot and record choice", async () => {
    await startGame();
    pressKey("Digit2", "2");
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=movie]")!.click());
    const select = container.querySelector<HTMLSelectElement>(".record-from select")!;
    act(() => {
      select.value = "current-state";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector<HTMLSelectElement>(".record-from select")!.value).toBe("current-state");
    pressKey("Escape");
    await act(async () => container.querySelector<HTMLElement>("[data-item=quit]")!.click());

    const card = await waitFor("the game's card", () => cards()[0]);
    act(() => card.click());
    await waitFor("the open dialog", () => container.querySelector("[data-item=power-on]"));
    await act(async () => container.querySelector<HTMLElement>("[data-item=power-on]")!.click());
    await waitFor("the game to run", () => debug().game && debug().framesRun > 5);
    pressKey("F5");
    await waitFor("the save notice", () => container.querySelector(".notices")?.textContent?.includes("Saved to slot 1."));
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=movie]")!.click());
    expect(container.querySelector<HTMLSelectElement>(".record-from select")!.value).toBe("power-on-keep");
  });
});

describe("App and Continue", () => {
  async function leaveOnAFrame() {
    await startGame();
    // The open menu pauses the game, so the picture stays on the frame being left.
    pressKey("Escape");
    await expectPaused();
    return debug().screenHash();
  }

  async function continueFromLibrary() {
    const button = await waitFor("the Continue button", () => container.querySelector<HTMLElement>(".continue-button"));
    expect(button.textContent).toBe("Continue");
    await act(async () => button.click());
    await waitFor("the game to run", () => debug().game && debug().framesRun > 2);
  }

  it("a hidden tab saves the resume state; after the page closes, Continue opens the game on that frame", async () => {
    const left = await leaveOnAFrame();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    await reopenPage();
    expect(container.querySelector(".continue-card img")?.getAttribute("src")).toBe(THUMBNAIL);
    await continueFromLibrary();
    expect(left).toMatch(/^fnv1a32:/);
    expect(debug().continuedScreenHash).toBe(left);
  });

  it("pagehide saves the resume state too", async () => {
    const left = await leaveOnAFrame();
    act(() => window.dispatchEvent(new Event("pagehide")));
    await reopenPage();
    await continueFromLibrary();
    expect(debug().continuedScreenHash).toBe(left);
  });

  it("a page closed without hiding has no resume state, and the card starts the game from power-on", async () => {
    await startGame();
    await reopenPage();
    const button = await waitFor("the Continue card", () => container.querySelector<HTMLElement>(".continue-button"));
    expect(button.textContent).toBe("Play");
    await act(async () => cards()[0].click());
    await waitFor("the game to run", () => debug().game && debug().framesRun > 2);
    expect(debug().continuedScreenHash).toBeNull();
  });

  /** Saves the paused frame to slot 1 from the menu; returns that frame's hash. */
  async function saveSlot1FromMenu() {
    pressKey("Escape");
    await expectPaused();
    const hash = debug().screenHash();
    act(() => container.querySelector<HTMLElement>("[data-item=save]")!.click());
    await act(async () => container.querySelector<HTMLElement>("[data-slot='1']")!.click());
    await waitFor("the save notice", () => noticeText().includes("Saved to slot 1."));
    return hash;
  }

  it("a game with only a slot loads that slot from its card, as the card's picture shows", async () => {
    await startGame();
    const saved = await saveSlot1FromMenu();
    await reopenPage(); // closed without hiding: no resume state
    const continueButton = await waitFor("the Continue button to name the slot", () => container.querySelector<HTMLElement>(".continue-button")?.textContent === "Load slot 1" && container.querySelector<HTMLElement>(".continue-button"));
    expect(continueButton).not.toBeNull();
    await act(async () => cards()[0].click());
    const first = await waitFor("the open choice", () => container.querySelector<HTMLElement>("[role=dialog] [data-item=load-slot]"));
    expect(document.activeElement).toBe(first);
    await act(async () => first.click());
    await waitFor("the game to run", () => debug().game && debug().framesRun > 2);
    expect(saved).toMatch(/^fnv1a32:/);
    expect(debug().continuedScreenHash).toBe(saved);
  });

  it("a game whose newest save is the resume state continues it from its card", async () => {
    await startGame();
    await saveSlot1FromMenu();
    await act(async () => container.querySelector<HTMLElement>(".play-bar .menu-open")!.click());
    const left = debug().screenHash();
    act(() => window.dispatchEvent(new Event("pagehide"))); // the resume state, newer than slot 1
    await reopenPage();
    await act(async () => cards()[0].click());
    const first = await waitFor("the open choice", () => container.querySelector<HTMLElement>("[role=dialog] [data-item=continue]"));
    expect(document.activeElement).toBe(first);
    await act(async () => first.click());
    await waitFor("the game to run", () => debug().game && debug().framesRun > 2);
    expect(debug().continuedScreenHash).toBe(left);
  });
});

describe("App and the touch controls", () => {
  /** A pointer event as a finger makes it; jsdom lays nothing out, so client coordinates are the layer's own. */
  function finger(type: string, target: EventTarget, pointerId: number, x = 0, y = 0) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperties(event, { pointerType: { value: "touch" }, pointerId: { value: pointerId } });
    act(() => target.dispatchEvent(event));
  }

  const layer = () => container.querySelector<HTMLElement>(".touch-layer");
  const centreOf = (id: string) => {
    const placed = placeLayout(PHONE_LAYOUT, PAGE.width, PAGE.height).controls.find((control) => control.control.id === id)!;
    return { x: placed.frame.x + placed.frame.width / 2, y: placed.frame.y + placed.frame.height / 2 };
  };

  afterEach(() => document.documentElement.classList.remove("touch-play"));

  it("show on the first touch, move the picture into the layout's screen rectangle, and press A while the D-pad holds Left", async () => {
    await startGame();
    expect(layer()).toBeNull();
    finger("pointerdown", document.body, 1);
    finger("pointerup", document.body, 1);
    expect(layer()).not.toBeNull();
    expect(document.documentElement.classList.contains("touch-play")).toBe(true);
    expect(container.querySelector(".play-bar")?.hasAttribute("hidden")).toBe(true);
    expect(container.querySelector(".menu-corner")).toBeNull();
    const canvas = container.querySelector<HTMLCanvasElement>("canvas.screen")!;
    // With no scaling chosen, the 8:7 picture fills the layout's screen rectangle as far as its shape allows.
    const screen = placeLayout(PHONE_LAYOUT, PAGE.width, PAGE.height).screen;
    const scale = Math.min(screen.width / ((256 * 8) / 7), screen.height / 240);
    expect(scale).toBeGreaterThan(1);
    expect(Number.isInteger(scale)).toBe(false);
    expect(canvas.dataset.scaling).toBe("fill");
    expect(Number(canvas.dataset.scale)).toBeCloseTo(scale, 3);
    expect(parseFloat(canvas.style.width)).toBeCloseTo(((256 * 8) / 7) * scale, 6);

    const dpad = centreOf("dpad");
    const a = centreOf("a");
    finger("pointerdown", layer()!, 2, dpad.x - 50, dpad.y);
    finger("pointerdown", layer()!, 3, a.x, a.y);
    expect(debug().heldButtons()).toEqual(["1:A", "1:Left"]);
    expect(container.querySelector("[data-control=a]")?.getAttribute("data-pressed")).toBe("true");
    expect(container.querySelector("[data-control=dpad]")?.getAttribute("data-held")).toBe("Left");
    finger("pointermove", layer()!, 2, dpad.x - 40, dpad.y - 40); // slides into the up-left diagonal
    expect(debug().heldButtons()).toEqual(["1:A", "1:Left", "1:Up"]);
    finger("pointerup", layer()!, 3, a.x, a.y);
    finger("pointerup", layer()!, 2, dpad.x, dpad.y);
    expect(debug().heldButtons()).toEqual([]);
  });

  it("open the menu from their menu button, which lets go of every touch", async () => {
    await startGame();
    finger("pointerdown", document.body, 1);
    const a = centreOf("a");
    finger("pointerdown", layer()!, 2, a.x, a.y);
    const menu = centreOf("menu");
    finger("pointerdown", layer()!, 3, menu.x, menu.y);
    finger("pointerup", layer()!, 3, menu.x, menu.y);
    expect(dialog()).not.toBeNull();
    await expectPaused();
    expect(debug().heldButtons()).toEqual([]);
  });

  it("hide when a key or a gamepad button is pressed, and come back on the next touch", async () => {
    await startGame();
    finger("pointerdown", document.body, 1);
    expect(layer()).not.toBeNull();
    // An on-screen keyboard's keys, into a text field or as "Unidentified", are touch play still.
    const field = document.createElement("input");
    document.body.append(field);
    pressKey("KeyA", "a", field);
    field.remove();
    pressKey("", "Unidentified");
    expect(layer()).not.toBeNull();
    pressKey("KeyX", "x");
    expect(layer()).toBeNull();
    expect(document.documentElement.classList.contains("touch-play")).toBe(false);
    // Off the touch layout the default is integer scaling again.
    expect(container.querySelector<HTMLCanvasElement>("canvas.screen")!.dataset.scaling).toBe("integer");
    expect(container.querySelector<HTMLCanvasElement>("canvas.screen")!.dataset.scale).toBe("1");
    finger("pointerdown", document.body, 2);
    expect(layer()).not.toBeNull();
    const pad = gamepads.connect(0);
    pad.buttons[0].pressed = true;
    await waitFor("the controls to hide", () => layer() === null);
    pad.buttons[0].pressed = false;
    finger("pointerdown", document.body, 3);
    expect(layer()).not.toBeNull();
  });

  it("keep integer scaling in the layout's rectangle once the player chooses it in the menu", async () => {
    await startGame();
    finger("pointerdown", document.body, 1);
    const menu = centreOf("menu");
    finger("pointerdown", layer()!, 2, menu.x, menu.y);
    finger("pointerup", layer()!, 2, menu.x, menu.y);
    act(() => container.querySelector<HTMLElement>("[data-item=display]")!.click());
    const scaling = container.querySelector<HTMLElement>("[data-item=scaling]")!;
    expect(scaling.textContent).toBe("Integer scaling: off (fill)");
    act(() => scaling.click());
    expect(container.querySelector("[data-item=scaling]")!.textContent).toBe("Integer scaling: on");
    pressKey("Escape");
    pressKey("Escape");
    // Esc is a key press: it hid the controls; a touch brings them back.
    finger("pointerdown", document.body, 3);
    expect(layer()).not.toBeNull();
    const canvas = container.querySelector<HTMLCanvasElement>("canvas.screen")!;
    expect(canvas.dataset.scaling).toBe("integer");
    expect(Number.isInteger(Number(canvas.dataset.scale))).toBe(true);
  });

  it("stay off after the menu turns them off, until it turns them on again", async () => {
    await startGame();
    finger("pointerdown", document.body, 1);
    const menu = centreOf("menu");
    finger("pointerdown", layer()!, 2, menu.x, menu.y);
    finger("pointerup", layer()!, 2, menu.x, menu.y);
    act(() => container.querySelector<HTMLElement>("[data-item=touch]")!.click());
    expect(container.querySelector("[data-item=touch-shown]")?.textContent).toBe("Touch controls: on");
    act(() => container.querySelector<HTMLElement>("[data-item=touch-shown]")!.click());
    act(() => container.querySelector<HTMLElement>("[data-item=back]")!.click());
    act(() => container.querySelector<HTMLElement>("[data-item=resume]")!.click());
    finger("pointerdown", document.body, 3);
    expect(layer()).toBeNull();
    act(() => container.querySelector<HTMLElement>(".menu-corner")!.click());
    act(() => container.querySelector<HTMLElement>("[data-item=touch]")!.click());
    act(() => container.querySelector<HTMLElement>("[data-item=touch-shown]")!.click());
    expect(container.querySelector("[data-item=touch-shown]")?.textContent).toBe("Touch controls: on");
    expect(layer()).not.toBeNull();
  });
});

describe("App and the library", () => {
  it("adds several files at once and recognises a duplicate by its SHA-256", async () => {
    await showLibrary();
    await addFiles(romFile("one (USA).nes", buildInes()), romFile("one again.nes", buildInes()), romFile("two.nes", buildInes({ battery: true })));
    await waitFor("two cards", () => cards().length === 2);
    const notices = container.querySelector(".notices")!.textContent;
    expect(notices).toContain("one again.nes is already in the library as “one”.");
    expect(notices).toContain("Added 2 games.");
    expect(container.querySelector(".card-tags")?.textContent).toBe("USA");
    expect(debug().game).toBeNull();
  });

  it("starts a single added game at once, and only names a single file already there", async () => {
    await showLibrary();
    await addFiles(romFile("one.nes", buildInes()));
    await waitFor("the game to run", () => debug().game === "one.nes" && debug().framesRun > 2);
    pressKey("Escape");
    await act(async () => container.querySelector<HTMLElement>("[data-item=quit]")!.click());
    await waitFor("the library", () => cards().length === 1);
    await addFiles(romFile("one copy.nes", buildInes()));
    await waitFor("the duplicate notice", () => noticeText().includes("one copy.nes is already in the library"));
    expect(debug().game).toBeNull();
  });

  it("refuses a file that is not an NES ROM, naming it", async () => {
    await showLibrary();
    await addFiles(romFile("notes.txt", new Uint8Array([1, 2, 3])));
    await waitFor("the refusal", () => container.querySelector(".notices")?.textContent?.includes("notes.txt:"));
    expect(cards()).toHaveLength(0);
  });

  it("says when another tab blocks the store with an older version, and adds a game chosen meanwhile once that tab closes it", async () => {
    const oldTab = await openVersion1(window.indexedDB);
    act(() => root.render(<App />));
    await waitFor("the blocked notice", () => noticeText().includes("open in another tab with an older version"));
    await addFiles(romFile("one.nes", buildInes()));
    await waitFor("the opening notice", () => noticeText().includes("The library is still opening…"));
    expect(cards()).toHaveLength(0);
    oldTab.close();
    await waitFor("the game to start", () => window.__retrowright?.game === "one.nes");
    expect(noticeText()).toContain("Added 1 game.");
    expect(noticeText()).not.toContain("open in another tab with an older version");
  });

  it("closes its connection and says to reload when another tab opens a newer version", async () => {
    await showLibrary();
    const newer = await act(() => openNewerVersion(window.indexedDB, 3));
    await waitFor("the reload notice", () => noticeText().includes("A newer version of retrowright was opened in another tab. Reload this page."));
    await addFiles(romFile("one.nes", buildInes()));
    await waitFor("the refusal", () => noticeText().includes("one.nes could not be added: A newer version"));
    newer.close();
  });

  it("a gamepad moves through the library and starts a game", async () => {
    await showLibrary();
    await addFiles(romFile("one.nes", buildInes()), romFile("two.nes", buildInes({ battery: true })));
    await waitFor("two cards", () => cards().length === 2);
    const pad = gamepads.connect(0);
    const tapButton = async (index: number) => {
      pad.buttons[index].pressed = true;
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      pad.buttons[index].pressed = false;
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    };
    await tapButton(1); // A with nothing focused: focus goes to the first card
    expect(document.activeElement).toBe(cards()[0]);
    await tapButton(15); // right: the first card's star
    await tapButton(15); // its menu button
    await tapButton(15); // the second card
    expect(document.activeElement).toBe(cards()[1]);
    const second = cards()[1].querySelector(".card-title")!.textContent;
    await tapButton(1);
    await waitFor("the game to run", () => debug().game && debug().framesRun > 2);
    expect(debug().game).toBe(`${second}.nes`);
  });
});

/** A Storage API whose persist() gives `answer`, counting the calls. */
function stubStorageApi(answer: boolean) {
  const api = { persisted: async () => false, persist: vi.fn(async () => answer), estimate: async () => ({ usage: 1_500_000, quota: 3_000_000_000 }) };
  Object.defineProperty(navigator, "storage", { configurable: true, value: api });
  return api;
}

function textFile(name: string, text: string): File {
  const file = new File([text], name);
  // jsdom's File has no text().
  Object.defineProperty(file, "text", { value: async () => text });
  return file;
}

/** Catches the files the page downloads. */
function catchDownloads(): Blob[] {
  const blobs: Blob[] = [];
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => (blobs.push(blob), "blob:test") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return blobs;
}

const blobText = (blob: Blob) => new Promise<string>((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.readAsText(blob);
});

describe("App and saves kept safe", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "storage");
    vi.restoreAllMocks();
  });

  it("asks the browser to keep the saves after the first save, and says it agreed", async () => {
    const api = stubStorageApi(true);
    await startGame();
    expect(api.persist).not.toHaveBeenCalled();
    pressKey("F5");
    await waitFor("the answer", () => noticeText().includes("This browser has agreed to keep your saves."));
    pressKey("F5");
    await waitFor("the second save", () => api.persist.mock.calls.length === 1 && noticeText().includes("Saved to slot 1."));
    expect(api.persist).toHaveBeenCalledOnce();
  });

  it("warns, in a notice and in the library, when the browser does not agree, and shows the storage meter", async () => {
    stubStorageApi(false);
    await startGame();
    pressKey("F5");
    await waitFor("the warning", () => container.querySelector(".notice.warning")?.textContent?.includes("has not agreed to keep your saves"));
    pressKey("Escape");
    await act(async () => container.querySelector<HTMLElement>("[data-item=quit]")!.click());
    await waitFor("the library's warning", () => container.querySelector(".storage-warning"));
    await act(async () => container.querySelector<HTMLElement>(".open-saves")!.click());
    await waitFor("the meter", () => container.querySelector(".storage-meter")?.textContent === "1.5 MB used of about 3.0 GB this browser allows the page");
  });

  it("exports the saves, and a fresh browser imports them: they wait for the ROM and come with it", async () => {
    stubStorageApi(true);
    const downloads = catchDownloads();
    await startGame();
    pressKey("F5");
    await waitFor("the save", () => noticeText().includes("Saved to slot 1."));
    pressKey("Escape");
    await act(async () => container.querySelector<HTMLElement>("[data-item=quit]")!.click());
    await waitFor("the library", () => container.querySelector(".open-saves"));
    act(() => container.querySelector<HTMLElement>(".open-saves")!.click());
    await act(async () => container.querySelector<HTMLElement>("[data-item=export]")!.click());
    await waitFor("the download", () => downloads.length === 1);
    const exported = await blobText(downloads[0]);

    // Another browser: a new store, nothing in it.
    await act(async () => root.unmount());
    Object.defineProperty(window, "indexedDB", { configurable: true, value: new IDBFactory() });
    root = createRoot(container);
    await showLibrary();
    expect(container.querySelector(".empty-lead")).not.toBeNull();
    act(() => container.querySelector<HTMLElement>(".open-saves")!.click());
    const input = container.querySelector<HTMLInputElement>("#backup-input")!;
    Object.defineProperty(input, "files", { configurable: true, value: [textFile("saves.rwbackup.json", exported)] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await waitFor("the import summary", () => noticeText().includes("wait until you add its ROM"));
    // Several sentences long, the summary outlasts the few seconds other info notices get.
    await act(() => new Promise((done) => setTimeout(done, 3300)));
    expect(noticeText()).toContain("wait until you add its ROM");
    await addFiles(romFile("synthetic.nes", buildInes({ battery: true })));
    await waitFor("the game to start", () => debug().game);
    pressKey("Escape");
    // The menu opens on a later render; on a busy machine it is not there yet when Escape returns.
    const load = await waitFor("the menu's Load item", () => container.querySelector<HTMLElement>("[data-item=load]"));
    act(() => load.click());
    const card = await waitFor("slot 1's card", () => container.querySelector<HTMLElement>("[data-slot='1']:not([aria-disabled=true])"));
    expect(card.querySelector("img")?.getAttribute("src")).toBe(THUMBNAIL);
  });

  it("says so when an imported backup brings display settings that cannot be read, and keeps the defaults", async () => {
    await showLibrary();
    act(() => container.querySelector<HTMLElement>(".open-saves")!.click());
    const input = container.querySelector<HTMLInputElement>("#backup-input")!;
    const unreadable = JSON.stringify({ format: "retrowright-backup", version: 1, exportedAt: 1, games: [], saves: [], settings: { "retrowright.display": "{" } });
    Object.defineProperty(input, "files", { configurable: true, value: [textFile("odd.rwbackup.json", unreadable)] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await waitFor("the settings notice", () => container.querySelector(".notice.error")?.textContent?.includes("Saved display settings could not be read, so the defaults are in use."));
    // The defaults are written back over the unreadable value.
    await waitFor("the defaults stored", () => JSON.parse(localStorage.getItem("retrowright.display") ?? "{}").scaling === "auto");
  });

  it("refuses a backup of a newer format with a message", async () => {
    await showLibrary();
    act(() => container.querySelector<HTMLElement>(".open-saves")!.click());
    const input = container.querySelector<HTMLInputElement>("#backup-input")!;
    const newer = JSON.stringify({ format: "retrowright-backup", version: 99, exportedAt: 1, games: [], saves: [], settings: null });
    Object.defineProperty(input, "files", { configurable: true, value: [textFile("future.rwbackup.json", newer)] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await waitFor("the refusal", () => noticeText().includes("future.rwbackup.json could not be imported: This backup was made by a newer version of retrowright"));
  });
});

/** Dispatches a mouse event with `button` on `target` and returns it, to read whether the page prevented its default. */
function mouse(type: "mousedown" | "mouseup" | "click" | "contextmenu", target: Element, button: number): MouseEvent {
  const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
  act(() => void target.dispatchEvent(event));
  return event;
}

/** A mouse button going down as a browser sends it: pointerdown, then mousedown. */
function mouseDown(target: Element, button: number): MouseEvent {
  act(() => void target.dispatchEvent(new MouseEvent("pointerdown", { button, bubbles: true })));
  return mouse("mousedown", target, button);
}

describe("the second control set: WASD and the mouse", () => {
  const canvas = () => container.querySelector<HTMLCanvasElement>("canvas.screen")!;

  it("moves with W, A, S and D as with the arrows", async () => {
    await startGame();
    for (const [code, button] of [
      ["KeyW", "Up"],
      ["KeyA", "Left"],
      ["KeyS", "Down"],
      ["KeyD", "Right"],
    ]) {
      act(() => void canvas().dispatchEvent(new KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true })));
      expect(debug().heldButtons(), code).toEqual([`1:${button}`]);
      act(() => void canvas().dispatchEvent(new KeyboardEvent("keyup", { code, key: code, bubbles: true, cancelable: true })));
      expect(debug().heldButtons()).toEqual([]);
    }
  });

  it("holds A for a held left click on the picture and B for a held right click, without the context menu, until the button is let go anywhere", async () => {
    await startGame();
    expect(document.activeElement).toBe(canvas());
    expect(mouseDown(canvas(), 0).defaultPrevented).toBe(true);
    expect(debug().heldButtons()).toEqual(["1:A"]);
    await expectRunning();
    expect(debug().heldButtons()).toEqual(["1:A"]);
    mouseDown(canvas(), 2);
    expect(debug().heldButtons().sort()).toEqual(["1:A", "1:B"]);
    expect(mouse("contextmenu", canvas(), 2).defaultPrevented).toBe(true);
    // Let go outside the picture: the game lets go too.
    mouse("mouseup", document.body, 0);
    expect(debug().heldButtons()).toEqual(["1:B"]);
    mouse("mouseup", container.querySelector("button.theme")!, 2);
    expect(debug().heldButtons()).toEqual([]);
    // The context menu stays everywhere but the picture.
    expect(mouse("contextmenu", container.querySelector("button.theme")!, 2).defaultPrevented).toBe(false);
  });

  it("lets go of A and B when the window loses focus or the menu opens", async () => {
    await startGame();
    mouseDown(canvas(), 0);
    mouseDown(canvas(), 2);
    act(() => window.dispatchEvent(new Event("blur")));
    expect(debug().heldButtons()).toEqual([]);
    // The click that resumes the game gives it back and presses nothing.
    mouseDown(canvas(), 0);
    expect(container.querySelector(".focus-paused")).toBeNull();
    expect(debug().heldButtons()).toEqual([]);
    mouse("mouseup", canvas(), 0);
    mouseDown(canvas(), 2);
    expect(debug().heldButtons()).toEqual(["1:B"]);
    pressKey("Escape");
    expect(dialog()).not.toBeNull();
    expect(debug().heldButtons()).toEqual([]);
  });

  it("presses nothing for a click outside the picture, or for the click that gives focus back to it", async () => {
    await startGame();
    const theme = container.querySelector<HTMLElement>("button.theme")!;
    expect(mouseDown(theme, 0).defaultPrevented).toBe(false);
    expect(debug().heldButtons()).toEqual([]);
    mouse("mouseup", theme, 0);
    mouseDown(container.querySelector(".play-bar")!, 2);
    expect(debug().heldButtons()).toEqual([]);
    mouse("mouseup", document.body, 2);

    // Focus on Mute: the next click on the picture only takes focus back (the browser's default, not prevented).
    const mute = container.querySelector<HTMLElement>(".play-bar .mute")!;
    act(() => mute.focus());
    expect(mouseDown(canvas(), 0).defaultPrevented).toBe(false);
    expect(debug().heldButtons()).toEqual([]);
    mouse("mouseup", canvas(), 0);
    act(() => canvas().focus());
    mouseDown(canvas(), 0);
    expect(debug().heldButtons()).toEqual(["1:A"]);
    mouse("mouseup", canvas(), 0);
  });

  it("rebinds a secondary binding in Controls…, to a key or a mouse button, and restores both sets", async () => {
    await startGame();
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=controls]")!.click());
    const binding = (action: string, slot: number) => container.querySelector<HTMLElement>(`[data-action=${action}][data-slot="${slot}"]`)!;

    act(() => binding("Up", 1).click());
    pressKey("KeyI", "i");
    expect(binding("Up", 0).textContent).toBe("↑");
    expect(binding("Up", 1).textContent).toBe("I");

    // A middle click while Start's secondary waits binds the middle button; its click presses nothing in the menu.
    act(() => binding("Start", 1).click());
    expect(binding("Start", 1).textContent).toBe("Press a key…");
    const down = mouse("mousedown", binding("Start", 1), 1);
    expect(down.defaultPrevented).toBe(true);
    expect(binding("Start", 1).textContent).toBe("Middle click");
    expect(binding("Start", 0).textContent).toBe("Enter");

    // A left click binds the left button, and the click that follows does not start a new rebinding.
    act(() => binding("Select", 1).click());
    mouse("mousedown", binding("Select", 1), 0);
    mouse("mouseup", binding("Select", 1), 0);
    act(() => binding("Select", 1).click());
    expect(binding("Select", 1).textContent).toBe("Left click");
    expect(binding("A", 1).textContent).toBe("none");
    expect(dialog()?.querySelector(".key.waiting")).toBeNull();

    // A right click binds the right button without opening the context menu.
    act(() => binding("Down", 1).click());
    mouse("mousedown", binding("Down", 1), 2);
    expect(mouse("contextmenu", binding("Down", 1), 2).defaultPrevented).toBe(true);
    expect(binding("Down", 1).textContent).toBe("Right click");
    expect(binding("B", 1).textContent).toBe("none");

    const stored = JSON.parse(localStorage.getItem("retrowright.keyBindings.v1")!);
    expect(stored.Start).toEqual(["Enter", "Mouse1"]);
    expect(stored.Up).toEqual(["ArrowUp", "KeyI"]);

    // In the game, the middle button on the picture is Start.
    pressKey("Escape");
    pressKey("Escape");
    expect(dialog()).toBeNull();
    act(() => canvas().focus());
    mouseDown(canvas(), 1);
    expect(debug().heldButtons()).toEqual(["1:Start"]);
    mouse("mouseup", canvas(), 1);

    // With a combo and a player 2 key bound, and the controls panel showing their tables.
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=display]")!.click());
    act(() => container.querySelector<HTMLElement>("[data-item=show-controls]")!.click());
    act(() => container.querySelector<HTMLElement>("[data-item=back]")!.click());
    act(() => container.querySelector<HTMLElement>("[data-item=controls]")!.click());
    act(() => container.querySelector<HTMLElement>("[data-add-combo='Down+B']")!.click());
    pressKey("KeyC", "c");
    act(() => binding("P2A", 0).click());
    pressKey("KeyM", "m");
    expect(sideTable("Combo")).toHaveLength(1);
    expect(sideTable("Player 2")).toHaveLength(1);

    act(() => [...dialog()!.querySelectorAll<HTMLElement>("button")].find((button) => button.textContent === "Restore default keys")!.click());
    expect(dialog()?.querySelector(".combos")).toBeNull();
    expect(binding("P2A", 0).textContent).toBe("unbound");
    expect(sideTable("Combo")).toBeUndefined();
    expect(sideTable("Player 2")).toBeUndefined();
    const restored = JSON.parse(localStorage.getItem("retrowright.keyBindings.v1")!);
    expect(restored.combos).toEqual([]);
    expect(restored.P2A).toEqual([]);
    expect(binding("Up", 1).textContent).toBe("W");
    expect(binding("Start", 1).textContent).toBe("Numpad Enter");
    expect(binding("A", 1).textContent).toBe("Left click");
    expect(binding("B", 1).textContent).toBe("Right click");
    expect(binding("Down", 1).textContent).toBe("S");
  });
});

describe("combo keys and player 2's keys", () => {
  const canvas = () => container.querySelector<HTMLCanvasElement>("canvas.screen")!;
  const keyDown = (code: string) => act(() => void canvas().dispatchEvent(new KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true })));
  const keyUp = (code: string) => act(() => void canvas().dispatchEvent(new KeyboardEvent("keyup", { code, key: code, bubbles: true, cancelable: true })));
  const held = () => debug().heldButtons().sort();
  const openControls = () => {
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=controls]")!.click());
  };
  const backToGame = () => {
    pressKey("Escape");
    pressKey("Escape");
    expect(dialog()).toBeNull();
    act(() => canvas().focus());
  };
  const click = (selector: string) => act(() => container.querySelector<HTMLElement>(selector)!.click());
  const stored = () => JSON.parse(localStorage.getItem("retrowright.keyBindings.v1")!);

  it("adds Down+B on C with one click; C holds and lets go of both, and Down held by its own key stays held", async () => {
    await startGame();
    openControls();
    expect(dialog()?.querySelector(".combos")).toBeNull();
    click("[data-add-combo='Down+B']");
    expect(container.querySelector("[data-add-combo='Down+B']")?.textContent).toBe("Press a key for Down+B…");
    pressKey("KeyC", "c");
    expect(container.querySelector("[data-combo='0']")?.textContent).toBe("C");
    expect(container.querySelector("[data-add-combo='Down+B']")).toBeNull();
    expect(container.querySelector("[data-add-combo='Down+A']")?.textContent).toBe("Add Down+A");
    expect(stored().combos).toEqual([{ code: "KeyC", buttons: ["Down", "B"] }]);
    backToGame();

    keyDown("KeyC");
    expect(held()).toEqual(["1:B", "1:Down"]);
    keyUp("KeyC");
    expect(held()).toEqual([]);

    keyDown("KeyS");
    keyDown("KeyC");
    expect(held()).toEqual(["1:B", "1:Down"]);
    keyUp("KeyC");
    expect(held()).toEqual(["1:Down"]);
    keyUp("KeyS");
    expect(held()).toEqual([]);

    // The other way round: B's own key outlasts the combo too.
    keyDown("KeyC");
    keyDown("KeyZ");
    keyUp("KeyC");
    expect(held()).toEqual(["1:B"]);
    keyUp("KeyZ");
    expect(held()).toEqual([]);

    // A combo key held when the menu opens is let go.
    keyDown("KeyC");
    pressKey("Escape");
    expect(held()).toEqual([]);
  });

  it("changes a combo's key and buttons and removes it in Controls…", async () => {
    await startGame();
    openControls();
    click("[data-add-combo='Down+A']");
    pressKey("KeyV", "v");
    click("[data-combo='0']");
    expect(container.querySelector("[data-combo='0']")?.textContent).toBe("Press a key…");
    pressKey("KeyB", "b");
    expect(container.querySelector("[data-combo='0']")?.textContent).toBe("B");
    click("[data-combo-button=A]");
    click("[data-combo-button=Up]");
    expect(container.querySelector("[data-combo-button=Up]")?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[data-combo-button=A]")?.getAttribute("aria-pressed")).toBe("false");
    expect(stored().combos).toEqual([{ code: "KeyB", buttons: ["Up", "Down"] }]);
    backToGame();
    keyDown("KeyB");
    expect(held()).toEqual(["1:Down", "1:Up"]);
    keyUp("KeyB");

    openControls();
    click("[data-remove-combo='0']");
    expect(dialog()?.querySelector(".combos")).toBeNull();
    expect(stored().combos).toEqual([]);
    backToGame();
    keyDown("KeyB");
    expect(held()).toEqual([]);
    keyUp("KeyB");
  });

  it("binds player 2's buttons to keys, which reach pad 2, and the controls panel lists them and the combos", async () => {
    await startGame();
    pressKey("Escape");
    click("[data-item=display]");
    click("[data-item=show-controls]");
    expect(sideTable("Player 2")).toBeUndefined();
    expect(sideTable("Combo")).toBeUndefined();
    click("[data-item=back]");
    click("[data-item=controls]");
    expect(container.querySelector("[data-action=P2A][data-slot='0']")?.textContent).toBe("unbound");
    click("[data-action=P2A][data-slot='0']");
    expect(container.querySelector(".pad-diagram")?.getAttribute("aria-label")).toBe("Player 2's NES pad, A highlighted");
    pressKey("KeyM", "m");
    click("[data-action=P2Down][data-slot='0']");
    pressKey("KeyJ", "j");
    click("[data-add-combo='Down+B']");
    pressKey("KeyC", "c");
    expect(stored().P2A).toEqual(["KeyM"]);

    const player2 = [...sideTable("Player 2")!].map((row) => [row.querySelector("th")?.textContent, row.querySelector(".side-keys")?.textContent]);
    // Only the bound buttons, in the pad's order.
    expect(player2).toEqual([
      ["Down", "J"],
      ["A", "M"],
    ]);
    expect([...sideTable("Combo")!].map((row) => row.textContent)).toEqual(["Down+BC"]);
    backToGame();

    keyDown("KeyM");
    keyDown("KeyJ");
    keyDown("KeyX");
    expect(held()).toEqual(["1:A", "2:A", "2:Down"]);
    keyUp("KeyM");
    expect(held()).toEqual(["1:A", "2:Down"]);
    keyUp("KeyJ");
    keyUp("KeyX");
    expect(held()).toEqual([]);
  });

  it("unbinds one key of player 1, player 2 or a combo, leaving the others, in the side panel and after a reload", async () => {
    await startGame();
    pressKey("Escape");
    click("[data-item=display]");
    click("[data-item=show-controls]");
    click("[data-item=back]");
    click("[data-item=controls]");
    click("[data-action=P2A][data-slot='0']");
    pressKey("KeyM", "m");
    click("[data-action=P2A][data-slot='1']");
    pressKey("KeyN", "n");
    click("[data-add-combo='Down+B']");
    pressKey("KeyC", "c");
    click("[data-add-combo='Down+A']");
    pressKey("KeyV", "v");

    const unbindButton = (label: string) => container.querySelector<HTMLElement>(`button[aria-label='${label}']`);
    act(() => unbindButton("Unbind Z from B")!.click());
    act(() => unbindButton("Unbind M from Player 2 A")!.click());
    act(() => unbindButton("Unbind C from Down+B")!.click());
    // Focus stays on the binding, now on its key button.
    expect(document.activeElement).toBe(container.querySelector("[data-combo='0']"));
    expect(unbindButton("Unbind Z from B")).toBeNull();
    expect(container.querySelector("[data-action=B][data-slot='0']")?.textContent).toBe("Right click");
    expect(container.querySelector("[data-action=B][data-slot='1']")?.textContent).toBe("none");
    expect(container.querySelector("[data-action=P2A][data-slot='0']")?.textContent).toBe("N");
    expect(container.querySelector("[data-combo='0']")?.textContent).toBe("unbound");
    expect(unbindButton("Unbind C from Down+B")).toBeNull();
    expect(container.querySelector("[data-combo='1']")?.textContent).toBe("V");
    expect(sideKeys("B")).toBe("Right click");
    expect(sideKeys("A")).toBe("X");
    expect([...sideTable("Player 2")!].map((row) => row.textContent)).toEqual(["ANnoneSecond gamepad"]);
    expect([...sideTable("Combo")!].map((row) => row.textContent)).toEqual(["Down+Bunbound", "Down+AV"]);

    await reopenPage();
    act(() => cards()[0].click());
    await waitFor("the game to run", () => debug().game);
    expect([...sideTable("Player 2")!].map((row) => row.textContent)).toEqual(["ANnoneSecond gamepad"]);
    expect([...sideTable("Combo")!].map((row) => row.textContent)).toEqual(["Down+Bunbound", "Down+AV"]);
    expect(sideKeys("B")).toBe("Right click");
    act(() => canvas().focus());
    for (const code of ["KeyZ", "KeyM", "KeyC"]) {
      keyDown(code);
      expect(held(), code).toEqual([]);
      keyUp(code);
    }
    keyDown("KeyX");
    keyDown("KeyN");
    keyDown("KeyV");
    expect(held()).toEqual(["1:A", "1:Down", "2:A"]);
    keyUp("KeyX");
    keyUp("KeyN");
    keyUp("KeyV");

    // The unbound combo takes a key again.
    openControls();
    click("[data-combo='0']");
    pressKey("KeyC", "c");
    expect(container.querySelector("[data-combo='0']")?.textContent).toBe("C");
    expect(stored().combos[0]).toEqual({ code: "KeyC", buttons: ["Down", "B"] });
  });

  it("unbinds a hotkey's key: the hotkey shows as unbound and its old key does nothing", async () => {
    await startGame();
    pressKey("Escape");
    click("[data-item=display]");
    click("[data-item=show-controls]");
    click("[data-item=back]");
    click("[data-item=controls]");

    act(() => container.querySelector<HTMLElement>("button[aria-label='Unbind Tab from Fast-forward (hold)']")!.click());
    expect(container.querySelector("[data-action=FastForward][data-slot='0']")?.textContent).toBe("unbound");
    expect(container.querySelector("button[aria-label='Unbind Tab from Fast-forward (hold)']")).toBeNull();
    expect(sideKeys("Fast-forward (hold)")).toBe("unbound");
    expect(stored().FastForward).toEqual([]);
    expect(stored().Screenshot).toEqual(["F2"]);
    backToGame();

    keyDown("Tab");
    expect(debug().speed).toBe(1);
    keyUp("Tab");
  });
});

describe("App hints", () => {
  it("says how to start sound by the picture until the first key or click, once", async () => {
    await startGame();
    // The ROM was added by a change event, not a click or key: sound has not started.
    expect(container.querySelector(".sound-hint")?.textContent).toBe("Click or press a key to start sound");
    pressKey("KeyZ", "z");
    expect(container.querySelector(".sound-hint")).toBeNull();
  });

  it("pauses when the window loses focus, says so, and resumes on a click", async () => {
    await startGame();
    act(() => window.dispatchEvent(new Event("blur")));
    expect(container.querySelector(".focus-paused")?.textContent).toBe("Paused: click to resume");
    const before = debug().framesRun;
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(debug().framesRun).toBe(before);
    act(() => container.querySelector("canvas.screen")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(container.querySelector(".focus-paused")).toBeNull();
    await expectRunning();
  });

  it("asks for a button press in Controls until a gamepad appears", async () => {
    await startGame();
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=controls]")!.click());
    expect(dialog()?.textContent).toContain("Press any button on your controller");
  });
});

const sidePanel = () => container.querySelector(".controls-side");
/** The key cell of the controls panel's row named `label` ("B", "Screenshot"). */
const sideKeys = (label: string) =>
  [...container.querySelectorAll(".controls-side tbody tr")].find((row) => row.querySelector("th")?.textContent === label)?.querySelector(".side-keys")?.textContent;
/** The secondary key cell of the controls panel's row named `label`. */
const sideSecondary = (label: string) =>
  [...container.querySelectorAll(".controls-side tbody tr")].find((row) => row.querySelector("th")?.textContent === label)?.querySelector(".side-secondary")?.textContent;

describe("the controls panel beside the game", () => {
  it("is off by default, turned on in Display and speed, lists the live bindings, follows a rebinding at once and survives a reload", async () => {
    await startGame();
    expect(sidePanel()).toBeNull();
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=display]")!.click());
    act(() => container.querySelector<HTMLElement>("[data-item=show-controls]")!.click());
    expect(sidePanel()).not.toBeNull();
    expect(container.querySelector("main")?.className).toBe("layout with-controls");
    expect(sideKeys("B")).toBe("Z");
    expect(sideKeys("Select")).toBe("Left Shift");
    expect(sideSecondary("Select")).toBe("Right Shift");
    expect(sideSecondary("Up")).toBe("W");
    expect(sideSecondary("A")).toBe("Left click");
    expect(sideSecondary("B")).toBe("Right click");
    expect(sideSecondary("Menu")).toBe("none");
    expect(sideKeys("Menu")).toBe("Esc");
    expect(sideKeys("Screenshot")).toBe("F2");
    expect(sideKeys("Tune panel")).toBe("F3");
    expect(sidePanel()?.textContent).toContain("Bottom or left face button");

    // Rebinding B in Controls… shows in the panel while the menu is still open.
    act(() => container.querySelector<HTMLElement>("[data-item=back]")!.click());
    act(() => container.querySelector<HTMLElement>("[data-item=controls]")!.click());
    act(() => container.querySelector<HTMLElement>("[data-action=B]")!.click());
    pressKey("KeyK", "k");
    expect(sideKeys("B")).toBe("K");
    act(() => container.querySelector<HTMLElement>("[data-action=Screenshot]")!.click());
    pressKey("KeyP", "p");
    expect(sideKeys("Screenshot")).toBe("P");

    await reopenPage();
    act(() => cards()[0].click());
    await waitFor("the game to run", () => debug().game);
    expect(sideKeys("B")).toBe("K");

    // Turned off, it stays off after a reload too.
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=display]")!.click());
    act(() => container.querySelector<HTMLElement>("[data-item=show-controls]")!.click());
    expect(sidePanel()).toBeNull();
    await reopenPage();
    act(() => cards()[0].click());
    await waitFor("the game to run", () => debug().game);
    expect(sidePanel()).toBeNull();
  });

  it("stacks above the tools panel and the console in one column beside the picture when they are open", async () => {
    await startGame();
    turnOnDeveloperTools();
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=display]")!.click());
    act(() => container.querySelector<HTMLElement>("[data-item=show-controls]")!.click());
    pressKey("Escape");
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("canvas.screen")!.focus());
    pressKey("F4");
    await waitFor("the tools panel", () => container.querySelector(".tools-panel"));
    act(() => container.querySelector<HTMLElement>("canvas.screen")!.focus());
    pressKey("Backquote", "`");
    expect(sidePanel()).not.toBeNull();
    const column = container.querySelector(".side-panels")!;
    expect([...column.children].map((panel) => panel.className)).toEqual(["controls-side", "tools-panel", "console-panel"]);
    expect(container.querySelector("main")?.className).toBe("layout with-controls with-tools with-console");
    expect(container.querySelector(".app")?.className).toBe("app with-controls with-tools with-console");
  });
});

describe("test links", () => {
  const ROM = buildInes({ battery: true });
  let requested: string[];

  /** Opens the page at `search`, with the development server's /local-roms/ and /local-movies/ holding `files` (ROMs as bytes, movies as text). */
  async function openLink(search: string, files: Record<string, Uint8Array | string>) {
    window.history.replaceState(null, "", `/${search}`);
    requested = [];
    vi.stubGlobal("fetch", async (url: string) => {
      requested.push(url);
      if (url === "/local-roms/") return { ok: true, status: 200, json: async () => ({ files: Object.keys(files).filter((name) => !name.endsWith(".rwmovie.json")).sort() }) };
      const name = decodeURIComponent(url.replace(/^\/local-(roms|movies)\//, ""));
      const data = files[name];
      if (typeof data === "string") return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(data).buffer, text: async () => data, json: async () => JSON.parse(data) };
      return data
        ? { ok: true, status: 200, arrayBuffer: async () => data.slice().buffer, text: async () => "" }
        : { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), text: async () => `No ${name} in the test ROM folder.` };
    });
    await showLibrary();
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("open the ROM straight away with the label across the top, adding it to the library once", async () => {
    await openLink("?play=local-roms/Build%20A.nes&label=Original", { "Build A.nes": ROM });
    await waitFor("the game to run", () => debug().game && debug().framesRun > 5);
    expect(requested).toEqual(["/local-roms/Build%20A.nes"]);
    expect(debug().game).toBe("Build A.nes");
    const banner = container.querySelector(".test-label");
    expect(banner?.textContent).toBe("Original");
    // Above the header and the game, not inside the picture's section.
    expect(container.querySelector(".app")?.firstElementChild).toBe(banner);
    expect(document.title).toBe("Original · retrowright");
    // controls=1 was not given: the panel follows the setting, off by default.
    expect(sidePanel()).toBeNull();

    // A second open of the same link plays the game already in the library, with its saves.
    pressKey("F5");
    await waitFor("the save", () => noticeText().includes("Saved to slot 1."));
    await reopenPage();
    await waitFor("the game to run again", () => debug().game && debug().framesRun > 5);
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=load]")!.click());
    await waitFor("slot 1's card", () => container.querySelector("[data-slot='1']:not([aria-disabled=true])"));
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=quit]")!.click());
    await waitFor("the library", () => cards().length > 0);
    expect(cards()).toHaveLength(1);
    expect(container.querySelector(".test-label")?.textContent).toBe("Original");
  });

  it("show the controls panel in that tab with controls=1, without changing the setting", async () => {
    await openLink("?play=local-roms/b.nes&label=Patched&controls=1", { "b.nes": ROM });
    await waitFor("the game to run", () => debug().game);
    expect(sidePanel()).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("retrowright.display") ?? "{}").showControls).toBe(false);
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=display]")!.click());
    expect(container.querySelector("[data-item=show-controls]")?.textContent).toBe("Show controls beside the game: on");
  });

  /** A tunables file and a game profile for ROM, as a game's build tools write them beside it. */
  async function gameFilesFor(rom: Uint8Array) {
    const sha = await sha256Hex(rom);
    const tunables = {
      format: "retrowright-tunables",
      version: 1,
      romSha256: sha,
      patch: "racer.bps",
      values: [{ key: "grip", name: "Grip", description: "How the tyres hold.", romOffset: 16 + 0x200, cpuAddress: 0x8200, min: 0, max: 255, default: rom[16 + 0x200] }],
    };
    const profile = {
      format: "retrowright-game-profile",
      version: 1,
      title: "Homebrew Racer",
      romSha256: [sha],
      values: [{ name: "lap", description: "The lap.", address: "$0010" }],
      commands: [{ name: "pit", usage: "pit", help: "Writes 7 to the lap.", steps: [{ set: "lap", value: 7 }], reply: "In the pit." }],
    };
    return { tunables: JSON.stringify(tunables), profile: JSON.stringify(profile) };
  }

  /** Marks the page as the development server marks it when it serves a local ROM folder. */
  function markLocalFolder() {
    const meta = document.createElement("meta");
    meta.name = LOCAL_FOLDER_META;
    document.head.append(meta);
  }

  async function typeInConsole(line: string) {
    const input = container.querySelector<HTMLInputElement>(".console-form input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, line);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => void container.querySelector<HTMLFormElement>(".console-form")!.requestSubmit());
  }

  it("open a game the folder's games.json lists (game=), under its label, with the tunables and profile it names, renaming the library's entry", async () => {
    await showLibrary();
    // Added under another file name, the game is stored with the title Other.
    await addFiles(romFile("Other.nes", ROM));
    await waitFor("the game to open", () => debug().game === "Other.nes");
    await act(async () => root.unmount());
    root = createRoot(container);
    markLocalFolder();
    const files = await gameFilesFor(ROM);
    const games = JSON.stringify({ games: [{ id: "homebrew-racer", label: "Homebrew Racer", rom: "Racer.nes", tunables: "tuning.tunables.json", profile: "racer.profile.json" }] });
    await openLink("?game=homebrew-racer", { "Racer.nes": ROM, "games.json": games, "tuning.tunables.json": files.tunables, "racer.profile.json": files.profile });
    await waitFor("the game to run under its label", () => document.title === "Homebrew Racer · retrowright" && debug().framesRun > 5);
    expect(container.querySelector(".test-label")?.textContent).toBe("Homebrew Racer");
    expect(sidePanel()).not.toBeNull();
    pressKey("Escape");
    expect(container.querySelector("[data-item=tune]")).not.toBeNull();
    expect(container.querySelector("[data-item=load-tunables]")).toBeNull();
    pressKey("Escape");
    turnOnDeveloperTools();
    pressKey("Backquote", "`");
    await typeInConsole("pit");
    await waitFor("the profile's command to answer", () => container.querySelector(".console-log")?.textContent?.includes("In the pit."));
    expect(debug().peek(0x10)).toBe(7);
    act(() => container.querySelector<HTMLElement>("canvas.screen")!.focus());
    pressKey("Escape");
    act(() => container.querySelector<HTMLElement>("[data-item=quit]")!.click());
    await waitFor("the library", () => cards().length > 0);
    expect(cards().map((card) => card.querySelector(".card-title")?.textContent)).toEqual(["Homebrew Racer"]);
  });

  it("find a game's tunables and profile in the local folder by their contents, and name a file beside the ROM that is for another ROM", async () => {
    markLocalFolder();
    const files = await gameFilesFor(ROM);
    const other = (await gameFilesFor(buildInes())).tunables;
    await openLink("?play=local-roms/Racer.nes", { "Racer.nes": ROM, "Racer.tunables.json": other, "any name.tunables.json": files.tunables, "z.profile.json": files.profile });
    await waitFor("the game to run", () => debug().game === "Racer.nes" && debug().framesRun > 5);
    expect(requested).toContain("/local-roms/");
    expect(noticeText()).toContain("Racer.tunables.json is for another ROM");
    pressKey("Escape");
    expect(container.querySelector("[data-item=tune]")).not.toBeNull();
  });

  it("say when game= names a game the folder's games.json does not list", async () => {
    markLocalFolder();
    await openLink("?game=missing", { "games.json": JSON.stringify({ games: [] }) });
    await waitFor("the notice", () => noticeText().includes("game=missing"));
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Test link: game=missing is not in the local ROM folder's games.json, which lists none.");
  });

  it("name the file they looked for when it is missing, and stay in the library", async () => {
    await openLink("?play=local-roms/Gone.nes&label=Original", {});
    await waitFor("the notice", () => noticeText().includes("Gone.nes"));
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Test link: “Gone.nes” was not found. No Gone.nes in the test ROM folder.");
    expect(debug().game).toBeNull();
    expect(container.querySelector("#rom-input")).not.toBeNull();
  });

  /** A power-on movie of `frames` frames for the ROM with this SHA-256, holding Start from frame 5. */
  const movieFor = (sha256: string, name: string, frames: number) =>
    JSON.stringify({
      format: "retrowright-movie",
      version: 1,
      rom: { name, sha256 },
      core: { name: "jsnes", version: "2.1.0" },
      start: { kind: "power-on", batteryRam: null },
      frames,
      inputs: [{ frame: 5, pad1: 8, pad2: 0 }],
      events: [],
      checkpoints: [],
    });

  it("play a movie from its start with movie=, showing its frame count until it ends", async () => {
    const movie = movieFor(await sha256Hex(ROM), "Bot.nes", 90);
    await openLink("?play=local-roms/Bot.nes&movie=local-movies/Bot%20run.rwmovie.json&label=Bot", { "Bot.nes": ROM, "Bot run.rwmovie.json": movie });
    await waitFor("the movie to play", () => debug().movieStatus().mode === "playing");
    expect(requested).toEqual(["/local-roms/Bot.nes", "/local-movies/Bot%20run.rwmovie.json"]);
    await waitFor("the frame count under the picture", () => /^▶ movie frame \d+ \/ 90$/.test(container.querySelector(".play-indicator")?.textContent ?? ""));
    await waitFor("the movie's end", () => noticeText().includes("Movie finished"), 10_000);
    expect(debug().movieStatus()).toMatchObject({ mode: "idle", finished: true });
  });

  it("report the end of a 1-frame movie, which ends before the movie indicator first looks", async () => {
    const movie = JSON.stringify({ ...JSON.parse(movieFor(await sha256Hex(ROM), "Bot.nes", 1)), inputs: [] });
    await openLink("?play=local-roms/Bot.nes&movie=local-movies/Short.rwmovie.json", { "Bot.nes": ROM, "Short.rwmovie.json": movie });
    await waitFor("the movie's end", () => noticeText().includes("Movie finished: 0 checkpoint(s) passed."), 3_000);
    expect(debug().movieStatus()).toMatchObject({ mode: "idle", finished: true });
  });

  it("refuse a movie of another ROM with the player's message, leaving the game running", async () => {
    const movie = movieFor("0".repeat(64), "Other.nes", 90);
    await openLink("?play=local-roms/Bot.nes&movie=local-movies/Other.rwmovie.json", { "Bot.nes": ROM, "Other.rwmovie.json": movie });
    await waitFor("the notice", () => noticeText().includes("could not be played"));
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      `Other.rwmovie.json could not be played: This movie was recorded on Other.nes (SHA-256 000000000000…), not this ROM (${(await sha256Hex(ROM)).slice(0, 12)}…).`,
    );
    expect(debug().game).toBe("Bot.nes");
    expect(debug().movieStatus().mode).toBe("idle");
  });

  it("name a missing movie and still open the game", async () => {
    await openLink("?play=local-roms/Bot.nes&movie=local-movies/Gone.rwmovie.json", { "Bot.nes": ROM });
    await waitFor("the game to run", () => debug().game && debug().framesRun > 5);
    expect(noticeText()).toContain("Test link: “Gone.rwmovie.json” was not found. No Gone.rwmovie.json in the test ROM folder.");
    expect(debug().movieStatus().mode).toBe("idle");
  });

  it("refuse a play= outside local-roms/ without fetching it", async () => {
    await openLink("?play=https://example.com/x.nes", {});
    await waitFor("the notice", () => noticeText().includes("Test link"));
    expect(noticeText()).toContain("play=https://example.com/x.nes is not a file in local-roms/");
    expect(requested).toEqual([]);
  });
});
