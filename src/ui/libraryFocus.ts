// Arrow-key and D-pad movement on the library page. Inside the card grid, up
// and down move to the same button (open, star, more) of the card a row above
// or below; everywhere else focus steps through the page's controls in
// document order, without wrapping, so holding a direction stops at the end.

import { focusables, type Direction } from "./menuFocus";

/**
 * Cards per row as laid out, read from the page rather than the CSS: the grid
 * fills as many columns as fit, so only the layout knows. The cards sharing
 * the first card's top edge make one row.
 */
export function columnsOf(cards: HTMLElement[]): number {
  if (cards.length === 0) return 1;
  const top = cards[0].getBoundingClientRect().top;
  return cards.filter((card) => card.getBoundingClientRect().top === top).length;
}

function step(items: HTMLElement[], index: number, by: number): HTMLElement | null {
  const next = index + by;
  return next >= 0 && next < items.length ? items[next] : null;
}

/** Where focus goes from `current` in `direction` inside `root`, or null to stay. */
export function libraryFocus(root: HTMLElement, current: Element | null, direction: Direction): HTMLElement | null {
  const items = focusables(root);
  if (items.length === 0) return null;
  const index = current instanceof HTMLElement ? items.indexOf(current) : -1;
  if (index === -1) return root.querySelector<HTMLElement>("[data-card] button") ?? items[0];
  const card = current!.closest<HTMLElement>("[data-card]");
  if (!card || direction === "left" || direction === "right") return step(items, index, direction === "right" || direction === "down" ? 1 : -1);

  const cards = [...root.querySelectorAll<HTMLElement>("[data-card]")];
  const columns = columnsOf(cards);
  const at = cards.indexOf(card);
  const lastRow = Math.floor((cards.length - 1) / columns);
  let target = at + (direction === "down" ? columns : -columns);
  // Down from a full row onto a shorter last row lands on its last card.
  if (direction === "down" && target >= cards.length && Math.floor(at / columns) < lastRow) target = cards.length - 1;
  if (target >= 0 && target < cards.length) {
    const inner = focusables(card).indexOf(current as HTMLElement);
    const choices = focusables(cards[target]);
    return choices[Math.min(inner, choices.length - 1)] ?? null;
  }
  // Past the first or last row: leave the grid to the control before or after it.
  const edge = direction === "down" ? focusables(cards[cards.length - 1]).at(-1)! : focusables(cards[0])[0];
  return step(items, items.indexOf(edge), direction === "down" ? 1 : -1);
}
