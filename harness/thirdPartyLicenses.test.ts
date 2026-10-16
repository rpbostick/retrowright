import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bundledPackages, LICENSES_FILE, thirdPartyLicenses } from "./thirdPartyLicenses";

describe("THIRD_PARTY_LICENSES", () => {
  it("is what npm run licenses writes from the installed dependencies", () => {
    expect(existsSync(LICENSES_FILE), "THIRD_PARTY_LICENSES is missing: run npm run licenses").toBe(true);
    expect(readFileSync(LICENSES_FILE, "utf8"), "THIRD_PARTY_LICENSES is out of date: run npm run licenses").toBe(thirdPartyLicenses());
  });

  it("covers the runtime dependencies and the workbox modules in dist/, and no dev tool", () => {
    const names = bundledPackages().map((pkg) => pkg.name);
    expect(names).toEqual(expect.arrayContaining(["jsnes", "react", "react-dom", "scheduler", "workbox-window", "workbox-precaching", "workbox-routing", "workbox-core", "workbox-strategies"]));
    expect(names).not.toContain("vite");
    expect(names).not.toContain("vite-plugin-pwa");
    expect(names.filter((name) => name.startsWith("@types/"))).toEqual([]);
  });

  it("names jsnes as Apache-2.0 and carries its licence text", () => {
    expect(bundledPackages().find((pkg) => pkg.name === "jsnes")?.licence).toBe("Apache-2.0");
    expect(thirdPartyLicenses()).toContain("Apache License");
  });
});
