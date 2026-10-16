import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { MenuCommand } from "../input/padMenu";
import { PATCH_EXTENSIONS } from "../patch/patch";
import type { GameRecord, GameSaves, StateSlot } from "../storage/gameStore";
import type { Persistence, StorageUse } from "../storage/persistence";
import { GameCard, GamePicture } from "./GameCard";
import { displayTitle, titleFromFileName } from "./gameTitle";
import { libraryFocus } from "./libraryFocus";
import { LibraryDialog } from "./LibraryDialog";
import { loadLibrarySort, loadLibraryView, saveLibrarySort, saveLibraryView, type LibraryLayout } from "./libraryPrefs";
import { continueGame, lastPlayedText, SEARCH_THRESHOLD, visibleGames, type LibrarySort } from "./libraryView";
import { needsGesture, nextFocus, PAD_GESTURE_HINT, type Direction } from "./menuFocus";
import { ExportForm, SavesPanel, type ExportRequest } from "./SavesPanel";
import { savedAtText, SlotGrid } from "./SlotGrid";

/** Free homebrew is listed here; the page links to no ROM site. */
const HOMEBREW_LIST_URL = "https://www.nesdev.org/wiki/Category:Homebrew_games";

export type StartFrom = "resume" | "power-on" | { slot: StateSlot };

/** What one click on a game starts: the save its picture shows, else the resume state, else power-on. */
export function firstStart(saves: GameSaves): StartFrom {
  if (saves.pictured?.kind === "slot") return { slot: saves.pictured.slot };
  if (saves.pictured?.kind === "resume" || saves.resumeAt !== null) return "resume";
  return "power-on";
}

function startLabel(start: StartFrom): string {
  if (typeof start === "object") return `Load slot ${start.slot}`;
  return start === "resume" ? "Continue" : "Play";
}

const hasSaves = (saves: GameSaves) => saves.resumeAt !== null || saves.slots.length > 0;

export interface LibraryHandle {
  /** A gamepad's command: the D-pad moves, choose presses, back closes a dialog. */
  command(command: MenuCommand): void;
  /** Focus on the Continue button, or the first card, or Add. */
  focusStart(): void;
}

interface LibraryProps {
  games: GameRecord[];
  persistent: boolean;
  /** Where the view and sort are remembered; undefined when the browser keeps nothing. */
  storage: Storage | undefined;
  /** True while the player is using a gamepad, which cannot open the file picker. */
  padInUse: boolean;
  /** A game's saves, read when it is opened; null when they could not be read (the page has said why). */
  loadSaves(id: string): Promise<GameSaves | null>;
  onAddFiles(files: File[]): void;
  onPlay(id: string, from: StartFrom): void;
  onRename(id: string, title: string): void;
  onFavourite(id: string, favourite: boolean): void;
  onRemove(id: string, withSaves: boolean): void;
  /** An IPS or BPS file picked to apply to a game. */
  onApplyPatch(id: string, file: File): void;
  /** Whether the browser has agreed to keep the page's data. */
  persistence: Persistence;
  readStorageUse(): Promise<StorageUse | null>;
  onExport(request: ExportRequest): void;
  onImport(file: File): void;
}

type DialogKind = "open" | "slots" | "manage" | "remove" | "remove-saves" | "export";

const NES_FILES = ".nes,application/octet-stream";
const PATCH_FILES = PATCH_EXTENSIONS.join(",");

const ARROWS: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/** The start page: every game the player added, as cards with their own pictures, and Continue for the last one played. */
export const Library = forwardRef<LibraryHandle, LibraryProps>(function Library(props, ref) {
  const { games, padInUse, storage, loadSaves } = props;
  const rootRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [sort, setSort] = useState<LibrarySort>(() => loadLibrarySort(storage));
  const [view, setView] = useState<LibraryLayout>(() => loadLibraryView(storage));
  const [dialog, setDialog] = useState<{ kind: DialogKind; id: string; saves?: GameSaves } | null>(null);
  const [savesOpen, setSavesOpen] = useState(false);
  /** The Continue card's game's saves, for its button's label; a click reads them again. */
  const [newestSaves, setNewestSaves] = useState<{ id: string; saves: GameSaves } | null>(null);

  const searchable = games.length > SEARCH_THRESHOLD;
  const shown = visibleGames(games, { query: searchable ? query : "", favouritesOnly, sort });
  const newest = continueGame(games);
  const dialogGame = dialog && games.find((game) => game.id === dialog.id);

  useEffect(() => saveLibrarySort(storage, sort), [storage, sort]);
  useEffect(() => saveLibraryView(storage, view), [storage, view]);

  // A new picture or resume state may change which save the Continue card starts.
  useEffect(() => {
    if (!newest) return;
    let current = true;
    void loadSaves(newest.id).then((saves) => {
      if (current && saves) setNewestSaves({ id: newest.id, saves });
    });
    return () => {
      current = false;
    };
  }, [loadSaves, newest?.id, newest?.thumbnail, newest?.resumeAt]);

  const open = async (game: GameRecord) => {
    const saves = await loadSaves(game.id);
    if (!saves) return;
    if (hasSaves(saves)) setDialog({ kind: "open", id: game.id, saves });
    else props.onPlay(game.id, "power-on");
  };

  const continueNewest = async (game: GameRecord) => {
    const saves = await loadSaves(game.id);
    if (saves) props.onPlay(game.id, firstStart(saves));
  };

  const newestStart: StartFrom | null = newest && (newestSaves?.id === newest.id ? firstStart(newestSaves.saves) : newest.resumeAt !== null ? "resume" : "power-on");

  const focusStart = () => {
    const root = rootRef.current;
    if (!root) return;
    const target = [".continue-button", "[data-card] button", ".add-games"].map((selector) => root.querySelector<HTMLElement>(selector)).find((element) => element !== null);
    target?.focus();
  };

  // Files dropped anywhere on the page while the library shows are added to it.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDragOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) props.onAddFiles(files);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [props.onAddFiles]);

  const move = (direction: Direction) => {
    if (dialogRef.current) nextFocus(dialogRef.current, document.activeElement, direction)?.focus();
    else if (rootRef.current) libraryFocus(rootRef.current, document.activeElement, direction)?.focus();
  };

  useImperativeHandle(ref, () => ({
    command(command) {
      if (command === "back") {
        setDialog(null);
        setSavesOpen(false);
        return;
      }
      if (command === "choose") {
        const active = document.activeElement;
        const scope = dialogRef.current ?? rootRef.current;
        if (!(active instanceof HTMLButtonElement) || !scope?.contains(active)) {
          if (!dialogRef.current) focusStart();
          return;
        }
        // The browser opens the file picker only for a click or key press.
        if (!needsGesture(active)) active.click();
        return;
      }
      move(command);
    },
    focusStart,
  }));

  const onGridKeyDown = (event: ReactKeyboardEvent) => {
    const direction = ARROWS[event.key];
    // Arrow keys in the search box and the sort list do their own thing; an open dialog has moved focus already.
    if (!direction || event.defaultPrevented || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    event.preventDefault();
    move(direction);
  };

  const closeDialog = () => setDialog(null);
  const chooseFiles = () => inputRef.current?.click();

  return (
    <section ref={rootRef} className="library" aria-labelledby="library-heading" onKeyDown={onGridKeyDown}>
      <div className="library-head">
        <h2 id="library-heading">Library</h2>
        {games.length > 0 && (
          <button type="button" className="add-games" data-needs-gesture="" aria-describedby={padInUse ? "add-hint" : undefined} onClick={chooseFiles}>
            Add games…
          </button>
        )}
        <button type="button" className="open-saves" aria-haspopup="dialog" onClick={() => setSavesOpen(true)}>
          Saves and storage…
        </button>
        {padInUse && (
          <span className="hint" id="add-hint">
            {PAD_GESTURE_HINT}
          </span>
        )}
        <input
          ref={inputRef}
          id="rom-input"
          type="file"
          accept={NES_FILES}
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            if (files.length > 0) props.onAddFiles(files);
            event.target.value = "";
          }}
        />
      </div>
      {games.length > 0 && (
        <p className="hint">
          {props.persistent
            ? "Add .nes files from your computer, or drop them anywhere on this page. They stay in this browser and are never uploaded."
            : "Add .nes files from your computer, or drop them here. They are never uploaded. This browser is not keeping data, so the library will be gone when the page closes."}
        </p>
      )}
      {props.persistence === "denied" && (
        <p className="storage-warning">
          This browser has not agreed to keep your saves, so it could clear them.{" "}
          <button type="button" className="link-button" onClick={() => setSavesOpen(true)}>
            Export your saves
          </button>{" "}
          now and then to keep a copy.
        </p>
      )}

      {games.length === 0 ? (
        <div className="library-empty">
          <p className="empty-lead">
            Load a <code>.nes</code> file from your computer. It stays in this browser and is never uploaded.
          </p>
          {!props.persistent && <p className="hint">This browser is not keeping data, so the library will be gone when the page closes.</p>}
          <div className="drop-zone">
            <p>Drop a game here, or anywhere on the page</p>
            <button type="button" className="add-games" data-needs-gesture="" aria-describedby={padInUse ? "add-hint" : undefined} onClick={chooseFiles}>
              Add games…
            </button>
          </div>
          <details className="rom-help">
            <summary>Where do games come from?</summary>
            <p>No games come with retrowright. Two kinds you can play:</p>
            <ul>
              <li>Your own cartridges: a copy of a game you own, read from the cartridge with a ROM dumper.</li>
              <li>
                Homebrew: new games written for the NES by hobbyists, many of them free from their authors. The{" "}
                <a href={HOMEBREW_LIST_URL} target="_blank" rel="noreferrer">
                  NESdev wiki's homebrew list
                </a>{" "}
                is a place to start; each game's own page says whether you may download it.
              </li>
            </ul>
          </details>
        </div>
      ) : (
        <>
          {newest && (
            <section className="continue-card" aria-label="Continue">
              <GamePicture game={newest} className="continue-picture" />
              <div className="continue-text">
                <h3>{displayTitle(newest).title}</h3>
                <p className="hint">{lastPlayedText(newest)}</p>
                <button type="button" className="continue-button" onClick={() => void continueNewest(newest)}>
                  {startLabel(newestStart!)}
                </button>
              </div>
            </section>
          )}

          <div className="library-tools">
            {searchable && (
              <label className="library-search">
                <span className="visually-hidden">Search the library</span>
                <input type="search" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
            )}
            <button type="button" className="filter-favourites" aria-pressed={favouritesOnly} onClick={() => setFavouritesOnly(!favouritesOnly)}>
              ★ Favourites
            </button>
            <label className="library-sort">
              Sort
              <select value={sort} onChange={(event) => setSort(event.target.value as LibrarySort)}>
                <option value="played">Last played</option>
                <option value="title">Title</option>
              </select>
            </label>
            <button type="button" className="view-toggle" aria-pressed={view === "list"} onClick={() => setView(view === "grid" ? "list" : "grid")}>
              List view
            </button>
          </div>

          {shown.length > 0 ? (
            <ul className={view === "grid" ? "game-grid" : "game-grid list"} aria-label="Games">
              {shown.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  onOpen={(target) => void open(target)}
                  onFavourite={(target) => props.onFavourite(target.id, !target.favourite)}
                  onManage={(target) => setDialog({ kind: "manage", id: target.id })}
                />
              ))}
            </ul>
          ) : (
            <p className="hint library-none">{favouritesOnly && query === "" ? "No favourites yet: star a game to add it here." : "No games match."}</p>
          )}
        </>
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          Drop .nes files to add them
        </div>
      )}

      {dialog && dialogGame && dialog.kind === "open" && dialog.saves && (
        <LibraryDialog title={displayTitle(dialogGame).title} dialogRef={dialogRef} onClose={closeDialog}>
          <GamePicture game={dialogGame} className="dialog-picture" />
          <OpenChoices
            saves={dialog.saves}
            onPlay={(from) => props.onPlay(dialogGame.id, from)}
            onPickSlot={() => setDialog({ ...dialog, kind: "slots" })}
            onCancel={closeDialog}
          />
        </LibraryDialog>
      )}

      {dialog && dialogGame && dialog.kind === "slots" && dialog.saves && (
        <LibraryDialog title={`Load a save state: ${displayTitle(dialogGame).title}`} dialogRef={dialogRef} onClose={closeDialog}>
          <SlotGrid
            mode="load"
            slots={dialog.saves.slots}
            currentSlot={dialog.saves.pictured?.kind === "slot" ? dialog.saves.pictured.slot : dialog.saves.slots[0].slot}
            onPick={(slot) => props.onPlay(dialogGame.id, { slot })}
          />
          <div className="bar">
            <button type="button" data-item="back" onClick={() => setDialog({ ...dialog, kind: "open" })}>
              ‹ Back
            </button>
          </div>
        </LibraryDialog>
      )}

      {dialog && dialogGame && dialog.kind === "manage" && (
        <LibraryDialog title={displayTitle(dialogGame).title} dialogRef={dialogRef} onClose={closeDialog}>
          <RenameForm
            game={dialogGame}
            onRename={(title) => {
              props.onRename(dialogGame.id, title);
              closeDialog();
            }}
          />
          {dialogGame.patchedFrom && (
            <p className="hint patched-from">
              Made from {dialogGame.patchedFrom.romTitle} with the patch {dialogGame.patchedFrom.patchName}.
            </p>
          )}
          <PatchButton
            padInUse={padInUse}
            onPatch={(file) => {
              props.onApplyPatch(dialogGame.id, file);
              closeDialog();
            }}
          />
          <div className="bar">
            <button type="button" data-item="export-game" onClick={() => setDialog({ kind: "export", id: dialogGame.id })}>
              Export saves…
            </button>
            <button type="button" data-item="remove" onClick={() => setDialog({ kind: "remove", id: dialogGame.id })}>
              Remove from library…
            </button>
            <button type="button" data-item="cancel" onClick={closeDialog}>
              Close
            </button>
          </div>
        </LibraryDialog>
      )}

      {dialog && dialogGame && dialog.kind === "export" && (
        <LibraryDialog title={`Export saves: ${displayTitle(dialogGame).title}`} dialogRef={dialogRef} onClose={closeDialog}>
          <p>One file with this game's battery save, save states with their pictures and resume state. Import it in another browser to carry them there.</p>
          <ExportForm
            gameId={dialogGame.id}
            onExport={(request) => {
              props.onExport(request);
              closeDialog();
            }}
          />
          <div className="bar">
            <button type="button" data-item="cancel" onClick={closeDialog}>
              Close
            </button>
          </div>
        </LibraryDialog>
      )}

      {savesOpen && (
        <LibraryDialog title="Saves and storage" dialogRef={dialogRef} onClose={() => setSavesOpen(false)}>
          <SavesPanel
            persistent={props.persistent}
            persistence={props.persistence}
            readStorageUse={props.readStorageUse}
            onExport={props.onExport}
            onImport={(file) => {
              props.onImport(file);
              setSavesOpen(false);
            }}
          />
          <div className="bar">
            <button type="button" data-item="cancel" onClick={() => setSavesOpen(false)}>
              Close
            </button>
          </div>
        </LibraryDialog>
      )}

      {dialog && dialogGame && dialog.kind === "remove" && (
        <LibraryDialog title="Remove this game?" dialogRef={dialogRef} onClose={closeDialog}>
          <p>
            {displayTitle(dialogGame).title} leaves the library. Its battery save, save states and resume state stay in this browser and come back if you add the same file again.
          </p>
          <div className="bar">
            <button type="button" data-item="remove-game" onClick={() => props.onRemove(dialogGame.id, false)}>
              Remove, keep saves
            </button>
            <button type="button" data-item="remove-saves" onClick={() => setDialog({ kind: "remove-saves", id: dialogGame.id })}>
              Remove with its saves…
            </button>
            <button type="button" data-item="cancel" data-autofocus="" onClick={closeDialog}>
              Cancel
            </button>
          </div>
        </LibraryDialog>
      )}

      {dialog && dialogGame && dialog.kind === "remove-saves" && (
        <LibraryDialog title="Delete its saves too?" dialogRef={dialogRef} onClose={closeDialog}>
          <p>
            This deletes the battery save, all eight save states and the resume state of {displayTitle(dialogGame).title} from this browser. It cannot be undone.
          </p>
          <div className="bar">
            <button type="button" className="danger" data-item="delete-saves" onClick={() => props.onRemove(dialogGame.id, true)}>
              Remove game and delete saves
            </button>
            <button type="button" data-item="cancel" data-autofocus="" onClick={closeDialog}>
              Cancel
            </button>
          </div>
        </LibraryDialog>
      )}
    </section>
  );
});

interface OpenChoicesProps {
  saves: GameSaves;
  onPlay(from: StartFrom): void;
  onPickSlot(): void;
  onCancel(): void;
}

/**
 * The choice a card opens. Its first, focused item starts the save the card's
 * picture shows, so a click and Enter never start something the picture does
 * not show.
 */
function OpenChoices({ saves, onPlay, onPickSlot, onCancel }: OpenChoicesProps) {
  const first = firstStart(saves);
  const pictured = saves.pictured;
  return (
    <div className="menu-items">
      {typeof first === "object" ? (
        <button type="button" className="menu-item" data-item="load-slot" data-autofocus="" onClick={() => onPlay(first)}>
          <span>Load slot {first.slot}</span>
          {pictured && <span className="menu-hint">saved {savedAtText(pictured.savedAt)}</span>}
        </button>
      ) : null}
      {saves.resumeAt !== null && (
        <button type="button" className="menu-item" data-item="continue" data-autofocus={first === "resume" ? "" : undefined} onClick={() => onPlay("resume")}>
          <span>Continue</span>
          <span className="menu-hint">where you left off, {savedAtText(saves.resumeAt)}</span>
        </button>
      )}
      {saves.slots.length > 0 && (
        <button type="button" className="menu-item" data-item="states" onClick={onPickSlot}>
          <span>Load a save state…</span>
          <span className="menu-hint">{saves.slots.length === 1 ? "1 slot saved" : `${saves.slots.length} slots saved`}</span>
        </button>
      )}
      <button type="button" className="menu-item" data-item="power-on" onClick={() => onPlay("power-on")}>
        <span>Start from power-on</span>
        <span className="menu-hint">battery saves are kept</span>
      </button>
      <button type="button" className="menu-item" data-item="cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** Picks an IPS or BPS file to apply to the game; the patched ROM becomes a new library entry and this one stays as it is. */
function PatchButton({ padInUse, onPatch }: { padInUse: boolean; onPatch(file: File): void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="patch-row">
      <button type="button" data-item="apply-patch" data-needs-gesture="" aria-describedby={padInUse ? "patch-hint" : "patch-about"} onClick={() => inputRef.current?.click()}>
        Apply patch…
      </button>
      <span className="hint" id={padInUse ? "patch-hint" : "patch-about"}>
        {padInUse ? PAD_GESTURE_HINT : "An .ips or .bps file. The patched game is added as a new entry; this one stays as it is."}
      </span>
      <input
        ref={inputRef}
        id="patch-input"
        type="file"
        accept={PATCH_FILES}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPatch(file);
        }}
      />
    </div>
  );
}

function RenameForm({ game, onRename }: { game: GameRecord; onRename(title: string): void }) {
  const [title, setTitle] = useState(game.title ?? "");
  const fromFile = titleFromFileName(game.fileName).title;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onRename(title);
  };
  return (
    <form className="rename-form" onSubmit={submit}>
      <label>
        Title
        <input type="text" value={title} placeholder={fromFile} data-autofocus="" onChange={(event) => setTitle(event.target.value)} />
      </label>
      <p className="hint">
        File: {game.fileName}. Leave the title empty to use “{fromFile}”.
      </p>
      <button type="submit" data-item="rename">
        Save title
      </button>
    </form>
  );
}
