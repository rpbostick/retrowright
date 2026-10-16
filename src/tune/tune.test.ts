import { describe, expect, it } from "vitest";
import { applyPatch } from "../patch/patch";
import { MemoryGameStore, romId } from "../storage/gameStore";
import { buildInes, READ_PAD_PROGRAM } from "../test/syntheticRom";
import { saveTunedVersion } from "../ui/tunedGame";
import { changeSummary, parseTunables, tunedRom, type Tunables } from "./tunables";
import { loadTunedValues, saveTunedValues, storedTunables, storeTunables } from "./tuneStore";

const rom = buildInes({ program: READ_PAD_PROGRAM });
rom[16 + 0x200] = 8;
rom[16 + 0x201] = 5;

function testTunables(sha: string): Tunables {
  return parseTunables(
    {
      format: "retrowright-tunables",
      version: 1,
      romSha256: sha,
      patch: "test.bps",
      values: [
        { key: "push", name: "Push", description: "How hard.", romOffset: 16 + 0x200, cpuAddress: 0x8200, min: 0, max: 32, default: 8 },
        { key: "brake", name: "Brake", description: "How fast.", romOffset: 16 + 0x201, cpuAddress: 0x8201, min: 0, max: 16, default: 5 },
      ],
    },
    "test.tunables.json",
  );
}

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

describe("parseTunables", () => {
  it("refuses another format, a default outside its range and a CPU address outside the cartridge's ROM", () => {
    const good = testTunables("a".repeat(64));
    expect(() => parseTunables({ ...good, format: "other" }, "x.json")).toThrow('x.json is not a tunables file this page reads: its format is "other"');
    expect(() => parseTunables({ ...good, values: [{ ...good.values[0], default: 40 }] }, "x.json")).toThrow("min <= default <= max");
    expect(() => parseTunables({ ...good, values: [{ ...good.values[0], cpuAddress: 0x6000 }] }, "x.json")).toThrow("$8000-$FFFF");
  });

  it("keeps a loaded file per ROM in the browser, under a setting key, and says when the kept one cannot be read", () => {
    const storage = memoryStorage();
    const tunables = testTunables("a".repeat(64));
    expect(storedTunables(storage, tunables.romSha256)).toEqual({ tunables: null, problem: null });
    storeTunables(storage, tunables);
    expect(storage.key(0)).toBe(`retrowright.tunables.${"a".repeat(64)}`);
    expect(storedTunables(storage, tunables.romSha256)).toEqual({ tunables, problem: null });
    expect(storedTunables(storage, "b".repeat(64)).tunables).toBeNull();
    storage.setItem(`retrowright.tunables.${"b".repeat(64)}`, JSON.stringify(tunables));
    expect(storedTunables(storage, "b".repeat(64))).toEqual({ tunables: null, problem: "The tunables file kept for this game is for another ROM." });
    storage.setItem(`retrowright.tunables.${"c".repeat(64)}`, "{");
    expect(storedTunables(storage, "c".repeat(64)).problem).toMatch(/JSON/);
  });

  it("reads choices that name each value from min to max, and refuses choices that do not", () => {
    const good = testTunables("a".repeat(64));
    const style = { ...good.values[0], key: "style", name: "Style", min: 0, max: 1, default: 1 };
    expect(parseTunables({ ...good, values: [{ ...style, choices: ["Slow", "Fast"] }] }, "x.json").values[0].choices).toEqual(["Slow", "Fast"]);
    expect(() => parseTunables({ ...good, values: [{ ...style, choices: ["Slow"] }] }, "x.json")).toThrow("choices that do not name each value");
    expect(() => parseTunables({ ...good, values: [{ ...style, choices: "Slow, Fast" }] }, "x.json")).toThrow("choices that do not name each value");
  });
});

describe("tunedRom", () => {
  it("changes exactly the tuned bytes, and refuses a ROM whose bytes are not the defaults or a value out of range", () => {
    const tunables = testTunables("a".repeat(64));
    const tuned = tunedRom(rom, tunables, { push: 12, brake: 5 });
    expect([...tuned.keys()].filter((index) => tuned[index] !== rom[index])).toEqual([16 + 0x200]);
    expect(tuned[16 + 0x200]).toBe(12);
    expect(() => tunedRom(tuned, tunables, { push: 8, brake: 5 })).toThrow("not the ROM the tunables are for");
    expect(() => tunedRom(rom, tunables, { push: 33, brake: 5 })).toThrow("Push must be 0 to 32, not 33.");
    expect(changeSummary(tunables, { push: 12, brake: 7 })).toBe("push 12, brake 7");
    expect(changeSummary(tunables, { push: 8, brake: 5 })).toBe("defaults");
    const withChoices = { ...tunables, values: [{ ...tunables.values[0], name: "Push style", min: 0, max: 1, default: 1, choices: ["Direction taps", "B taps"] }] };
    expect(changeSummary(withChoices, { push: 0 })).toBe("push style Direction taps");
  });
});

describe("tuned values in the browser", () => {
  it("are kept per ROM, so a reload brings them back, and a value out of range is dropped with a problem", () => {
    const storage = memoryStorage();
    const tunables = testTunables("a".repeat(64));
    expect(loadTunedValues(storage, tunables)).toEqual({ values: { push: 8, brake: 5 }, problem: null });
    saveTunedValues(storage, tunables.romSha256, { push: 12, brake: 5 });
    expect(loadTunedValues(storage, tunables).values).toEqual({ push: 12, brake: 5 });
    expect(loadTunedValues(storage, testTunables("b".repeat(64))).values).toEqual({ push: 8, brake: 5 });
    saveTunedValues(storage, tunables.romSha256, { push: 99, brake: 6 });
    expect(loadTunedValues(storage, tunables)).toEqual({ values: { push: 8, brake: 6 }, problem: "Kept values out of range were dropped: Push." });
  });

  it("kept under a key the value had before a rename, load under its key now; one kept under the key now wins", () => {
    const storage = memoryStorage();
    const plain = testTunables("a".repeat(64));
    const renamed = parseTunables({ ...plain, values: [{ ...plain.values[0], key: "stepPush", formerKeys: ["push"] }, plain.values[1]] }, "renamed.tunables.json");
    saveTunedValues(storage, renamed.romSha256, { push: 12, brake: 6 });
    expect(loadTunedValues(storage, renamed)).toEqual({ values: { stepPush: 12, brake: 6 }, problem: null });
    saveTunedValues(storage, renamed.romSha256, { push: 12, stepPush: 20, brake: 6 });
    expect(loadTunedValues(storage, renamed).values).toEqual({ stepPush: 20, brake: 6 });
  });

  it("kept under a key the file no longer has, load with the rest and are left out", () => {
    const storage = memoryStorage();
    const tunables = testTunables("a".repeat(64));
    saveTunedValues(storage, tunables.romSha256, { oldHop: 40, retiredHop: 48, brake: 7 });
    const loaded = loadTunedValues(storage, tunables);
    expect(loaded.problem).toBeNull();
    expect(loaded.values).toEqual({ push: 8, brake: 7 });
  });

  it("refuses a former key that is a key in use", () => {
    const plain = testTunables("a".repeat(64));
    expect(() => parseTunables({ ...plain, values: [{ ...plain.values[0], formerKeys: ["brake"] }, plain.values[1]] }, "x.json")).toThrow('the former key "brake" is a key in use');
  });
});

describe("saveTunedVersion", () => {
  it("adds a library entry whose ROM differs from the loaded game in exactly the tuned bytes, from a BPS that applies to the same SHA-256", async () => {
    const store = new MemoryGameStore(() => 1000);
    const { game } = await store.addRom("Racer (World).nes", rom);
    const tunables = testTunables(game.id);
    const version = await saveTunedVersion(store, game.id, tunables, { push: 12, brake: 7 });
    expect(version.patchName).toBe("tuned push 12, brake 7.bps");
    expect(version.result.game.fileName).toBe("Racer (World) + tuned push 12, brake 7.nes");
    const stored = (await store.getRom(version.result.game.id))!.data;
    expect([...stored.keys()].filter((index) => stored[index] !== rom[index])).toEqual([16 + 0x200, 16 + 0x201]);
    const applied = applyPatch(rom, version.bps).data;
    expect(await romId(applied)).toBe(version.result.game.id);
    expect(JSON.parse(version.valuesJson)).toMatchObject({ romSha256: game.id, tunedSha256: version.result.game.id, values: { push: 12, brake: 7 } });
  });
});
