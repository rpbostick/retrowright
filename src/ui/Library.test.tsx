// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameRecord, GameSaves, StateRecord, StateSlot } from "../storage/gameStore";
import type { Persistence } from "../storage/persistence";
import { Library, type LibraryHandle } from "./Library";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function game(id: string, overrides: Partial<GameRecord> = {}): GameRecord {
  return { id, fileName: `${id}.nes`, size: 40976, addedAt: 1000, lastPlayedAt: null, title: null, favourite: false, thumbnail: null, resumeAt: null, patchedFrom: null, ...overrides };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const NO_SAVES: GameSaves = { pictured: null, resumeAt: null, slots: [] };

function slotRecord(slot: StateSlot, savedAt: number): StateRecord {
  return { romId: "x", slot, state: { core: "test", data: {} }, savedAt, thumbnail: `data:image/png;base64,S${slot}` };
}

/** Renders the library; `saves` gives each game's saves as the store would read them (none by default). */
function renderLibrary(games: GameRecord[], padInUse = false, saves: Record<string, GameSaves> = {}, persistence: Persistence = "not-asked") {
  const loadSaves = vi.fn(async (id: string) => saves[id] ?? NO_SAVES);
  const calls = {
    onAddFiles: vi.fn(),
    onPlay: vi.fn(),
    onRename: vi.fn(),
    onFavourite: vi.fn(),
    onRemove: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    onApplyPatch: vi.fn(),
    readStorageUse: vi.fn(async () => ({ usage: 3_400_000, quota: 2_000_000_000 })),
  };
  const ref = createRef<LibraryHandle>();
  const render = (next: GameRecord[]) =>
    act(() =>
      root.render(<Library ref={ref} games={next} persistent persistence={persistence} storage={window.localStorage} padInUse={padInUse} loadSaves={loadSaves} {...calls} />),
    );
  render(games);
  return { calls, ref, render, loadSaves };
}

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const titles = () => [...container.querySelectorAll(".card-title")].map((node) => node.textContent);
const click = (element: HTMLElement | null) => act(() => element!.click());
/** Clicks something whose handler first reads the game's saves. */
const clickAndRead = (element: HTMLElement | null) => act(async () => element!.click());
/** Lets the Continue card read its game's saves. */
const settle = () => act(async () => {});
const focused = () => document.activeElement as HTMLElement;

function key(name: string) {
  act(() => {
    focused().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  });
}

describe("Library", () => {
  it("says what to do while it is empty, with a drop zone, an Add button and where games come from", () => {
    renderLibrary([]);
    expect($(".empty-lead")?.textContent).toBe("Load a .nes file from your computer. It stays in this browser and is never uploaded.");
    expect(container.querySelectorAll(".add-games")).toHaveLength(1);
    expect($(".drop-zone .add-games")?.textContent).toBe("Add games…");
    expect($(".rom-help summary")?.textContent).toBe("Where do games come from?");
    expect($<HTMLAnchorElement>(".rom-help a")?.href).toBe("https://www.nesdev.org/wiki/Category:Homebrew_games");
    expect($("[data-card]")).toBeNull();
  });

  it("warns gently, with a way to export, only when the browser has not agreed to keep the saves", () => {
    renderLibrary([game("a")], false, {}, "granted");
    expect($(".storage-warning")).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    renderLibrary([game("a")], false, {}, "denied");
    expect($(".storage-warning")?.textContent).toContain("could clear them");
    click($(".storage-warning button"));
    expect($("[role=dialog] .persistence")?.getAttribute("data-persistence")).toBe("denied");
  });

  it("shows how much room the page uses, and exports everything without ROMs unless asked", async () => {
    const { calls } = renderLibrary([]);
    await clickAndRead($(".open-saves"));
    expect($(".storage-meter")?.textContent).toBe("3.4 MB used of about 2.0 GB this browser allows the page");
    click($("[data-item=export]"));
    expect(calls.onExport).toHaveBeenLastCalledWith({ gameId: null, includeRoms: false });
    click($("[data-item=include-roms]"));
    click($("[data-item=export]"));
    expect(calls.onExport).toHaveBeenLastCalledWith({ gameId: null, includeRoms: true });
  });

  it("exports one game's saves from its card's menu", () => {
    const { calls } = renderLibrary([game("a"), game("b")]);
    click(container.querySelectorAll<HTMLElement>(".card-more")[1]);
    click($("[data-item=export-game]"));
    click($("[data-item=export]"));
    expect(calls.onExport).toHaveBeenCalledWith({ gameId: "b", includeRoms: false });
  });

  it("applies a patch picked from a card's menu, and names where a patched game came from", () => {
    const { calls } = renderLibrary([game("a"), game("b", { patchedFrom: { romId: "a", romTitle: "Game A", patchName: "red.bps" } })]);
    click(container.querySelectorAll<HTMLElement>(".card-more")[0]);
    expect($(".patched-from")).toBeNull();
    const button = $("[data-item=apply-patch]")!;
    expect(button.textContent).toBe("Apply patch…");
    expect(button.hasAttribute("data-needs-gesture")).toBe(true);
    const input = $<HTMLInputElement>("#patch-input")!;
    expect(input.accept).toBe(".ips,.bps");
    const file = new File([new Uint8Array([0x42, 0x50, 0x53, 0x31])], "red.bps");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(calls.onApplyPatch).toHaveBeenCalledWith("a", file);
    expect($("[role=dialog]")).toBeNull();
    click(container.querySelectorAll<HTMLElement>(".card-more")[1]);
    expect($(".patched-from")?.textContent).toBe("Made from Game A with the patch red.bps.");
  });

  it("says a gamepad cannot pick a patch file", () => {
    renderLibrary([game("a")], true);
    click($(".card-more"));
    expect($("#" + $("[data-item=apply-patch]")!.getAttribute("aria-describedby"))?.textContent).toBe("Use the mouse or keyboard for this");
  });

  it("shows each game as a card: the player's own picture or a placeholder naming the system, the tidied title and when it was played", () => {
    renderLibrary([
      game("a", { fileName: "Final_Fantasy (USA) (Rev 1).nes", thumbnail: "data:image/webp;base64,OWN", lastPlayedAt: Date.UTC(2026, 9, 10, 12) }),
      game("b"),
    ]);
    const [first, second] = [...container.querySelectorAll<HTMLElement>("[data-card]")];
    expect(first.querySelector("img")?.getAttribute("src")).toBe("data:image/webp;base64,OWN");
    expect(first.querySelector(".card-title")?.textContent).toBe("Final Fantasy");
    expect(first.querySelector(".card-tags")?.textContent).toBe("USA · Rev 1");
    expect(first.querySelector(".card-played")?.textContent).toMatch(/^Played .*2026/);
    expect(second.querySelector("img")).toBeNull();
    expect(second.querySelector(".card-placeholder")?.textContent).toBe("NES");
    expect(second.querySelector(".card-played")?.textContent).toBe("Not played yet");
    expect(first.querySelector(".card-open")?.getAttribute("aria-label")).toMatch(/^Final Fantasy, USA, Rev 1\. Played/);
  });

  it("gives the last game played a large Continue card that continues it in one click", async () => {
    const resumed: GameSaves = { pictured: { kind: "resume", savedAt: 9 }, resumeAt: 9, slots: [] };
    const { calls, render } = renderLibrary([game("old", { lastPlayedAt: 5 }), game("new", { lastPlayedAt: 9, resumeAt: 9, title: "Newest" }), game("never")], false, { new: resumed });
    await settle();
    expect($(".continue-card h3")?.textContent).toBe("Newest");
    expect($(".continue-button")?.textContent).toBe("Continue");
    await clickAndRead($(".continue-button"));
    expect(calls.onPlay).toHaveBeenCalledWith("new", "resume");
    render([game("other", { lastPlayedAt: 10 })]);
    await settle();
    expect($(".continue-button")?.textContent).toBe("Play");
    await clickAndRead($(".continue-button"));
    expect(calls.onPlay).toHaveBeenLastCalledWith("other", "power-on");
  });

  it("the Continue card loads the slot its picture shows when that slot is the newest save", async () => {
    const saves: GameSaves = { pictured: { kind: "slot", slot: 2, savedAt: 30 }, resumeAt: 10, slots: [slotRecord(2, 30)] };
    const { calls } = renderLibrary([game("ff2", { lastPlayedAt: 40, resumeAt: 10, thumbnail: "data:image/png;base64,S2" })], false, { ff2: saves });
    await settle();
    expect($(".continue-button")?.textContent).toBe("Load slot 2");
    await clickAndRead($(".continue-button"));
    expect(calls.onPlay).toHaveBeenCalledWith("ff2", { slot: 2 });
  });

  it("a card whose game has only a slot opens a choice whose first, focused item loads that slot", async () => {
    const saves: GameSaves = { pictured: { kind: "slot", slot: 3, savedAt: 30 }, resumeAt: null, slots: [slotRecord(3, 30)] };
    const { calls } = renderLibrary([game("ff2", { thumbnail: "data:image/png;base64,S3" })], false, { ff2: saves });
    await clickAndRead($(".card-open"));
    expect($("[role=dialog]")).not.toBeNull();
    expect(focused().dataset.item).toBe("load-slot");
    expect(focused().textContent).toMatch(/^Load slot 3saved /);
    expect($("[data-item=continue]")).toBeNull();
    click(focused());
    expect(calls.onPlay).toHaveBeenCalledWith("ff2", { slot: 3 });
  });

  it("a card whose newest save is the resume state focuses Continue, and offers the slots and power-on", async () => {
    const saves: GameSaves = { pictured: { kind: "resume", savedAt: 50 }, resumeAt: 50, slots: [slotRecord(1, 20), slotRecord(5, 40)] };
    const { calls } = renderLibrary([game("saved", { resumeAt: 50 })], false, { saved: saves });
    const card = $(".card-open")!;
    act(() => card.focus()); // as Enter on a focused card does
    await clickAndRead(card);
    expect(focused().dataset.item).toBe("continue");
    expect([...container.querySelectorAll<HTMLElement>("[role=dialog] [data-item]")].map((item) => item.dataset.item)).toEqual(["continue", "states", "power-on", "cancel"]);
    click(focused());
    expect(calls.onPlay).toHaveBeenLastCalledWith("saved", "resume");
    click($("[data-item=states]"));
    expect($(".slot-grid")).not.toBeNull();
    click($("[data-slot='5']"));
    expect(calls.onPlay).toHaveBeenLastCalledWith("saved", { slot: 5 });
    click($("[data-slot='4']")); // empty: nothing to load
    expect(calls.onPlay).toHaveBeenCalledTimes(2);
    click($("[data-item=back]"));
    key("ArrowDown");
    key("ArrowDown");
    expect(focused().dataset.item).toBe("power-on");
    click(focused());
    expect(calls.onPlay).toHaveBeenLastCalledWith("saved", "power-on");
    key("Escape");
    expect($("[role=dialog]")).toBeNull();
    expect(focused()).toBe(card);
  });

  it("offers Continue beside a pictured slot when the resume state has no picture of its own", async () => {
    const saves: GameSaves = { pictured: { kind: "slot", slot: 1, savedAt: 20 }, resumeAt: 50, slots: [slotRecord(1, 20)] };
    renderLibrary([game("g", { resumeAt: 50 })], false, { g: saves });
    await clickAndRead($(".card-open"));
    expect(focused().dataset.item).toBe("load-slot");
    expect([...container.querySelectorAll<HTMLElement>("[role=dialog] [data-item]")].map((item) => item.dataset.item)).toEqual(["load-slot", "continue", "states", "power-on", "cancel"]);
  });

  it("starts a card's game at once when it has no saves", async () => {
    const { calls } = renderLibrary([game("fresh")]);
    await clickAndRead($(".card-open"));
    expect($("[role=dialog]")).toBeNull();
    expect(calls.onPlay).toHaveBeenCalledWith("fresh", "power-on");
  });

  it("stars a game, and the Favourites filter shows only starred games", () => {
    const { calls, render } = renderLibrary([game("a"), game("b", { favourite: true, addedAt: 2 })]);
    click($("[data-card=a] .card-star"));
    expect(calls.onFavourite).toHaveBeenCalledWith("a", true);
    expect($("[data-card=b] .card-star")?.getAttribute("aria-pressed")).toBe("true");
    click($(".filter-favourites"));
    expect(titles()).toEqual(["b"]);
    render([game("a"), game("b")]);
    expect(container.textContent).toContain("No favourites yet");
  });

  it("shows search once there are more than a dozen games, matching titles and tags", () => {
    const twelve = Array.from({ length: 12 }, (_, index) => game(`game${index}`, { addedAt: index }));
    const { render } = renderLibrary(twelve);
    expect($("input[type=search]")).toBeNull();
    render([...twelve, game("zelda", { fileName: "Zelda (Europe).nes", addedAt: 99 })]);
    const search = $<HTMLInputElement>("input[type=search]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "europe");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(titles()).toEqual(["Zelda"]);
  });

  it("sorts by last played or by title", () => {
    renderLibrary([game("b", { lastPlayedAt: 9 }), game("c", { lastPlayedAt: 5 }), game("a", { title: "Alpha" })]);
    expect(titles()).toEqual(["b", "c", "Alpha"]);
    const sort = $<HTMLSelectElement>(".library-sort select")!;
    act(() => {
      sort.value = "title";
      sort.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(titles()).toEqual(["Alpha", "b", "c"]);
  });

  it("switches to a list view", () => {
    renderLibrary([game("a")]);
    click($(".view-toggle"));
    expect($(".game-grid")?.classList.contains("list")).toBe(true);
    expect($(".view-toggle")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("remembers the view and the sort in this browser, as a reload finds them", () => {
    renderLibrary([game("b", { lastPlayedAt: 9 }), game("a", { title: "Alpha" })]);
    click($(".view-toggle"));
    const sort = $<HTMLSelectElement>(".library-sort select")!;
    act(() => {
      sort.value = "title";
      sort.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => root.unmount());
    root = createRoot(container);
    renderLibrary([game("b", { lastPlayedAt: 9 }), game("a", { title: "Alpha" })]);
    expect($(".game-grid")?.classList.contains("list")).toBe(true);
    expect($<HTMLSelectElement>(".library-sort select")!.value).toBe("title");
    expect(titles()).toEqual(["Alpha", "b"]);
  });

  it("renames a game from its menu", () => {
    const { calls } = renderLibrary([game("a", { fileName: "a (USA).nes" })]);
    click($(".card-more"));
    const input = focused() as HTMLInputElement;
    expect(input.placeholder).toBe("a");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "My game");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click($("[data-item=rename]"));
    expect(calls.onRename).toHaveBeenCalledWith("a", "My game");
    expect($("[role=dialog]")).toBeNull();
  });

  it("removes a game, and deletes its saves only after a second confirmation", () => {
    const { calls } = renderLibrary([game("a")]);
    click($(".card-more"));
    click($("[data-item=remove]"));
    expect(focused().dataset.item).toBe("cancel");
    click($("[data-item=remove-game]"));
    expect(calls.onRemove).toHaveBeenCalledWith("a", false);

    click($("[data-item=cancel]"));
    click($(".card-more"));
    click($("[data-item=remove]"));
    click($("[data-item=remove-saves]"));
    expect($("[role=dialog]")?.textContent).toContain("cannot be undone");
    expect(calls.onRemove).toHaveBeenCalledTimes(1);
    click($("[data-item=delete-saves]"));
    expect(calls.onRemove).toHaveBeenLastCalledWith("a", true);
  });

  it("moves through the grid with the arrow keys: left and right along the buttons, up and down by a row", () => {
    renderLibrary(Array.from({ length: 5 }, (_, index) => game(`g${index}`, { addedAt: 10 - index })));
    // Three cards a row, as a laid-out page would place them.
    const cards = [...container.querySelectorAll<HTMLElement>("[data-card]")];
    cards.forEach((card, index) => (card.getBoundingClientRect = () => ({ top: Math.floor(index / 3) * 100 }) as DOMRect));
    act(() => cards[0].querySelector<HTMLElement>(".card-open")!.focus());
    key("ArrowDown");
    expect(focused()).toBe(cards[3].querySelector(".card-open"));
    key("ArrowRight");
    expect(focused()).toBe(cards[3].querySelector(".card-star"));
    key("ArrowUp");
    expect(focused()).toBe(cards[0].querySelector(".card-star"));
    key("ArrowUp"); // off the top row, to the control before the grid
    expect(focused().className).toBe("view-toggle");
  });

  it("is driven by a gamepad, which cannot open the file picker: Add shows a hint instead", () => {
    const pickFile = vi.spyOn(HTMLInputElement.prototype, "click");
    const { ref, calls } = renderLibrary([game("a")], true);
    expect(document.getElementById($(".add-games")!.getAttribute("aria-describedby")!)?.textContent).toBe("Use the mouse or keyboard for this");
    act(() => $(".add-games")!.focus());
    act(() => ref.current!.command("choose"));
    expect(pickFile).not.toHaveBeenCalled();
    pickFile.mockRestore();
    act(() => ref.current!.command("down"));
    expect(focused().className).toBe("open-saves");
    act(() => ref.current!.command("down"));
    act(() => ref.current!.command("choose"));
    expect(calls.onPlay).not.toHaveBeenCalled(); // focus is on the Favourites filter, which toggles
    expect($(".filter-favourites")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("adds files dropped anywhere on the page", () => {
    const { calls } = renderLibrary([]);
    const files = [new File([new Uint8Array(4)], "one.nes"), new File([new Uint8Array(4)], "two.nes")];
    const dataTransfer = { types: ["Files"], files };
    const drag = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      act(() => document.body.dispatchEvent(event));
      return event;
    };
    drag("dragenter");
    expect($(".drop-overlay")).not.toBeNull();
    expect(drag("dragover").defaultPrevented).toBe(true);
    drag("drop");
    expect(calls.onAddFiles).toHaveBeenCalledWith(files);
    expect($(".drop-overlay")).toBeNull();
  });
});
