// npm run patch -- create <source.nes> <target.nes> <out.bps> [--metadata <text>]
// npm run patch -- apply <rom> <patch> <out>
// Makes a BPS patch from two ROMs, or applies an IPS or BPS patch to a ROM,
// with the same module the page's library uses.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { applyPatch, crc32, crc32Hex, createBps } from "../src/patch/patch";

export const PATCH_USAGE = "usage: npm run patch -- create <source.nes> <target.nes> <out.bps> [--metadata <text>]\n       npm run patch -- apply <rom> <patch> <out>";

/** A mistake in the command line, as opposed to a file that cannot be read or patched. */
export class UsageError extends Error {}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

const readBytes = (path: string) => new Uint8Array(readFileSync(path));

function describe(label: string, data: Uint8Array): string {
  return `${label}: ${data.length} bytes, CRC32 ${crc32Hex(crc32(data))}, SHA-256 ${sha256(data)}`;
}

function create(args: string[]): string[] {
  let metadata: string | undefined;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--metadata") {
      metadata = args[++index];
      if (metadata === undefined) throw new UsageError("--metadata needs a value.");
    } else if (args[index].startsWith("--")) {
      throw new UsageError(`Unknown option ${args[index]}.`);
    } else {
      positional.push(args[index]);
    }
  }
  if (positional.length !== 3) throw new UsageError("create needs a source ROM, a target ROM and the BPS file to write.");
  const [sourcePath, targetPath, outPath] = positional;
  const source = readBytes(sourcePath);
  const target = readBytes(targetPath);
  const patch = createBps(source, target, metadata);
  writeFileSync(outPath, patch);
  return [describe("Source", source), describe("Target", target), `Wrote ${outPath}: ${patch.length} bytes.`];
}

function apply(args: string[]): string[] {
  if (args.length !== 3 || args.some((arg) => arg.startsWith("--"))) throw new UsageError("apply needs a ROM, a patch and the file to write.");
  const [romPath, patchPath, outPath] = args;
  const rom = readBytes(romPath);
  const applied = applyPatch(rom, readBytes(patchPath));
  writeFileSync(outPath, applied.data);
  const lines = [describe("ROM", rom), `Applied ${applied.format.toUpperCase()} patch ${patchPath}.`];
  if (applied.metadata !== null) lines.push(`Patch description: ${applied.metadata}`);
  lines.push(describe(`Wrote ${outPath}`, applied.data));
  return lines;
}

/** Runs one patch command and gives the lines to print. */
export function patchCommand(argv: string[]): string[] {
  const [command, ...rest] = argv;
  if (command === "create") return create(rest);
  if (command === "apply") return apply(rest);
  throw new UsageError(command === undefined ? "Give a command: create or apply." : `Unknown command ${command}.`);
}
