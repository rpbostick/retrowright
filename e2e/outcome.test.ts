import { describe, expect, it } from "vitest";
import { outcome } from "./outcome.mjs";

describe("outcome", () => {
  it("passes a check that exits 0 with PASS lines", () => {
    expect(outcome({ status: 0, output: "PASS one\nPASS two\n" })).toEqual({ kind: "pass", note: "" });
  });

  it("fails a check that exits non-zero, even after a SKIP line", () => {
    expect(outcome({ status: 1, output: "SKIP: roms/x.nes is missing.\n" })).toEqual({ kind: "fail", note: "exit 1" });
    expect(outcome({ status: 2, output: "PASS one\nFAIL two\n" })).toEqual({ kind: "fail", note: "exit 2" });
  });

  it("skips a check that exits 0 after a SKIP line and no PASS line, with that line as the reason", () => {
    expect(outcome({ status: 0, output: "SKIP e2e/ramSearch.mjs: the Final Fantasy ROM is not in roms/.\n" })).toEqual({
      kind: "skip",
      note: "e2e/ramSearch.mjs: the Final Fantasy ROM is not in roms/.",
    });
    expect(outcome({ status: 0, output: "SKIP: roms/Final_Fantasy_USA.nes is missing.\n" }).note).toBe("roms/Final_Fantasy_USA.nes is missing.");
  });

  it("passes a check that skipped one part and passed the rest, naming the part", () => {
    expect(outcome({ status: 0, output: "PASS library\nSKIP map byte: the Final Fantasy ROM is not in roms/\n" })).toEqual({
      kind: "pass",
      note: "skipped part: map byte: the Final Fantasy ROM is not in roms/",
    });
  });
});
