import type { GameRecord } from "../storage/gameStore";
import { displayTitle } from "./gameTitle";
import { lastPlayedText } from "./libraryView";

/** The system every game here runs on; shown on a card until the game has a picture of its own. */
const SYSTEM_NAME = "NES";

/** The player's own picture of the game, or a plain placeholder naming the system. Never cover art. */
export function GamePicture({ game, className }: { game: GameRecord; className: string }) {
  return (
    <span className={className}>
      {game.thumbnail ? <img src={game.thumbnail} alt="" /> : <span className="card-placeholder">{SYSTEM_NAME}</span>}
    </span>
  );
}

interface GameCardProps {
  game: GameRecord;
  onOpen(game: GameRecord): void;
  onFavourite(game: GameRecord): void;
  onManage(game: GameRecord): void;
}

export function GameCard({ game, onOpen, onFavourite, onManage }: GameCardProps) {
  const { title, tags } = displayTitle(game);
  const played = lastPlayedText(game);
  return (
    <li className="game-card" data-card={game.id}>
      <button
        type="button"
        className="card-open"
        // The visible words in their order, so speech control by the shown text finds the card (WCAG 2.5.3).
        aria-label={`${title}${tags.length ? `, ${tags.join(", ")}` : ""}. ${played}.${game.resumeAt !== null ? " Can continue where you left off." : ""}`}
        onClick={() => onOpen(game)}
      >
        <GamePicture game={game} className="card-picture" />
        <span className="card-text">
          {/* The spaces keep the words apart in the text read from the card (its spans are blocks on screen). */}
          <span className="card-title">{title}</span>{" "}
          {tags.length > 0 && <span className="card-tags">{tags.join(" · ")}</span>}{" "}
          <span className="card-played">{played}</span>
        </span>
      </button>
      <span className="card-actions">
        <button type="button" className="card-star" aria-pressed={game.favourite} aria-label={`Favourite: ${title}`} onClick={() => onFavourite(game)}>
          <span aria-hidden="true">{game.favourite ? "★" : "☆"}</span>
        </button>
        <button type="button" className="card-more" aria-haspopup="dialog" aria-label={`Rename, patch, export or remove ${title}`} onClick={() => onManage(game)}>
          <span aria-hidden="true">⋯</span>
        </button>
      </span>
    </li>
  );
}
