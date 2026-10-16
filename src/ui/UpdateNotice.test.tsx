// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateNotice } from "./UpdateNotice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What the service worker registration reports, set per test. */
const registration = vi.hoisted(() => ({
  needRefresh: false,
  offlineReady: false,
  calls: [] as string[],
}));

vi.mock("virtual:pwa-register/react", async () => {
  const { useState } = await import("react");
  return {
    useRegisterSW: () => ({
      needRefresh: useState(registration.needRefresh),
      offlineReady: useState(registration.offlineReady),
      updateServiceWorker: async (reload?: boolean) => void registration.calls.push(`update(${reload})`),
    }),
  };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  registration.needRefresh = false;
  registration.offlineReady = false;
  registration.calls = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Partial<Parameters<typeof UpdateNotice>[0]> = {}) {
  const onOfflineReady = vi.fn();
  const beforeReload = vi.fn(async () => void registration.calls.push("beforeReload"));
  act(() => root.render(<UpdateNotice onOfflineReady={onOfflineReady} onError={() => {}} beforeReload={beforeReload} {...props} />));
  return { onOfflineReady, beforeReload };
}

describe("UpdateNotice", () => {
  it("shows nothing until a new version waits", () => {
    render();
    expect(container.textContent).toBe("");
  });

  it("says a new version is ready, and Reload keeps the game before the new version takes over", async () => {
    registration.needRefresh = true;
    render();
    expect(container.textContent).toContain("A new version is ready: reload to use it.");
    await act(async () => container.querySelector<HTMLElement>(".update-reload")!.click());
    expect(registration.calls).toEqual(["beforeReload", "update(true)"]);
  });

  it("goes away when dismissed, without reloading", () => {
    registration.needRefresh = true;
    render();
    act(() => container.querySelector<HTMLElement>("[aria-label=Dismiss]")!.click());
    expect(container.textContent).toBe("");
    expect(registration.calls).toEqual([]);
  });

  it("says once that the page opens offline", () => {
    registration.offlineReady = true;
    const { onOfflineReady } = render();
    expect(onOfflineReady).toHaveBeenCalledOnce();
  });
});
