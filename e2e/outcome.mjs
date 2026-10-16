// How e2e/all.mjs reads one check's run. A check skips itself by exiting 0
// after a line starting with SKIP; a11y prints such a line for one section and
// passes the rest, so a run is skipped as a whole only when it has no PASS line.

/** `{ kind: "pass" | "fail" | "skip", note }` from a check's exit code and output. */
export function outcome({ status, output }) {
  const lines = output.split("\n");
  const skips = lines.filter((line) => line.startsWith("SKIP")).map((line) => line.replace(/^SKIP:?\s*/, ""));
  if (status !== 0) return { kind: "fail", note: `exit ${status}` };
  if (skips.length > 0 && !lines.some((line) => line.startsWith("PASS"))) return { kind: "skip", note: skips.join("; ") };
  return { kind: "pass", note: skips.length > 0 ? `skipped part: ${skips.join("; ")}` : "" };
}
