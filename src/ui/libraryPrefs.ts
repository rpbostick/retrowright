import type { LibrarySort } from "./libraryView";

export type LibraryLayout = "grid" | "list";

const VIEW_KEY = "retrowright.libraryView";
const SORT_KEY = "retrowright.librarySort";
const VIEWS: readonly LibraryLayout[] = ["grid", "list"];
const SORTS: readonly LibrarySort[] = ["played", "title"];

/** Kept per browser beside the theme; a value this version does not know reads as the default. */
export function loadLibraryView(storage: Storage | undefined): LibraryLayout {
  const saved = storage?.getItem(VIEW_KEY);
  return VIEWS.find((view) => view === saved) ?? "grid";
}

export function saveLibraryView(storage: Storage | undefined, view: LibraryLayout): void {
  storage?.setItem(VIEW_KEY, view);
}

export function loadLibrarySort(storage: Storage | undefined): LibrarySort {
  const saved = storage?.getItem(SORT_KEY);
  return SORTS.find((sort) => sort === saved) ?? "played";
}

export function saveLibrarySort(storage: Storage | undefined, sort: LibrarySort): void {
  storage?.setItem(SORT_KEY, sort);
}
