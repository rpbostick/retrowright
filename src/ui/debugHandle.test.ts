import { describe, expect, it } from "vitest";
import { debugHandleWanted } from "./debugHandle";

describe("debugHandleWanted", () => {
  it("installs the handle in production only when the page is opened with ?debug", () => {
    expect(debugHandleWanted("", false)).toBe(false);
    expect(debugHandleWanted("?theme=dark", false)).toBe(false);
    expect(debugHandleWanted("?debug", false)).toBe(true);
    expect(debugHandleWanted("?x=1&debug=1", false)).toBe(true);
  });

  it("always installs it in development", () => {
    expect(debugHandleWanted("", true)).toBe(true);
  });
});
