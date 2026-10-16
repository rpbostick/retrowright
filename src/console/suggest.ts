// Names close to a mistyped one, for "did you mean", and the completion of a
// typed start of a name.

/** Case, underscores and hyphens aside: jump_height and JUMP-HEIGHT are jumpHeight. */
const loose = (name: string) => name.toLowerCase().replace(/[_-]/g, "");

/**
 * Levenshtein distance: the fewest single-letter inserts, deletes and changes from one to the other.
 * Deliberate: kept local rather than taking leven or fastest-levenshtein (both MIT); a dependency for
 * a dozen lines run on short command names buys nothing.
 */
function editDistance(from: string, to: string): number {
  let previous = Array.from({ length: to.length + 1 }, (_, index) => index);
  for (let row = 1; row <= from.length; row++) {
    const current = [row];
    for (let column = 1; column <= to.length; column++) {
      const change = from[row - 1] === to[column - 1] ? 0 : 1;
      current.push(Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + change));
    }
    previous = current;
  }
  return previous[to.length];
}

/**
 * The name `typed` most likely meant: one equal to it but for case,
 * underscores and hyphens, else the nearest within a third of its length
 * (at least 2 edits); null when none is that close.
 */
export function closestName(typed: string, names: readonly string[]): string | null {
  const wanted = loose(typed);
  const same = names.find((name) => loose(name) === wanted);
  if (same !== undefined) return same;
  const limit = Math.max(2, Math.floor(wanted.length / 3));
  let best: string | null = null;
  let bestDistance = limit + 1;
  for (const name of names) {
    const distance = editDistance(wanted, loose(name));
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best;
}

/** "; did you mean jumpHeight?" when a name is close, else "". */
export function didYouMean(typed: string, names: readonly string[]): string {
  const close = closestName(typed, names);
  return close === null ? "" : `; did you mean ${close}?`;
}

/** The names starting with `start` (case aside), and the longest start they share. */
export function completions(start: string, names: readonly string[]): { shared: string; matches: string[] } {
  const matches = names.filter((name) => name.toLowerCase().startsWith(start.toLowerCase()));
  if (matches.length === 0) return { shared: start, matches };
  let shared = matches[0];
  for (const name of matches) {
    let length = 0;
    while (length < shared.length && length < name.length && shared[length].toLowerCase() === name[length].toLowerCase()) length++;
    shared = shared.slice(0, length);
  }
  return { shared: shared.length >= start.length ? shared : start, matches };
}
