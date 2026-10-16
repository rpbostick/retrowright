import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildInes, PAINT_BACKDROP_PROGRAM, READ_PAD_PROGRAM } from "../src/test/syntheticRom";
import { patchCommand, UsageError } from "./patchCommand";

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

describe("patchCommand", () => {
  let dir: string;
  const source = buildInes({ program: READ_PAD_PROGRAM });
  const target = buildInes({ program: PAINT_BACKDROP_PROGRAM });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "retrowright-patch-"));
    writeFileSync(join(dir, "source.nes"), source);
    writeFileSync(join(dir, "target.nes"), target);
  });

  it("creates a BPS that apply turns back into the target", () => {
    const created = patchCommand(["create", join(dir, "source.nes"), join(dir, "target.nes"), join(dir, "out.bps"), "--metadata", "red backdrop"]);
    expect(created[1]).toContain(`SHA-256 ${sha256(target)}`);
    const applied = patchCommand(["apply", join(dir, "source.nes"), join(dir, "out.bps"), join(dir, "patched.nes")]);
    expect(applied).toContain("Patch description: red backdrop");
    expect(sha256(readFileSync(join(dir, "patched.nes")))).toBe(sha256(target));
  });

  it("refuses to apply a BPS to another ROM", () => {
    patchCommand(["create", join(dir, "source.nes"), join(dir, "target.nes"), join(dir, "out.bps")]);
    expect(() => patchCommand(["apply", join(dir, "target.nes"), join(dir, "out.bps"), join(dir, "patched.nes")])).toThrow(/This patch is for a ROM with CRC32 [0-9A-F]{8}/);
  });

  it("names a wrong command line as a usage error", () => {
    expect(() => patchCommand([])).toThrow(UsageError);
    expect(() => patchCommand(["make"])).toThrow("Unknown command make.");
    expect(() => patchCommand(["apply", "a.nes", "b.ips"])).toThrow(UsageError);
    expect(() => patchCommand(["create", "a", "b", "c", "--metadata"])).toThrow("--metadata needs a value.");
  });
});
