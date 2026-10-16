import { describe, expect, it, vi } from "vitest";
import { currentPersistence, formatBytes, requestPersistence, storageUse, storageUseText, type StorageApi } from "./persistence";

function stubApi(answers: { persisted?: boolean; persist?: boolean; usage?: number; quota?: number }) {
  return {
    persisted: vi.fn(async () => answers.persisted ?? false),
    persist: vi.fn(async () => answers.persist ?? false),
    estimate: vi.fn(async () => ({ usage: answers.usage, quota: answers.quota })),
  } satisfies StorageApi;
}

describe("persistent storage", () => {
  it("reads as granted when the browser has granted it already, else as not asked", async () => {
    expect(await currentPersistence(stubApi({ persisted: true }))).toBe("granted");
    const api = stubApi({ persisted: false });
    expect(await currentPersistence(api)).toBe("not-asked");
    expect(api.persist).not.toHaveBeenCalled();
  });

  it("asks with persist() and reports the browser's answer", async () => {
    const granting = stubApi({ persist: true });
    expect(await requestPersistence(granting)).toBe("granted");
    expect(granting.persist).toHaveBeenCalledOnce();
    expect(await requestPersistence(stubApi({ persist: false }))).toBe("denied");
  });

  it("says when the browser has no Storage API", async () => {
    expect(await currentPersistence(undefined)).toBe("unsupported");
    expect(await requestPersistence({} as StorageApi)).toBe("unsupported");
    expect(await storageUse(undefined)).toBeNull();
  });
});

describe("storage meter", () => {
  it("reads usage and quota from estimate()", async () => {
    const use = await storageUse(stubApi({ usage: 2_345_678, quota: 1_200_000_000 }));
    expect(use).toEqual({ usage: 2_345_678, quota: 1_200_000_000 });
    expect(storageUseText(use!)).toBe("2.3 MB used of about 1.2 GB this browser allows the page");
  });

  it("gives no reading for an estimate without numbers", async () => {
    expect(await storageUse(stubApi({}))).toBeNull();
  });

  it("writes sizes in decimal units", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(999)).toBe("999 bytes");
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(52_000_000)).toBe("52 MB");
  });
});
