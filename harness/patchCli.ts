// The command line of harness/patchCommand.ts. Exits 2 on bad arguments, 1
// when a file cannot be read or patched (a BPS for another ROM among them).

import { PATCH_USAGE, patchCommand, UsageError } from "./patchCommand";

try {
  for (const line of patchCommand(process.argv.slice(2))) console.log(line);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error instanceof UsageError ? `${message}\n${PATCH_USAGE}` : message);
  process.exit(error instanceof UsageError ? 2 : 1);
}
