import { byLastPlayed, type GameRecord } from "../storage/gameStore";
import { displayTitle } from "./gameTitle";
import { savedAtText } from "./SlotGrid";

/** The search box shows once the library holds more games than this. */
export const SEARCH_THRESHOLD = 12;

export type LibrarySort = "played" | "title";

export interface LibraryFilter {
  query: string;
  favouritesOnly: boolean;
  sort: LibrarySort;
}

function matches(game: GameRecord, words: string[]): boolean {
  const { title, tags } = displayTitle(game);
  const haystack = [title, ...tags, game.fileName].join(" ").toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** The games a card grid shows: filtered by favourites and search words, then sorted. */
export function visibleGames(games: GameRecord[], filter: LibraryFilter): GameRecord[] {
  const words = filter.query.toLocaleLowerCase().split(/\s+/).filter((word) => word.length > 0);
  const shown = games.filter((game) => (!filter.favouritesOnly || game.favourite) && matches(game, words));
  if (filter.sort === "title") {
    return [...shown].sort((a, b) => displayTitle(a).title.localeCompare(displayTitle(b).title, undefined, { sensitivity: "base", numeric: true }));
  }
  return [...shown].sort(byLastPlayed);
}

/** The game the Continue card offers: the one played last, or none before any is played. */
export function continueGame(games: GameRecord[]): GameRecord | null {
  return games.reduce<GameRecord | null>((newest, game) => (game.lastPlayedAt !== null && (newest === null || game.lastPlayedAt > newest.lastPlayedAt!) ? game : newest), null);
}

export function lastPlayedText(game: GameRecord): string {
  return game.lastPlayedAt === null ? "Not played yet" : `Played ${savedAtText(game.lastPlayedAt)}`;
}
