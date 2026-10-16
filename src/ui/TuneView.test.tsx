// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsnesCore } from "../core/jsnesCore";
import { buildInes, READ_PAD_PROGRAM } from "../test/syntheticRom";
import { defaultValues, parseTunables, type Tunables } from "../tune/tunables";
import { TunePanel } from "./TunePanel";
import { useTune } from "./useTune";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROM_SHA256 = "d".repeat(64);
const TUNABLES: Tunables = parseTunables(
  {
    format: "retrowright-tunables",
    version: 1,
    romSha256: ROM_SHA256,
    patch: "test.bps",
    values: [
      { key: "push", name: "Push", description: "Speed one tap adds.", romOffset: 16 + 0x200, cpuAddress: 0x8200, min: 0, max: 32, default: 8 },
      { key: "brake", name: "Brake", description: "Speed the brake takes off.", romOffset: 16 + 0x201, cpuAddress: 0x8201, min: 0, max: 16, default: 5 },
      { key: "style", name: "Push style", description: "How the rider pushes.", romOffset: 16 + 0x202, cpuAddress: 0x8202, min: 0, max: 1, default: 1, choices: ["Direction taps", "B taps"] },
    ],
  },
  "test.tunables.json",
);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function freshCore(): JsnesCore {
  const rom = buildInes({ program: READ_PAD_PROGRAM });
  rom[16 + 0x200] = 8;
  rom[16 + 0x201] = 5;
  rom[16 + 0x202] = 1;
  const core = new JsnesCore({ onFrame() {}, onAudioSample() {}, onBatteryRamWrite() {} });
  core.load(rom);
  return core;
}

/** The Tune panel wired as App wires it: useTune opens the game's tunables and applies changes. */
const onTuneProblem = vi.fn();

function Tuned({ core, onClose = vi.fn(), onLoadFile = vi.fn() }: { core: JsnesCore; onClose?: () => void; onLoadFile?: (file: File) => void }) {
  const { tune, open, apply } = useTune(localStorage, onTuneProblem);
  useEffect(() => open(core, TUNABLES), [core, open]);
  if (!tune) return null;
  return (
    <TunePanel
      tunables={tune.tunables}
      values={tune.values}
      onChange={(key, value) => apply(core, tune.tunables, { ...tune.values, [key]: value })}
      onReset={() => apply(core, tune.tunables, defaultValues(tune.tunables))}
      onSaveVersion={vi.fn()}
      onLoadFile={onLoadFile}
      tuneKey="F3"
      onClose={onClose}
    />
  );
}

const slider = (key: string) => container.querySelector<HTMLInputElement>(`input[data-tune=${key}]`)!;
const shown = (key: string) => container.querySelector(`output[data-tune-value=${key}]`)!.textContent;

function slide(key: string, value: number) {
  const input = slider(key);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the Tune section", () => {
  it("has a Load tunables… button that picks a JSON file and hands it on", () => {
    const onLoadFile = vi.fn();
    act(() => root.render(<Tuned core={freshCore()} onLoadFile={onLoadFile} />));
    const button = container.querySelector<HTMLButtonElement>("[data-tool=tune-load]")!;
    expect(button.textContent).toBe("Load tunables…");
    const input = container.querySelector<HTMLInputElement>("#tune-file-input")!;
    expect(input.accept).toBe(".json,application/json");
    const picked = vi.spyOn(input, "click").mockImplementation(() => {});
    act(() => button.click());
    expect(picked).toHaveBeenCalledTimes(1);
    const file = new File(["{}"], "racer.tunables.json");
    Object.defineProperty(input, "files", { value: [file] });
    act(() => void input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onLoadFile).toHaveBeenCalledWith(file);
  });

  it("shows a labelled slider per value with its sentence and number, and moving one writes the byte into the running game", () => {
    const core = freshCore();
    act(() => root.render(<Tuned core={core} />));
    const sliders = [...container.querySelectorAll<HTMLInputElement>(".tune input[type=range]")];
    expect(sliders.map((input) => container.querySelector(`label[for=${input.id}]`)?.textContent)).toEqual(["Push", "Brake"]);
    expect(document.getElementById(slider("push").getAttribute("aria-describedby")!)?.textContent).toBe("Speed one tap adds. Default 8.");
    expect([slider("push").min, slider("push").max, shown("push")]).toEqual(["0", "32", "8"]);
    slide("push", 12);
    expect(core.peek(0x8200)).toBe(12);
    expect(shown("push")).toBe("12");
  });

  it("shows a byte with choices as a labelled list of their names, and picking one writes its value into the running game", () => {
    const core = freshCore();
    act(() => root.render(<Tuned core={core} />));
    const list = container.querySelector<HTMLSelectElement>("select[data-tune=style]")!;
    expect(container.querySelector(`label[for=${list.id}]`)?.textContent).toBe("Push style");
    expect([...list.options].map((option) => [option.value, option.textContent])).toEqual([["0", "Direction taps"], ["1", "B taps"]]);
    expect([list.value, shown("style")]).toEqual(["1", "B taps"]);
    expect(document.getElementById(list.getAttribute("aria-describedby")!)?.textContent).toBe("How the rider pushes. Default B taps.");
    act(() => {
      list.value = "0";
      list.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(core.peek(0x8202)).toBe(0);
    expect(shown("style")).toBe("Direction taps");
  });

  it("keeps tuned values across a reload, and Reset brings back the defaults", () => {
    act(() => root.render(<Tuned core={freshCore()} />));
    slide("push", 12);
    slide("brake", 9);
    act(() => root.unmount());
    root = createRoot(container);
    // A reload: a fresh core with the ROM as stored, and the values kept in the browser.
    const reloaded = freshCore();
    act(() => root.render(<Tuned core={reloaded} />));
    expect([shown("push"), shown("brake")]).toEqual(["12", "9"]);
    expect([reloaded.peek(0x8200), reloaded.peek(0x8201)]).toEqual([12, 9]);
    act(() => container.querySelector<HTMLButtonElement>("[data-tool=tune-reset]")!.click());
    expect([shown("push"), shown("brake")]).toEqual(["8", "5"]);
    expect([reloaded.peek(0x8200), reloaded.peek(0x8201)]).toEqual([8, 5]);
    expect(JSON.parse(localStorage.getItem(`retrowright.tune.${ROM_SHA256}`)!)).toEqual({ push: 8, brake: 5, style: 1 });
  });
});

describe("the Tune panel", () => {
  it("starts with focus on the first value, holds the Tune section alone, and closes on Esc without the page seeing the key", () => {
    const onClose = vi.fn();
    const pageKeys = vi.fn();
    document.addEventListener("keydown", pageKeys);
    act(() => root.render(<Tuned core={freshCore()} onClose={onClose} />));
    expect(document.activeElement).toBe(slider("push"));
    expect(container.querySelector(".tune-panel h2")?.textContent).toBe("Tune");
    expect(container.querySelector("[data-tool=tune-close]")?.textContent).toBe("CloseF3");
    expect(container.querySelector("[data-tool=comparison-equal], [data-tool=memory-toggle]")).toBeNull();
    act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pageKeys).not.toHaveBeenCalled();
    document.removeEventListener("keydown", pageKeys);
  });
});
