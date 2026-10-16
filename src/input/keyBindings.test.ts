import { describe, expect, it } from "vitest";
import { Button } from "../core/types";
import {
  ACTION_LABELS,
  ACTIONS,
  actionForCode,
  addCombo,
  bindTarget,
  comboLabel,
  DEFAULT_BINDINGS,
  Hotkey,
  keyLabel,
  loadBindings,
  mouseCode,
  padButtonOf,
  padButtonsForCode,
  player2Action,
  PLAYER2_ACTIONS,
  rebind,
  rebindCombo,
  removeCombo,
  saveBindings,
  SUGGESTED_COMBOS,
  toggleComboButton,
  unbind,
  unbindCombo,
} from "./keyBindings";

class FakeStorage {
  private readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.has(key) ? this.items.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const asStorage = (fake: FakeStorage) => fake as unknown as Storage;

/** The defaults as stored before combos and player 2's keys existed. */
function beforeCombos(): Record<string, string[]> {
  const old: Record<string, unknown> = { ...DEFAULT_BINDINGS };
  for (const action of PLAYER2_ACTIONS) delete old[action];
  delete old.combos;
  return old as Record<string, string[]>;
}

describe("key bindings", () => {
  it("has the documented defaults", () => {
    expect(actionForCode(DEFAULT_BINDINGS, "ArrowUp")).toBe(Button.Up);
    expect(actionForCode(DEFAULT_BINDINGS, "KeyZ")).toBe(Button.B);
    expect(actionForCode(DEFAULT_BINDINGS, "KeyX")).toBe(Button.A);
    expect(actionForCode(DEFAULT_BINDINGS, "Enter")).toBe(Button.Start);
    expect(actionForCode(DEFAULT_BINDINGS, "NumpadEnter")).toBe(Button.Start);
    expect(actionForCode(DEFAULT_BINDINGS, "ShiftLeft")).toBe(Button.Select);
    expect(actionForCode(DEFAULT_BINDINGS, "ShiftRight")).toBe(Button.Select);
    expect(actionForCode(DEFAULT_BINDINGS, "F5")).toBe(Hotkey.SaveState);
    expect(actionForCode(DEFAULT_BINDINGS, "F7")).toBe(Hotkey.LoadState);
    expect(actionForCode(DEFAULT_BINDINGS, "KeyQ")).toBeUndefined();
  });

  it("gives bindings saved before Record and Mark existed their default keys, unless taken", () => {
    const storage = new FakeStorage();
    const old: Record<string, string[]> = { ...beforeCombos(), [Hotkey.SaveState]: ["F8"] };
    delete old[Hotkey.Record];
    delete old[Hotkey.Mark];
    storage.setItem("retrowright.keyBindings.v1", JSON.stringify(old));
    const loaded = loadBindings(asStorage(storage));
    expect(loaded.problem).toBeUndefined();
    expect(loaded.bindings[Hotkey.Record]).toEqual(["F9"]);
    expect(loaded.bindings[Hotkey.Mark]).toEqual([]);
    expect(loaded.bindings[Hotkey.SaveState]).toEqual(["F8"]);
  });

  it("gives bindings saved before Fast-forward and Screenshot existed Tab and F2, unless taken", () => {
    const storage = new FakeStorage();
    const old: Record<string, string[]> = { ...beforeCombos(), [Button.Select]: ["Tab"] };
    delete old[Hotkey.FastForward];
    delete old[Hotkey.Screenshot];
    storage.setItem("retrowright.keyBindings.v1", JSON.stringify(old));
    const loaded = loadBindings(asStorage(storage));
    expect(loaded.problem).toBeUndefined();
    expect(loaded.bindings[Hotkey.FastForward]).toEqual([]);
    expect(loaded.bindings[Hotkey.Screenshot]).toEqual(["F2"]);
    expect(loaded.bindings[Button.Select]).toEqual(["Tab"]);
    expect(actionForCode(DEFAULT_BINDINGS, "Tab")).toBe(Hotkey.FastForward);
  });

  it("gives bindings saved before the tools panel existed F4, unless taken", () => {
    const storage = new FakeStorage();
    const old: Record<string, string[]> = beforeCombos();
    delete old[Hotkey.Tools];
    storage.setItem("retrowright.keyBindings.v1", JSON.stringify(old));
    expect(loadBindings(asStorage(storage)).bindings[Hotkey.Tools]).toEqual(["F4"]);
    storage.setItem("retrowright.keyBindings.v1", JSON.stringify({ ...old, [Hotkey.SaveState]: ["F4"] }));
    const taken = loadBindings(asStorage(storage));
    expect(taken.problem).toBeUndefined();
    expect(taken.bindings[Hotkey.Tools]).toEqual([]);
  });

  it("gives bindings saved before the instant replay existed R, unless taken", () => {
    const storage = new FakeStorage();
    const old: Record<string, unknown> = { version: 3, ...DEFAULT_BINDINGS };
    delete old[Hotkey.SaveReplay];
    storage.setItem("retrowright.keyBindings.v1", JSON.stringify(old));
    const loaded = loadBindings(asStorage(storage));
    expect(loaded.problem).toBeUndefined();
    expect(loaded.bindings[Hotkey.SaveReplay]).toEqual(["KeyR"]);
    storage.setItem("retrowright.keyBindings.v1", JSON.stringify({ ...old, [Hotkey.Mark]: ["KeyR"] }));
    expect(loadBindings(asStorage(storage)).bindings[Hotkey.SaveReplay]).toEqual([]);
  });

  it("gives bindings saved before the developer console existed the backtick, unless taken", () => {
    const storage = new FakeStorage();
    const old: Record<string, unknown> = { version: 3, ...DEFAULT_BINDINGS };
    delete old[Hotkey.Console];
    storage.setItem("retrowright.keyBindings.v1", JSON.stringify(old));
    const loaded = loadBindings(asStorage(storage));
    expect(loaded.problem).toBeUndefined();
    expect(loaded.bindings[Hotkey.Console]).toEqual(["Backquote"]);
    expect(keyLabel("Backquote")).toBe("`");
    storage.setItem("retrowright.keyBindings.v1", JSON.stringify({ ...old, [Hotkey.Mark]: ["Backquote"] }));
    expect(loadBindings(asStorage(storage)).bindings[Hotkey.Console]).toEqual([]);
  });

  it("gives bindings saved before the Tune panel existed F3, unless taken", () => {
    const storage = new FakeStorage();
    const old: Record<string, unknown> = { version: 3, ...DEFAULT_BINDINGS };
    delete old[Hotkey.Tune];
    storage.setItem("retrowright.keyBindings.v1", JSON.stringify(old));
    const loaded = loadBindings(asStorage(storage));
    expect(loaded.problem).toBeUndefined();
    expect(loaded.bindings[Hotkey.Tune]).toEqual(["F3"]);
    storage.setItem("retrowright.keyBindings.v1", JSON.stringify({ ...old, [Hotkey.Mark]: ["F3"] }));
    expect(loadBindings(asStorage(storage)).bindings[Hotkey.Tune]).toEqual([]);
  });

  it("rebinds a key and takes it away from the action that had it", () => {
    const next = rebind(DEFAULT_BINDINGS, Button.A, "KeyZ");
    expect(next[Button.A]).toEqual(["KeyZ", "Mouse0"]);
    expect(next[Button.B]).toEqual(["Mouse2"]);
    expect(actionForCode(next, "KeyX")).toBeUndefined();
    expect(DEFAULT_BINDINGS[Button.B]).toEqual(["KeyZ", "Mouse2"]);
  });

  it("has a second set: WASD beside the arrows, the left mouse button for A and the right for B", () => {
    expect(actionForCode(DEFAULT_BINDINGS, "KeyW")).toBe(Button.Up);
    expect(actionForCode(DEFAULT_BINDINGS, "KeyA")).toBe(Button.Left);
    expect(actionForCode(DEFAULT_BINDINGS, "KeyS")).toBe(Button.Down);
    expect(actionForCode(DEFAULT_BINDINGS, "KeyD")).toBe(Button.Right);
    expect(actionForCode(DEFAULT_BINDINGS, mouseCode(0))).toBe(Button.A);
    expect(actionForCode(DEFAULT_BINDINGS, mouseCode(2))).toBe(Button.B);
    // No code is bound twice by default, so nothing else loses W, A, S or D to the D-pad.
    const codes = ACTIONS.flatMap((action) => DEFAULT_BINDINGS[action]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("rebinds the secondary binding and keeps the primary", () => {
    const next = rebind(DEFAULT_BINDINGS, Button.Up, "KeyI", 1);
    expect(next[Button.Up]).toEqual(["ArrowUp", "KeyI"]);
    const mouse = rebind(DEFAULT_BINDINGS, Button.Select, mouseCode(1), 1);
    expect(mouse[Button.Select]).toEqual(["ShiftLeft", "Mouse1"]);
    // A mouse button moved to B's secondary leaves A.
    const moved = rebind(DEFAULT_BINDINGS, Button.B, mouseCode(0), 1);
    expect(moved[Button.B]).toEqual(["KeyZ", "Mouse0"]);
    expect(moved[Button.A]).toEqual(["KeyX"]);
    expect(rebind(DEFAULT_BINDINGS, Hotkey.Tools, "KeyT", 1)[Hotkey.Tools]).toEqual(["F4", "KeyT"]);
    // A secondary given to an action with nothing bound becomes its primary.
    expect(rebind({ ...DEFAULT_BINDINGS, [Hotkey.Tools]: [] }, Hotkey.Tools, "KeyT", 1)[Hotkey.Tools]).toEqual(["KeyT"]);
    // The primary bound to the secondary's code keeps it once.
    expect(rebind(DEFAULT_BINDINGS, Button.Up, "KeyW", 0)[Button.Up]).toEqual(["KeyW"]);
  });

  it("gives bindings saved before the second set existed WASD and the mouse where free, and keeps a key the player bound elsewhere", () => {
    const storage = new FakeStorage();
    const oldDefaults: Record<string, string[]> = {
      ...beforeCombos(),
      [Button.Up]: ["ArrowUp"],
      [Button.Down]: ["ArrowDown"],
      [Button.Left]: ["ArrowLeft"],
      [Button.Right]: ["ArrowRight"],
      [Button.B]: ["KeyZ"],
      [Button.A]: ["KeyX"],
    };
    storage.setItem("retrowright.keyBindings.v1", JSON.stringify(oldDefaults));
    expect(loadBindings(asStorage(storage))).toEqual({ bindings: DEFAULT_BINDINGS });

    // W was the player's Start, and D their Up: both stay theirs, and Up and Right go without.
    const own = { ...oldDefaults, [Button.Start]: ["KeyW"], [Button.Up]: ["KeyD"] };
    storage.setItem("retrowright.keyBindings.v1", JSON.stringify(own));
    const loaded = loadBindings(asStorage(storage));
    expect(loaded.problem).toBeUndefined();
    expect(loaded.bindings[Button.Start]).toEqual(["KeyW"]);
    expect(loaded.bindings[Button.Up]).toEqual(["KeyD"]);
    expect(loaded.bindings[Button.Right]).toEqual(["ArrowRight"]);
    expect(loaded.bindings[Button.Left]).toEqual(["ArrowLeft", "KeyA"]);
    expect(loaded.bindings[Button.A]).toEqual(["KeyX", "Mouse0"]);
  });

  it("does not give WASD back to bindings saved with the second set", () => {
    const storage = new FakeStorage();
    const withoutW = rebind(DEFAULT_BINDINGS, Button.Up, "KeyI", 1);
    saveBindings(asStorage(storage), withoutW);
    expect(JSON.parse(storage.getItem("retrowright.keyBindings.v1")!).version).toBe(3);
    expect(loadBindings(asStorage(storage)).bindings[Button.Up]).toEqual(["ArrowUp", "KeyI"]);
  });

  it("refuses bindings saved by a newer format, with the defaults and a message", () => {
    const storage = new FakeStorage();
    storage.setItem("retrowright.keyBindings.v1", JSON.stringify({ ...DEFAULT_BINDINGS, version: 4 }));
    const loaded = loadBindings(asStorage(storage));
    expect(loaded.bindings).toEqual(DEFAULT_BINDINGS);
    expect(loaded.problem).toContain("could not be read");
  });

  it("labels keys for the screen", () => {
    expect(keyLabel("ArrowLeft")).toBe("←");
    expect(keyLabel("KeyZ")).toBe("Z");
    expect(keyLabel("Digit2")).toBe("2");
    expect(keyLabel("ShiftRight")).toBe("Right Shift");
    expect(keyLabel("Enter")).toBe("Enter");
    expect(keyLabel("Mouse0")).toBe("Left click");
    expect(keyLabel("Mouse2")).toBe("Right click");
    expect(keyLabel("Mouse4")).toBe("Mouse button 5");
  });

  it("saves and loads bindings", () => {
    const storage = new FakeStorage();
    const changed = rebind(DEFAULT_BINDINGS, Button.Start, "Space");
    saveBindings(asStorage(storage), changed);
    expect(loadBindings(asStorage(storage))).toEqual({ bindings: changed });
  });

  it("uses the defaults when nothing is saved", () => {
    expect(loadBindings(asStorage(new FakeStorage()))).toEqual({ bindings: DEFAULT_BINDINGS });
  });

  it("uses the defaults and says so when the saved bindings are unreadable", () => {
    const storage = new FakeStorage();
    storage.setItem("retrowright.keyBindings.v1", "{not json");
    const loaded = loadBindings(asStorage(storage));
    expect(loaded.bindings).toEqual(DEFAULT_BINDINGS);
    expect(loaded.problem).toContain("could not be read");

    storage.setItem("retrowright.keyBindings.v1", JSON.stringify({ A: ["KeyX"] }));
    expect(loadBindings(asStorage(storage)).problem).toContain("could not be read");
  });

  it("loads bindings saved before combos and player 2's keys unchanged, with neither", () => {
    const storage = new FakeStorage();
    // Version 2 as saved: Start moved to Space, Tools unbound.
    const saved =
      '{"version":2,"Up":["ArrowUp","KeyW"],"Down":["ArrowDown","KeyS"],"Left":["ArrowLeft","KeyA"],"Right":["ArrowRight","KeyD"],' +
      '"B":["KeyZ","Mouse2"],"A":["KeyX","Mouse0"],"Select":["ShiftLeft","ShiftRight"],"Start":["Space"],"SaveState":["F5"],"LoadState":["F7"],' +
      '"Slot1":["Digit1"],"Slot2":["Digit2"],"Slot3":["Digit3"],"Record":["F9"],"Mark":["F8"],"FastForward":["Tab"],"Screenshot":["F2"],"Tools":[]}';
    storage.setItem("retrowright.keyBindings.v1", saved);
    const loaded = loadBindings(asStorage(storage));
    expect(loaded.problem).toBeUndefined();
    expect(loaded.bindings).toEqual({ ...DEFAULT_BINDINGS, [Button.Start]: ["Space"], [Hotkey.Tools]: [] });
    expect(loaded.bindings.combos).toEqual([]);
    for (const action of PLAYER2_ACTIONS) expect(loaded.bindings[action]).toEqual([]);
  });

  it("saves and loads combos and player 2's keys", () => {
    const storage = new FakeStorage();
    const changed = addCombo(rebind(DEFAULT_BINDINGS, player2Action(Button.B), "KeyM"), "KeyC", [Button.Down, Button.B]);
    saveBindings(asStorage(storage), changed);
    const loaded = loadBindings(asStorage(storage));
    expect(loaded).toEqual({ bindings: changed });
    expect(loaded.bindings.combos).toEqual([{ code: "KeyC", buttons: [Button.Down, Button.B] }]);
    expect(loaded.bindings[player2Action(Button.B)]).toEqual(["KeyM"]);
  });

  it("refuses saved combos that are not a list of a code and pad buttons", () => {
    const storage = new FakeStorage();
    for (const combos of [undefined, "KeyC", [{ code: "KeyC", buttons: ["Jump"] }], [{ buttons: ["B"] }]]) {
      storage.setItem("retrowright.keyBindings.v1", JSON.stringify({ ...DEFAULT_BINDINGS, version: 3, combos }));
      const loaded = loadBindings(asStorage(storage));
      expect(loaded.bindings).toEqual(DEFAULT_BINDINGS);
      expect(loaded.problem).toContain("could not be read");
    }
  });

  it("finds the pad buttons a code holds: its own button, player 2's, or a combo's", () => {
    const bindings = addCombo(rebind(DEFAULT_BINDINGS, player2Action(Button.A), "KeyN"), "KeyC", [Button.Down, Button.B]);
    expect(padButtonsForCode(bindings, "KeyS")).toEqual([{ player: 1, button: Button.Down }]);
    expect(padButtonsForCode(bindings, "KeyN")).toEqual([{ player: 2, button: Button.A }]);
    expect(padButtonsForCode(bindings, "KeyC")).toEqual([
      { player: 1, button: Button.Down },
      { player: 1, button: Button.B },
    ]);
    expect(padButtonsForCode(bindings, "F5")).toEqual([]);
    expect(padButtonsForCode(bindings, "KeyQ")).toEqual([]);
    expect(padButtonOf(Hotkey.Tools)).toBeUndefined();
  });

  it("gives a code one meaning: a combo takes it from an action, and an action or another combo from a combo", () => {
    const withCombo = addCombo(DEFAULT_BINDINGS, "KeyZ", [Button.Down, Button.B]);
    expect(withCombo[Button.B]).toEqual(["Mouse2"]);
    expect(withCombo.combos).toEqual([{ code: "KeyZ", buttons: [Button.Down, Button.B] }]);
    expect(rebind(withCombo, Button.B, "KeyZ").combos).toEqual([]);
    const two = addCombo(withCombo, "KeyV", [Button.Down, Button.A]);
    const moved = rebindCombo(two, 1, "KeyZ");
    expect(moved.combos).toEqual([{ code: "KeyZ", buttons: [Button.Down, Button.A] }]);
    const rekeyed = rebindCombo(two, 0, "KeyC");
    expect(rekeyed.combos.map((combo) => combo.code)).toEqual(["KeyC", "KeyV"]);
    expect(bindTarget(two, { combo: 1 }, "KeyB").combos[1].code).toBe("KeyB");
    expect(bindTarget(two, { newCombo: [Button.Up, Button.A] }, "KeyQ").combos[2]).toEqual({ code: "KeyQ", buttons: [Button.Up, Button.A] });
    expect(bindTarget(two, { action: Button.Select, slot: 1 }, "KeyV").combos).toHaveLength(1);
  });

  it("changes a combo's buttons in the pad's order, and removes a combo", () => {
    const one = addCombo(DEFAULT_BINDINGS, "KeyC", [Button.B]);
    const withDown = toggleComboButton(one, 0, Button.Down);
    expect(withDown.combos[0].buttons).toEqual([Button.Down, Button.B]);
    expect(comboLabel(withDown.combos[0].buttons)).toBe("Down+B");
    expect(toggleComboButton(withDown, 0, Button.B).combos[0].buttons).toEqual([Button.Down]);
    expect(removeCombo(withDown, 0).combos).toEqual([]);
    expect(() => toggleComboButton(withDown, 3, Button.A)).toThrow("no combo 3");
  });

  it("unbinds one key of player 1, player 2 or a combo, leaving the others, and loads the result back", () => {
    const p2a = player2Action(Button.A);
    const p2b = player2Action(Button.B);
    const start = addCombo(addCombo(rebind(rebind(rebind(DEFAULT_BINDINGS, p2a, "KeyM"), p2a, "KeyN", 1), p2b, "KeyJ"), "KeyC", [Button.Down, Button.B]), "KeyV", [Button.Down, Button.A]);

    // Player 1: Z goes from B, its secondary moves up, and A keeps both keys.
    let changed = unbind(start, Button.B, 0);
    expect(changed[Button.B]).toEqual(["Mouse2"]);
    expect(changed[Button.A]).toEqual(["KeyX", "Mouse0"]);
    expect(unbind(changed, Button.B, 0)[Button.B]).toEqual([]);
    expect(actionForCode(changed, "KeyZ")).toBeUndefined();

    // Player 2: the secondary goes, the primary and the other button stay.
    changed = unbind(changed, p2a, 1);
    expect(changed[p2a]).toEqual(["KeyM"]);
    expect(changed[p2b]).toEqual(["KeyJ"]);

    // A combo keeps its buttons with no key, holds nothing, and can be bound again.
    changed = unbindCombo(changed, 0);
    expect(changed.combos).toEqual([
      { code: null, buttons: [Button.Down, Button.B] },
      { code: "KeyV", buttons: [Button.Down, Button.A] },
    ]);
    expect(padButtonsForCode(changed, "KeyC")).toEqual([]);
    expect(rebindCombo(changed, 0, "KeyC").combos[0]).toEqual({ code: "KeyC", buttons: [Button.Down, Button.B] });

    const storage = new FakeStorage();
    saveBindings(asStorage(storage), changed);
    expect(loadBindings(asStorage(storage))).toEqual({ bindings: changed });

    expect(() => unbind(changed, p2b, 1)).toThrow("no key in slot 1");
    expect(() => unbindCombo(changed, 5)).toThrow("no combo 5");
  });

  it("has no combos and no player 2 keys by default, and suggests Down+B and Down+A", () => {
    expect(DEFAULT_BINDINGS.combos).toEqual([]);
    for (const action of PLAYER2_ACTIONS) expect(DEFAULT_BINDINGS[action]).toEqual([]);
    expect(SUGGESTED_COMBOS.map(comboLabel)).toEqual(["Down+B", "Down+A"]);
    expect(ACTION_LABELS[player2Action(Button.Select)]).toBe("Player 2 Select");
  });

  it("works without localStorage", () => {
    expect(loadBindings(undefined)).toEqual({ bindings: DEFAULT_BINDINGS });
    expect(() => saveBindings(undefined, DEFAULT_BINDINGS)).not.toThrow();
  });
});
