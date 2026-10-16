// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsnesCore } from "../core/jsnesCore";
import type { DebugHooks } from "../core/types";
import { buildInes, WRITE_BATTERY_RAM_PROGRAM } from "../test/syntheticRom";
import { ToolsPanel } from "./ToolsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROM_SHA256 = "c".repeat(64);
/** The CPU methods the hooks replace; none is an own property of jsnes's CPU while hooks are off. */
const WRAPPED = ["emulate", "load", "write", "push", "pull", "_takeBranch"];

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

/** A core running WRITE_BATTERY_RAM_PROGRAM (STA $6000 with $42), as the panel's host, with its hook calls recorded. */
function syntheticHost() {
  const core = new JsnesCore({ onFrame() {}, onAudioSample() {}, onBatteryRamWrite() {} });
  core.load(buildInes({ battery: true, program: WRITE_BATTERY_RAM_PROGRAM }));
  const hookCalls: (DebugHooks | null)[] = [];
  const host = {
    peek: (address: number) => core.peek(address),
    setDebugHooks: (hooks: DebugHooks | null) => {
      hookCalls.push(hooks);
      core.setDebugHooks(hooks);
    },
    debugHooksAvailable: true,
  };
  const cpu = (core as unknown as { nes: { cpu: object } }).nes.cpu;
  const wrapped = () => WRAPPED.filter((name) => Object.hasOwn(cpu, name));
  return { core, host, hookCalls, wrapped };
}

async function nextFrames(count = 3) {
  for (let frame = 0; frame < count; frame++) await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
}

function renderPanel(host: ReturnType<typeof syntheticHost>["host"], onClose = vi.fn()) {
  act(() => root.render(<ToolsPanel host={host} romSha256={ROM_SHA256} storage={localStorage} toolsKey="F4" onClose={onClose} onProblem={vi.fn()} />));
  return onClose;
}

const toggle = () => container.querySelector<HTMLButtonElement>("[data-tool=memory-toggle]")!;
const cell = (address: number) => container.querySelector<HTMLElement>(`.hex-view td[data-address="${address}"]`)!;

function choosePage(start: number) {
  const select = container.querySelector<HTMLSelectElement>("[data-tool=memory-page]")!;
  act(() => {
    select.value = String(start);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ToolsPanel's memory viewer", () => {
  it("highlights a write the access hooks report, with the value written", async () => {
    const { core, host } = syntheticHost();
    renderPanel(host);
    act(() => toggle().click());
    choosePage(0x6000);
    expect(cell(0x6000).className).not.toContain("written");
    core.frame();
    await nextFrames();
    expect(cell(0x6000).textContent).toBe("42");
    expect(cell(0x6000).className).toContain("written");
    // Not written: no highlight.
    expect(cell(0x6001).className).toBe("byte");
  });

  it("sets the hooks only while the viewer is open, and removes them when the panel closes", async () => {
    const { host, hookCalls, wrapped } = syntheticHost();
    renderPanel(host);
    expect(hookCalls).toEqual([]);
    expect(wrapped()).toEqual([]);
    act(() => toggle().click());
    expect(hookCalls).toHaveLength(1);
    expect(hookCalls[0]?.onAccess).toBeTypeOf("function");
    expect(wrapped()).toEqual(WRAPPED);
    act(() => toggle().click());
    expect(hookCalls).toEqual([hookCalls[0], null]);
    expect(wrapped()).toEqual([]);

    act(() => toggle().click());
    expect(wrapped()).toEqual(WRAPPED);
    // Closing the panel unmounts it.
    act(() => root.render(<></>));
    expect(hookCalls.at(-1)).toBeNull();
    expect(wrapped()).toEqual([]);
  });
});

describe("ToolsPanel", () => {
  it("starts with focus on the search's comparison, and closes on Esc without the page seeing the key", () => {
    const { host } = syntheticHost();
    const pageKeys = vi.fn();
    document.addEventListener("keydown", pageKeys);
    const onClose = renderPanel(host);
    expect((document.activeElement as HTMLInputElement).dataset.tool).toBe("comparison-equal");
    act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pageKeys).not.toHaveBeenCalled();
    document.removeEventListener("keydown", pageKeys);
  });

  it("filters with a typed value, adds a result to the watch list, and keeps the list for the ROM", async () => {
    const { core, host } = syntheticHost();
    core.frame();
    renderPanel(host);
    const value = container.querySelector<HTMLInputElement>("[data-tool=value]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(value, "$42");
      value.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => container.querySelector<HTMLButtonElement>("[data-tool=filter]")!.click());
    expect(container.querySelector("[data-tool=count]")?.textContent).toBe("1 candidate after 1 step");
    act(() => container.querySelector<HTMLButtonElement>("[aria-label='Watch $6000']")!.click());
    await nextFrames(1);
    expect(container.querySelector("[data-tool=watch-value]")?.textContent).toBe("66");
    expect(JSON.parse(localStorage.getItem(`retrowright.watches.v1.${ROM_SHA256}`)!)).toEqual([{ address: 0x6000, name: "$6000", size: 1, format: "decimal" }]);

    act(() => container.querySelector<HTMLButtonElement>("[data-tool=undo]")!.click());
    expect(container.querySelector("[data-tool=count]")?.textContent).toBe("10240 candidates");
  });

  it("says what to type when the value is not a number the size holds", () => {
    const { host } = syntheticHost();
    renderPanel(host);
    const value = container.querySelector<HTMLInputElement>("[data-tool=value]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(value, "300");
      value.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => container.querySelector<HTMLButtonElement>("[data-tool=filter]")!.click());
    expect(container.querySelector("[role=alert]")?.textContent).toContain("from 0 to 255");
    expect(container.querySelector("[data-tool=count]")?.textContent).toBe("10240 candidates");
  });
});
