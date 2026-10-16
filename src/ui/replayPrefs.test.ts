import { describe, expect, it } from "vitest";
import { loadReplaySeconds, saveReplaySeconds } from "./replayPrefs";

function fakeStorage(): Storage {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) } as Storage;
}

describe("the instant replay setting", () => {
  it("is on at 60 seconds until changed, and reads back what was saved, off included", () => {
    const storage = fakeStorage();
    expect(loadReplaySeconds(storage)).toEqual({ seconds: 60 });
    expect(loadReplaySeconds(undefined)).toEqual({ seconds: 60 });
    saveReplaySeconds(storage, 0);
    expect(loadReplaySeconds(storage)).toEqual({ seconds: 0 });
    saveReplaySeconds(storage, 120);
    expect(loadReplaySeconds(storage)).toEqual({ seconds: 120 });
  });

  it("says so and uses the default when the saved value cannot be read", () => {
    const storage = fakeStorage();
    for (const raw of ["{", '{"seconds":45}', '{"seconds":"60"}', "60"]) {
      storage.setItem("retrowright.replay", raw);
      expect(loadReplaySeconds(storage)).toEqual({ seconds: 60, problem: "The saved instant replay setting could not be read, so it is on, at 60 seconds." });
    }
  });
});
