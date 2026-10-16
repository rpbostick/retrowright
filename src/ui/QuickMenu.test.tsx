// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, NES_VIDEO } from "../core/types";
import { DEFAULT_DISPLAY_PREFS } from "./displayPrefs";
import { addCombo, DEFAULT_BINDINGS, Hotkey, toggleComboButton } from "../input/keyBindings";
import type { StateRecord } from "../storage/gameStore";
import { DEFAULT_TOUCH_PREFS } from "../touch/touchPrefs";
import { QuickMenu, type QuickMenuHandle, type QuickMenuProps } from "./QuickMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLOT_2: StateRecord = { romId: "rom", slot: 2, state: { core: "test", data: {} }, savedAt: Date.UTC(2026, 9, 10, 18, 30), thumbnail: "data:image/png;base64,AAAA" };

function handlers() {
  return {
    onResume: vi.fn(),
    onSave: vi.fn(),
    onLoad: vi.fn(),
    onReset: vi.fn(),
    onQuit: vi.fn(),
    onRebind: vi.fn(),
    onResetDefaults: vi.fn(),
    onChangeBindings: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onNextTheme: vi.fn(),
    onRecordChoice: vi.fn(),
    onToggleRecord: vi.fn(),
    onMark: vi.fn(),
    onPlayMovieFile: vi.fn(),
    onStopMovie: vi.fn(),
    onTouchShown: vi.fn(),
    onTouchPrefs: vi.fn(),
    onDisplayPrefs: vi.fn(),
    onToggleFastForward: vi.fn(),
    onScreenshot: vi.fn(),
    onTools: vi.fn(),
    onTune: vi.fn(),
    onLoadGameFile: vi.fn(),
    onControlsShown: vi.fn(),
    onReplaySeconds: vi.fn(),
    onSaveReplay: vi.fn(),
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderMenu(overrides: Partial<QuickMenuProps> = {}) {
  const calls = handlers();
  const ref = createRef<QuickMenuHandle>();
  const props: QuickMenuProps = {
    gameName: "Final Fantasy",
    slots: [SLOT_2],
    currentSlot: 1,
    movieStatus: { mode: "idle", frame: 0, frames: null, results: [], finished: false },
    recordChoice: "power-on-keep",
    bindings: DEFAULT_BINDINGS,
    rebinding: null,
    gamepad: null,
    padInUse: false,
    fullscreen: { available: true, on: false },
    theme: "system",
    touch: { shown: true, prefs: DEFAULT_TOUCH_PREFS, vibrateAvailable: true },
    video: NES_VIDEO,
    displayPrefs: DEFAULT_DISPLAY_PREFS,
    fastForwardOn: false,
    toolsAvailable: false,
    tuneAvailable: false,
    loadTunablesAvailable: false,
    controlsShown: false,
    replaySeconds: 60,
    ...calls,
    ...overrides,
  };
  const render = (next: Partial<QuickMenuProps> = {}) => act(() => root.render(<QuickMenu ref={ref} {...props} {...next} />));
  render();
  return { calls, ref, render };
}

const focused = () => document.activeElement as HTMLElement;
const item = () => focused().dataset.item ?? focused().dataset.slot ?? focused().textContent;

function key(name: string, init: KeyboardEventInit = {}) {
  act(() => {
    focused().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
  });
}

/** Enter on a focused button: the browser turns it into a click. */
function enter() {
  key("Enter");
  act(() => focused().click());
}

function command(name: Parameters<QuickMenuHandle["command"]>[0], ref: React.RefObject<QuickMenuHandle>) {
  act(() => ref.current!.command(name));
}

describe("QuickMenu's display and speed", () => {
  it("toggles integer scaling, the core's 8:7 pixel aspect and scanlines, and sets the fast-forward speed", () => {
    const { calls, ref } = renderMenu();
    act(() => container.querySelector<HTMLElement>("[data-item=display]")!.click());
    expect(container.querySelector("#menu-title")?.textContent).toBe("Display and speed");
    expect(container.querySelector("[data-item=aspect]")?.textContent).toBe("Pixel aspect: 8:7");
    // The touch controls show: with no scaling chosen, the picture fills their screen rectangle.
    expect(container.querySelector("[data-item=scaling]")?.textContent).toBe("Integer scaling: off (fill)");
    act(() => container.querySelector<HTMLElement>("[data-item=scaling]")!.click());
    expect(calls.onDisplayPrefs).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY_PREFS, scaling: "integer" });
    act(() => container.querySelector<HTMLElement>("[data-item=aspect]")!.click());
    expect(calls.onDisplayPrefs).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY_PREFS, aspect: "square" });
    act(() => container.querySelector<HTMLElement>("[data-item=scanlines]")!.click());
    expect(calls.onDisplayPrefs).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY_PREFS, scanlines: true });
    const intensity = container.querySelector<HTMLInputElement>("[data-item=scanline-intensity]")!;
    act(() => intensity.focus());
    command("right", ref);
    expect(calls.onDisplayPrefs).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY_PREFS, scanlineIntensity: 0.4 });
    expect(container.querySelector(".menu-display")?.textContent).toContain("Hold Tab, a pad's right trigger");
    const speed = container.querySelector<HTMLSelectElement>("[data-item=fast-forward-speed]")!;
    act(() => {
      speed.value = "4";
      speed.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(calls.onDisplayPrefs).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY_PREFS, fastForwardSpeed: 4 });
    act(() => container.querySelector<HTMLElement>("[data-item=fast-forward]")!.click());
    expect(calls.onToggleFastForward).toHaveBeenCalledTimes(1);
  });

  it("turns the controls panel on and off, and says it is not shown in touch play", () => {
    const { calls, render } = renderMenu({ touch: { shown: false, prefs: DEFAULT_TOUCH_PREFS, vibrateAvailable: false } });
    act(() => container.querySelector<HTMLElement>("[data-item=display]")!.click());
    const toggle = () => container.querySelector<HTMLButtonElement>("[data-item=show-controls]")!;
    expect(toggle().textContent).toBe("Show controls beside the game: off");
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    act(() => toggle().click());
    expect(calls.onControlsShown).toHaveBeenLastCalledWith(true);
    render({ controlsShown: true, touch: { shown: false, prefs: DEFAULT_TOUCH_PREFS, vibrateAvailable: false } });
    expect(toggle().textContent).toBe("Show controls beside the game: on");
    act(() => toggle().click());
    expect(calls.onControlsShown).toHaveBeenLastCalledWith(false);
    expect(container.querySelector(".menu-display")?.textContent).not.toContain("not shown in touch play");
    render({ controlsShown: true, touch: { shown: true, prefs: DEFAULT_TOUCH_PREFS, vibrateAvailable: false } });
    expect(container.querySelector(".menu-display")?.textContent).toContain("The controls panel is not shown in touch play");
  });

  it("offers square pixels alone for a core whose pixels are square", () => {
    renderMenu({ video: { width: 240, height: 160, pixelAspect: { width: 1, height: 1 }, frameRate: 59.7275 } });
    act(() => container.querySelector<HTMLElement>("[data-item=display]")!.click());
    const aspect = container.querySelector<HTMLButtonElement>("[data-item=aspect]")!;
    expect(aspect.textContent).toBe("Pixel aspect: square");
    expect(aspect.disabled).toBe(true);
  });

  it("offers the tools panel, naming its key, only when the page offers it (not in touch play)", () => {
    const { calls, render } = renderMenu({ toolsAvailable: true });
    const tools = container.querySelector<HTMLElement>("[data-item=tools]")!;
    expect(tools.querySelector(".menu-hint")?.textContent).toBe("F4");
    act(() => tools.click());
    expect(calls.onTools).toHaveBeenCalledTimes(1);
    render({ toolsAvailable: false });
    expect(container.querySelector("[data-item=tools]")).toBeNull();
  });

  it("offers the Tune panel, naming its key, only when the page offers it (a game with tunables)", () => {
    const { calls, render } = renderMenu({ tuneAvailable: true });
    const tune = container.querySelector<HTMLElement>("[data-item=tune]")!;
    expect(tune.textContent).toContain("Tune…");
    expect(tune.querySelector(".menu-hint")?.textContent).toBe("F3");
    act(() => tune.click());
    expect(calls.onTune).toHaveBeenCalledTimes(1);
    render({ tuneAvailable: false });
    expect(container.querySelector("[data-item=tune]")).toBeNull();
  });

  it("offers to load a tunables file or game profile when the game has no tunables, and hands the picked file on", () => {
    const { calls, render } = renderMenu({ loadTunablesAvailable: true });
    const load = container.querySelector<HTMLElement>("[data-item=load-tunables]")!;
    expect(load.textContent).toBe("Load tunables…or a game profile");
    const input = container.querySelector<HTMLInputElement>("#game-file-input")!;
    const picked = vi.spyOn(input, "click").mockImplementation(() => {});
    act(() => load.click());
    expect(picked).toHaveBeenCalledTimes(1);
    const file = new File(["{}"], "racer.tunables.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file] });
    act(() => void input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(calls.onLoadGameFile).toHaveBeenCalledWith(file);
    render({ loadTunablesAvailable: false });
    expect(container.querySelector("[data-item=load-tunables]")).toBeNull();
  });

  it("saves the last minute from the main menu, naming its key, except while it is off or a movie records or plays", () => {
    const { calls, render } = renderMenu();
    const saveReplay = () => container.querySelector<HTMLButtonElement>("[data-item=save-replay]")!;
    expect(saveReplay().textContent).toBe("Save the last minuteR");
    act(() => saveReplay().click());
    expect(calls.onSaveReplay).toHaveBeenCalledTimes(1);
    render({ replaySeconds: 0 });
    expect(saveReplay().disabled).toBe(true);
    expect(saveReplay().querySelector(".menu-hint")?.textContent).toBe("Instant replay is off");
    render({ movieStatus: { mode: "recording", frame: 5, frames: null, results: [], finished: false } });
    expect(saveReplay().disabled).toBe(true);
  });

  it("sets the instant replay's length, or turns it off, in the Movies view", () => {
    const { calls } = renderMenu();
    act(() => container.querySelector<HTMLElement>("[data-item=movie]")!.click());
    const length = container.querySelector<HTMLSelectElement>("[data-item=replay-seconds]")!;
    expect([...length.options].map((option) => option.textContent)).toEqual(["Off", "30 seconds", "60 seconds", "120 seconds"]);
    expect(length.value).toBe("60");
    act(() => {
      length.value = "0";
      length.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(calls.onReplaySeconds).toHaveBeenLastCalledWith(0);
  });

  it("takes a screenshot from the main menu, naming the key bound to it", () => {
    const { calls } = renderMenu({ bindings: { ...DEFAULT_BINDINGS, [Hotkey.Screenshot]: ["KeyP"] } });
    expect(container.querySelector("[data-item=screenshot] .menu-hint")?.textContent).toBe("P");
    act(() => container.querySelector<HTMLElement>("[data-item=screenshot]")!.click());
    expect(calls.onScreenshot).toHaveBeenCalledTimes(1);
  });
});

describe("QuickMenu", () => {
  it("is a labelled modal dialog with focus on Resume", () => {
    renderMenu();
    const dialog = container.querySelector("[role=dialog]")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Menu");
    expect([...dialog.querySelectorAll("[role=menuitem]")].map((node) => node.firstChild?.textContent)).toEqual([
      "Resume",
      "Save state…",
      "Load state…",
      "Reset",
      "Controls…",
      "Touch controls…",
      "Display and speed…",
      "Screenshot",
      "Save the last minute",
      "Record and play movie…",
      "Quit to library",
    ]);
    expect(item()).toBe("resume");
  });

  it("moves with the arrow keys, wraps at the ends, and keeps Tab inside", () => {
    renderMenu();
    key("ArrowDown");
    key("ArrowDown");
    expect(item()).toBe("load");
    key("ArrowUp");
    key("ArrowUp");
    key("ArrowUp");
    expect(item()).toBe("quit");
    key("Tab");
    expect(item()).toBe("resume");
    key("Tab", { shiftKey: true });
    expect(item()).toBe("quit");
  });

  it("pulls focus back when it leaves the dialog", () => {
    renderMenu();
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => outside.focus());
    expect(item()).toBe("resume");
    outside.remove();
  });

  it("reaches every action with the keyboard alone", () => {
    const { calls } = renderMenu();
    enter();
    expect(calls.onResume).toHaveBeenCalledTimes(1);

    key("ArrowDown");
    enter(); // Save state…
    expect(container.querySelector("h2")?.textContent).toBe("Save state");
    expect(item()).toBe("1");
    enter(); // slot 1 is empty: saves at once
    expect(calls.onSave).toHaveBeenLastCalledWith(1);
    key("ArrowRight");
    enter(); // slot 2 is full: asks first, focus on Cancel
    expect(container.textContent).toContain("Slot 2 holds a save from");
    expect(item()).toBe("cancel");
    key("ArrowUp");
    expect(item()).toBe("overwrite");
    enter();
    expect(calls.onSave).toHaveBeenLastCalledWith(2);
    key("Escape"); // back to the grid
    key("Escape"); // back to the menu, on the item that opened the grid
    expect(item()).toBe("save");

    key("ArrowDown");
    enter(); // Load state…
    expect(item()).toBe("1");
    enter(); // empty slot: nothing to load
    expect(calls.onLoad).not.toHaveBeenCalled();
    key("ArrowRight");
    enter();
    expect(calls.onLoad).toHaveBeenCalledWith(2);
    key("Escape");

    key("ArrowDown");
    enter();
    expect(calls.onReset).toHaveBeenCalledTimes(1);

    key("ArrowDown");
    enter(); // Controls…
    expect(container.querySelector(".pad-diagram")).not.toBeNull();
    expect(focused().getAttribute("aria-label")).toBe("Up, primary: ↑");
    enter();
    expect(calls.onRebind).toHaveBeenCalledWith({ action: Button.Up, slot: 0 });
    key("Escape");

    key("ArrowDown");
    enter(); // Touch controls…
    expect(item()).toBe("touch-shown");
    enter();
    expect(calls.onTouchShown).toHaveBeenCalledWith(false);
    key("Escape");

    key("ArrowDown");
    enter(); // Display and speed…
    expect(item()).toBe("fullscreen");
    enter();
    expect(calls.onToggleFullscreen).toHaveBeenCalledTimes(1);
    key("ArrowDown");
    enter();
    expect(calls.onNextTheme).toHaveBeenCalledTimes(1);
    key("ArrowDown");
    enter();
    // Touch play's default is fill, so choosing the item turns integer scaling on.
    expect(calls.onDisplayPrefs).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY_PREFS, scaling: "integer" });
    key("Escape");

    key("ArrowDown");
    enter(); // Screenshot
    expect(calls.onScreenshot).toHaveBeenCalledTimes(1);

    key("ArrowDown");
    enter(); // Save the last minute
    expect(calls.onSaveReplay).toHaveBeenCalledTimes(1);

    key("ArrowDown");
    enter(); // Record and play movie…
    expect(focused().className).toBe("record");
    enter();
    expect(calls.onToggleRecord).toHaveBeenCalledTimes(1);
    key("Escape");

    key("ArrowDown");
    enter();
    expect(calls.onQuit).toHaveBeenCalledTimes(1);

    key("Escape"); // Esc on the main view closes the menu
    expect(calls.onResume).toHaveBeenCalledTimes(2);
  });

  it("is driven by a gamepad's commands: D-pad moves, A chooses, B goes back", () => {
    const { calls, ref } = renderMenu();
    command("down", ref);
    command("choose", ref);
    expect(item()).toBe("1");
    command("right", ref);
    command("choose", ref);
    expect(item()).toBe("cancel");
    command("back", ref);
    expect(item()).toBe("1");
    command("down", ref); // down a row of four
    expect(item()).toBe("5");
    command("back", ref);
    expect(item()).toBe("save");
    command("down", ref);
    command("down", ref);
    command("choose", ref);
    expect(calls.onReset).toHaveBeenCalledTimes(1);
    command("back", ref);
    expect(calls.onResume).toHaveBeenCalledTimes(1);
  });

  it("leaves fullscreen and the movie file picker to the mouse and keyboard: a pad's press is no user activation", () => {
    const pickFile = vi.spyOn(HTMLInputElement.prototype, "click");
    const { calls, ref } = renderMenu({ padInUse: true });
    for (let step = 0; step < 6; step++) command("down", ref);
    command("choose", ref); // Display and speed…
    expect(item()).toBe("fullscreen");
    expect(container.textContent).toContain("Use the mouse or keyboard for this");
    command("choose", ref);
    expect(calls.onToggleFullscreen).not.toHaveBeenCalled();
    act(() => focused().click()); // a mouse click still works
    expect(calls.onToggleFullscreen).toHaveBeenCalledTimes(1);

    command("back", ref);
    command("down", ref); // Screenshot
    command("down", ref); // Save the last minute
    command("down", ref);
    command("choose", ref); // Record and play movie…
    const play = container.querySelector<HTMLElement>(".play-movie")!;
    act(() => play.focus());
    expect(document.getElementById(play.getAttribute("aria-describedby")!)?.textContent).toBe("Use the mouse or keyboard for this");
    command("choose", ref);
    expect(pickFile).not.toHaveBeenCalled();
    pickFile.mockRestore();
  });

  it("shows no gamepad hint while the mouse or keyboard is in use", () => {
    renderMenu({ padInUse: false });
    act(() => container.querySelector<HTMLElement>("[data-item=display]")!.click());
    expect(container.textContent).not.toContain("Use the mouse or keyboard for this");
  });

  it("changes a select with the pad's left and right", () => {
    const { calls, ref } = renderMenu();
    for (let step = 0; step < 9; step++) command("down", ref);
    command("choose", ref); // Movies
    command("down", ref);
    expect(focused().tagName).toBe("SELECT");
    command("right", ref);
    expect(calls.onRecordChoice).toHaveBeenCalledWith("power-on-clear");
  });

  it("sets the touch controls' size and opacity with sliders, which the pad's left and right move", () => {
    const { calls, ref } = renderMenu();
    act(() => container.querySelector<HTMLElement>("[data-item=touch]")!.click());
    const size = container.querySelector<HTMLInputElement>("[data-item=touch-size]")!;
    expect(container.querySelector(".menu-slider output")?.textContent).toBe("100%");
    act(() => size.focus());
    command("right", ref);
    expect(calls.onTouchPrefs).toHaveBeenLastCalledWith({ ...DEFAULT_TOUCH_PREFS, size: 1.05 });
    key("ArrowLeft"); // left and right stay with the slider instead of moving focus
    expect(focused()).toBe(size);
    command("down", ref);
    expect(focused().dataset.item).toBe("touch-opacity");
    command("left", ref);
    expect(calls.onTouchPrefs).toHaveBeenLastCalledWith({ ...DEFAULT_TOUCH_PREFS, opacity: 0.8 });
    command("down", ref);
    expect(focused().dataset.item).toBe("touch-vibrate");
    command("choose", ref);
    expect(calls.onTouchPrefs).toHaveBeenLastCalledWith({ ...DEFAULT_TOUCH_PREFS, vibrate: true });
  });

  it("offers no vibration where the browser cannot vibrate, and says how hidden controls come back", () => {
    renderMenu({ touch: { shown: false, prefs: DEFAULT_TOUCH_PREFS, vibrateAvailable: false } });
    expect(container.querySelector("[data-item=touch] .menu-hint")?.textContent).toBe("Off");
    act(() => container.querySelector<HTMLElement>("[data-item=touch]")!.click());
    expect(container.querySelector("[data-item=touch-vibrate]")).toBeNull();
    expect(container.querySelector("[data-item=touch-shown]")?.textContent).toBe("Touch controls: off");
  });

  it("works with the mouse", () => {
    const { calls } = renderMenu();
    act(() => container.querySelector<HTMLElement>("[data-item=load]")!.click());
    act(() => container.querySelector<HTMLElement>("[data-slot='2']")!.click());
    expect(calls.onLoad).toHaveBeenCalledWith(2);
    act(() => container.querySelector<HTMLElement>("[data-item=back]")!.click());
    act(() => container.querySelector<HTMLElement>(".menu-backdrop")!.click());
    expect(calls.onResume).toHaveBeenCalledTimes(1);
  });

  it("shows each slot as a card: a thumbnail and time, or empty", () => {
    renderMenu();
    act(() => container.querySelector<HTMLElement>("[data-item=save]")!.click());
    const cards = [...container.querySelectorAll<HTMLElement>(".slot-card")];
    expect(cards).toHaveLength(8);
    expect(cards[1].querySelector("img")?.getAttribute("src")).toBe(SLOT_2.thumbnail);
    expect(cards[1].querySelector(".slot-time")?.textContent).toMatch(/2026/);
    expect(cards[0].textContent).toContain("Empty");
    // Each name holds the card's visible words in their order.
    expect(cards[0].getAttribute("aria-label")).toBe("Save to empty slot 1, current slot");
    expect(cards[1].getAttribute("aria-label")).toMatch(/^Save to slot 2, .*2026/);
  });

  it("lights the button being remapped on the pad diagram", () => {
    const { render } = renderMenu();
    act(() => container.querySelector<HTMLElement>("[data-item=controls]")!.click());
    expect(container.querySelector(".pad-part.lit")).toBeNull();
    render({ rebinding: { action: Button.A, slot: 1 } });
    expect(container.querySelector(".pad-part.lit")?.getAttribute("data-button")).toBe("A");
    expect(container.querySelector(".pad-diagram")?.getAttribute("aria-label")).toBe("NES pad, A highlighted");
  });

  it("shows a primary and a secondary binding for each action, each rebound on its own", () => {
    const { calls, render } = renderMenu();
    act(() => container.querySelector<HTMLElement>("[data-item=controls]")!.click());
    const binding = (action: string, slot: number) => container.querySelector<HTMLElement>(`[data-action=${action}][data-slot="${slot}"]`)!;
    expect([...container.querySelectorAll(".bindings thead th")].map((cell) => cell.textContent)).toEqual(["Action", "Primary", "Secondary"]);
    expect(binding("Up", 0).textContent).toBe("↑");
    expect(binding("Up", 1).textContent).toBe("W");
    expect(binding("A", 0).textContent).toBe("X");
    expect(binding("A", 1).getAttribute("aria-label")).toBe("A, secondary: Left click");
    expect(binding("B", 1).textContent).toBe("Right click");
    expect(binding("SaveState", 1).textContent).toBe("none");
    act(() => binding("B", 1).click());
    expect(calls.onRebind).toHaveBeenLastCalledWith({ action: Button.B, slot: 1 });
    render({ rebinding: { action: Button.B, slot: 1 } });
    expect(binding("B", 1).textContent).toBe("Press a key…");
    expect(binding("B", 0).textContent).toBe("Z");
    // Choosing the waiting binding again cancels.
    act(() => binding("B", 1).click());
    expect(calls.onRebind).toHaveBeenLastCalledWith(null);
  });

  it("lists the combos with their key and buttons, and offers Down+B and Down+A until each is added", () => {
    const withCombo = addCombo(DEFAULT_BINDINGS, "KeyC", [Button.Down, Button.B]);
    const { calls, render } = renderMenu({ bindings: withCombo });
    act(() => container.querySelector<HTMLElement>("[data-item=controls]")!.click());
    expect(container.querySelector("[data-combo='0']")?.getAttribute("aria-label")).toBe("Combo Down+B, key: C");
    expect([...container.querySelectorAll("[data-combo-button][aria-pressed=true]")].map((button) => button.textContent)).toEqual(["Down", "B"]);
    expect([...container.querySelectorAll("[data-add-combo]")].map((button) => button.textContent)).toEqual(["Add Down+A", "Add another combo…"]);
    act(() => container.querySelector<HTMLElement>("[data-combo-button=A]")!.click());
    expect(calls.onChangeBindings).toHaveBeenLastCalledWith(toggleComboButton(withCombo, 0, Button.A));
    act(() => container.querySelector<HTMLElement>("[data-remove-combo='0']")!.click());
    expect(calls.onChangeBindings).toHaveBeenLastCalledWith({ ...withCombo, combos: [] });
    act(() => container.querySelector<HTMLElement>("[data-add-combo='Down+A']")!.click());
    expect(calls.onRebind).toHaveBeenLastCalledWith({ newCombo: [Button.Down, Button.A] });
    render({ rebinding: { newCombo: [Button.Down, Button.A] } });
    expect(container.querySelector("[data-add-combo='Down+A']")?.textContent).toBe("Press a key for Down+A…");
    render({ rebinding: { combo: 0 } });
    expect(container.querySelector("[data-combo='0']")?.textContent).toBe("Press a key…");
    expect(container.querySelector(".pad-part.lit")).toBeNull();
  });

  it("leaves Esc to the rebinding while a key is being rebound", () => {
    const { calls, render } = renderMenu();
    act(() => container.querySelector<HTMLElement>("[data-item=controls]")!.click());
    render({ rebinding: { action: Button.A, slot: 0 } });
    key("Escape");
    expect(container.querySelector("h2")?.textContent).toBe("Controls");
    expect(calls.onResume).not.toHaveBeenCalled();
  });

  it("refuses Load and Quit while a movie records", () => {
    renderMenu({ movieStatus: { mode: "recording", frame: 10, frames: null, results: [], finished: false } });
    expect(container.querySelector<HTMLButtonElement>("[data-item=load]")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("[data-item=quit]")!.disabled).toBe(true);
  });
});
