import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JsnesCore } from "../core/jsnesCore";
import { Button } from "../core/types";
import { AudioOutput } from "../audio/audioOutput";
import { ButtonLatch } from "../input/buttonLatch";
import { GamepadPoller } from "../input/gamepad";
import {
  actionForCode,
  bindTarget,
  DEFAULT_BINDINGS,
  Hotkey,
  keyLabel,
  loadBindings,
  mouseCode,
  padButtonOf,
  padButtonsForCode,
  saveBindings,
  type Action,
  type BindingTarget,
  type KeyBindings,
} from "../input/keyBindings";
import { PadMenuRouter } from "../input/padMenu";
import { MOVIE_EXTENSION, parseMovie, serializeMovie, type Movie } from "../movie/format";
import { Player, type LoadedGame, type MovieStatus } from "../player/player";
import { MovieIndicator, RECORD_CHOICES, type RecordChoice } from "./MovieBar";
import { ScreenRenderer } from "../player/screenRenderer";
import { parseInes } from "../rom/ines";
import {
  BLOCKED_MESSAGE,
  gameSaves,
  openGameStore,
  REPLACED_MESSAGE,
  type GameRecord,
  type GameSaves,
  type GameStore,
  type OpenedStore,
  type StateRecord,
  type StateSlot,
} from "../storage/gameStore";
import { BACKUP_EXTENSION, buildBackup, parseBackup, restoreBackup, restoreSummary, serializeBackup } from "../storage/backup";
import { browserStorageApi, currentPersistence, requestPersistence, storageUse, type Persistence } from "../storage/persistence";
import { settingsSnapshot } from "../storage/settingsSnapshot";
import { browserIndexedDb, browserLocalStorage } from "./browserStorage";
import type { ExportRequest } from "./SavesPanel";
import { debugHandleWanted, installDebugHandle } from "./debugHandle";
import { displayTitle } from "./gameTitle";
import { Library, type LibraryHandle, type StartFrom } from "./Library";
import { addPatchedGame } from "./patchedGame";
import { QuickMenu, type QuickMenuHandle } from "./QuickMenu";
import { Screen } from "./Screen";
import { ToolsPanel } from "./ToolsPanel";
import { TunePanel } from "./TunePanel";
import { saveTunedVersion } from "./tunedGame";
import { defaultValues, type Tunables, type TunedValues } from "../tune/tunables";
import { storedTunables, storeTunables } from "../tune/tuneStore";
import { storedProfile, storeProfile } from "../console/profileStore";
import type { GameProfile } from "../console/gameProfile";
import { hasLocalFolder, localGameFiles, localGamesList, readGameFile, type GameFiles, type ListedGame } from "./gameFiles";
import { useTune } from "./useTune";
import { applyTheme, loadTheme, nextTheme, saveTheme } from "./theme";
import { placeLayout } from "../touch/layout";
import { PHONE_LAYOUT } from "../touch/layouts";
import { loadTouchPrefs, saveTouchPrefs } from "../touch/touchPrefs";
import { TouchControls } from "./TouchControls";
import { UpdateNotice } from "./UpdateNotice";
import { useBoxSize } from "./useBoxSize";
import type { VideoDescription } from "../core/types";
import { loadDisplayPrefs, saveDisplayPrefs } from "./displayPrefs";
import { loadReplaySeconds, saveReplaySeconds } from "./replayPrefs";
import { downloadBlob } from "./download";
import { encodeScreenshot, screenshotFileName } from "./screenshot";
import { ControlsSidePanel } from "./ControlsSidePanel";
import { listedGameLink, missingTestFile, parseTestLink } from "./testLink";
import { ConsolePanel } from "./ConsolePanel";
import type { ConsoleHost } from "../console/commands";
import { ConsoleSession } from "../console/session";
import { tunableValues } from "../console/tunableValues";
import { consoleTableFor } from "../games/consoleTables";

interface Notice {
  id: number;
  /** info goes after a few seconds unless it stays; a warning or an error stays until dismissed. */
  kind: "info" | "warning" | "error";
  text: string;
}

/** Where fast-forward is held from; it runs while any of them holds it, or while the menu has it on. */
type FastForwardSource = "keyboard" | "mouse" | "gamepad" | "touch";

const INFO_NOTICE_MS = 3000;
/** How often a console command's wait looks at the frame count: a few times a frame. */
const FRAME_POLL_MS = 4;
const OPENING_MESSAGE = "The library is still opening…";
const MOVIE_STATUS_MS = 200;
const IDLE_MOVIE: MovieStatus = { mode: "idle", frame: 0, frames: null, results: [], finished: false };

function downloadJson(text: string, fileName: string): void {
  downloadBlob(new Blob([text], { type: "application/json" }), fileName);
}

const fileStamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** `kind` tells an instant replay ("replay") from a recording in the file's name. */
function downloadMovie(movie: Movie, kind?: string): void {
  downloadJson(serializeMovie(movie), `${movie.rom.name.replace(/\.nes$/i, "")}-${kind ? `${kind}-` : ""}${fileStamp()}${MOVIE_EXTENSION}`);
}

const PERSISTENCE_NOTICE: Partial<Record<Persistence, { kind: Notice["kind"]; text: string }>> = {
  granted: { kind: "info", text: "This browser has agreed to keep your saves." },
  denied: {
    kind: "warning",
    text: "This browser has not agreed to keep your saves, so it could clear them. Export your saves from the library's Saves and storage now and then to keep a copy.",
  },
};

function replaySummary(status: MovieStatus): { kind: Notice["kind"]; text: string } {
  const failed = status.results.filter((result) => !result.passed);
  if (failed.length === 0) return { kind: "info", text: `Movie finished: ${status.results.length} checkpoint(s) passed.` };
  const first = failed[0];
  return { kind: "error", text: `Movie finished: ${failed.length} of ${status.results.length} checkpoint(s) failed. "${first.name}" at frame ${first.frame}: ${first.failures[0]}` };
}
const SLOT_HOTKEYS: Partial<Record<Action, StateSlot>> = { [Hotkey.Slot1]: 1, [Hotkey.Slot2]: 2, [Hotkey.Slot3]: 3 };
/** Each game starts with these; a closed game's choices do not carry over to the next. */
const FIRST_SLOT: StateSlot = 1;
const FIRST_RECORD_CHOICE: RecordChoice = "power-on-keep";

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Keys typed into these stay with them instead of driving the game. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return target.type !== "file" && target.type !== "checkbox";
  return target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
}


export function App() {
  const storage = useMemo(browserLocalStorage, []);
  const audio = useMemo(() => new AudioOutput(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const playerRef = useRef<Player | null>(null);
  /** Resolves once the player exists: a game added while the store was still opening starts as soon as it can. */
  const playerReady = useRef(deferred<Player>());
  const rendererRef = useRef<ScreenRenderer | null>(null);
  const latchRef = useRef<ButtonLatch | null>(null);
  const pollerRef = useRef<GamepadPoller | null>(null);
  const menuRef = useRef<QuickMenuHandle>(null);
  const libraryRef = useRef<LibraryHandle>(null);
  /** Mirrors menuOpen for the gamepad router, which reads it between renders. */
  const menuOpenRef = useRef(false);
  /** Set by Quit to library: the library's Continue button takes focus once it shows. */
  const focusLibrary = useRef(false);
  const noticeId = useRef(0);
  /** True from a Tab that moves focus until the next click: a control reached by Tab takes the keys instead of the game. */
  const keyboardFocus = useRef(false);
  /** The pointer type of the last pointerdown: a touch's compatibility mouse events must not press A or B. */
  const lastPointerType = useRef("");
  /** Set by a click that resumes a game paused by lost focus: that click only gives the game back. */
  const clickResumed = useRef(false);
  /** Mouse buttons held on the picture and the hotkey each pressed, or "pad" for pad buttons, by MouseEvent.button. */
  const mouseHeld = useRef(new Map<number, Action | "pad">());
  /** After a mouse button is bound, its click and context menu are kept from the page. */
  const swallowAfterBinding = useRef({ click: false, contextMenu: false });

  const [opened, setOpened] = useState<OpenedStore | null>(null);
  /** The store being opened; every action waits on it, so none is lost while another tab blocks the open. */
  const storeOpening = useRef<Promise<OpenedStore> | null>(null);
  /** The notice shown while another tab blocks the open, removed once the store opens. */
  const blockedNotice = useRef<number | null>(null);
  const storeIsOpen = useRef(false);
  const [games, setGames] = useState<GameRecord[]>([]);
  /** True from a gamepad's menu or library command until the next key press or click. */
  const [padInUse, setPadInUse] = useState(false);
  const [game, setGame] = useState<LoadedGame | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [slots, setSlots] = useState<StateRecord[]>([]);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [slot, setSlot] = useState<StateSlot>(FIRST_SLOT);
  const [initialBindings] = useState(() => loadBindings(storage));
  const [bindings, setBindings] = useState(initialBindings.bindings);
  const [rebinding, setRebinding] = useState<BindingTarget | null>(null);
  const changeBindings = useCallback(
    (next: KeyBindings) => {
      setBindings(next);
      saveBindings(storage, next);
    },
    [storage],
  );
  const [gamepad, setGamepad] = useState<string | null>(null);
  const [audioState, setAudioState] = useState("starting");
  const [theme, setTheme] = useState(() => loadTheme(storage));
  const [movieStatus, setMovieStatus] = useState<MovieStatus>(IDLE_MOVIE);
  const [recordChoice, setRecordChoice] = useState<RecordChoice>(FIRST_RECORD_CHOICE);
  const [fullscreen, setFullscreen] = useState(false);
  const [initialTouch] = useState(() => loadTouchPrefs(storage));
  const [touchPrefs, setTouchPrefs] = useState(initialTouch.prefs);
  /** The touch controls show from the first touch (or at once on a touch-first device) until a key or pad is used. */
  const [touchShown, setTouchShown] = useState(() => initialTouch.prefs.enabled && (window.matchMedia?.("(pointer: coarse)").matches ?? false));
  const touchEnabled = useRef(touchPrefs.enabled);
  touchEnabled.current = touchPrefs.enabled;
  const markCount = useRef(0);
  const storageApi = useMemo(browserStorageApi, []);
  const [persistence, setPersistence] = useState<Persistence>("not-asked");
  /** Set once the page has asked for persistent storage: it asks once, after the first save. */
  const persistenceAsked = useRef(false);
  /** Sound starts on the first click or key press; until then a hint shows by the picture. */
  const [soundStarted, setSoundStarted] = useState(false);
  /** True while the game is paused because the window lost focus. */
  const [focusPaused, setFocusPaused] = useState(false);
  /** Changed after an import, so the library reads its view and sort again. */
  const [libraryKey, setLibraryKey] = useState(0);
  const [initialDisplay] = useState(() => loadDisplayPrefs(storage));
  const [displayPrefs, setDisplayPrefs] = useState(initialDisplay.prefs);
  const [initialReplay] = useState(() => loadReplaySeconds(storage));
  /** How long the instant replay is, or 0 while it is off. */
  const [replaySeconds, setReplaySeconds] = useState(initialReplay.seconds);
  /** The open game's picture size and shape, from its core. */
  const [video, setVideo] = useState<VideoDescription | null>(null);
  const [fastForwardOn, setFastForwardOn] = useState(false);
  const [fastForwardHeld, setFastForwardHeld] = useState<ReadonlySet<FastForwardSource>>(new Set());
  /** The tools panel beside the screen; offered only with the Developer tools setting on, and not in touch play. */
  const [toolsOpen, setToolsOpen] = useState(false);
  /** The Tune panel beside the screen; offered only for a game with tunables, and not in touch play. */
  const [tuneOpen, setTuneOpen] = useState(false);
  /** A test link in the page's URL; the development server alone serves their ROMs, so a build never reads one. */
  const [testLink, setTestLink] = useState(() => (import.meta.env.DEV ? parseTestLink(window.location.search) : null));
  const testLinkStarted = useRef(false);
  /** The tunables file and profile a ?game= link's games.json entry names for its ROM. */
  const namedFiles = useRef<Pick<ListedGame, "tunables" | "profile"> | undefined>(undefined);
  /** A test link's controls=1 shows the controls panel in this tab alone, until the menu's setting is changed; a ?game= link always shows it. */
  const [controlsForTab, setControlsForTab] = useState(() => testLink?.ok === true && ("gameId" in testLink || testLink.controls));
  /** The game profile found for the open game, for the console's values and commands. */
  const [profile, setProfile] = useState<{ romSha256: string; profile: GameProfile } | null>(null);
  const controlsShown = displayPrefs.showControls || controlsForTab;
  /** The developer console's scrollback, history and watches, kept while the panel is hidden. */
  const consoleSession = useMemo(() => new ConsoleSession(), []);
  /** True when the console key showed the console: its input then takes focus. */
  const [consoleFocus, setConsoleFocus] = useState(false);

  /** `stay` keeps an info notice until dismissed, for one too long to read in a few seconds. */
  const notify = useCallback((kind: Notice["kind"], text: string, stay = false) => {
    const id = ++noticeId.current;
    setNotices((current) => [...current, { id, kind, text }]);
    if (kind === "info" && !stay) setTimeout(() => setNotices((current) => current.filter((notice) => notice.id !== id)), INFO_NOTICE_MS);
    return id;
  }, []);

  const tuneProblem = useCallback((message: string) => void notify("warning", message), [notify]);
  const { tune, open: openTune, apply: applyTune } = useTune(storage, tuneProblem);

  const holdFastForward = useCallback((source: FastForwardSource, held: boolean) => {
    setFastForwardHeld((current) => {
      if (current.has(source) === held) return current;
      const next = new Set(current);
      if (held) next.add(source);
      else next.delete(source);
      return next;
    });
  }, []);

  /** Mirrors persistence for onSaved, which the player calls between renders. */
  const persistenceRef = useRef<Persistence>("not-asked");
  const changePersistence = useCallback((state: Persistence) => {
    persistenceRef.current = state;
    setPersistence(state);
  }, []);

  useEffect(() => {
    let current = true;
    void currentPersistence(storageApi).then(
      // A request already made after a save has the newer answer.
      (state) => current && !persistenceAsked.current && changePersistence(state),
      (error: unknown) => current && notify("error", `The browser could not say whether it keeps your saves: ${errorText(error)}`),
    );
    return () => {
      current = false;
    };
  }, [storageApi, changePersistence, notify]);

  /**
   * After the first save, asks the browser to keep the page's data, and says
   * what it answered. Not asked when the page keeps nothing (no IndexedDB) or
   * the browser has agreed already.
   */
  const onSaved = useCallback(() => {
    if (persistenceAsked.current || persistenceRef.current !== "not-asked") return;
    persistenceAsked.current = true;
    changePersistence("asking");
    requestPersistence(storageApi).then(
      (answer) => {
        changePersistence(answer);
        const notice = PERSISTENCE_NOTICE[answer];
        if (notice) notify(notice.kind, notice.text);
      },
      (error: unknown) => {
        changePersistence("denied");
        notify("warning", `The browser was asked to keep your saves and refused: ${errorText(error)}`);
      },
    );
  }, [storageApi, changePersistence, notify]);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  useEffect(() => {
    if (initialBindings.problem) notify("error", initialBindings.problem);
    if (initialTouch.problem) notify("error", initialTouch.problem);
    if (initialDisplay.problem) notify("error", initialDisplay.problem);
    if (initialReplay.problem) notify("error", initialReplay.problem);
  }, [initialBindings, initialTouch, initialDisplay, initialReplay, notify]);

  useEffect(() => {
    let cancelled = false;
    const opening = openGameStore(browserIndexedDb(), {
      onBlocked: () => {
        if (!cancelled && blockedNotice.current === null) blockedNotice.current = notify("error", BLOCKED_MESSAGE);
      },
      onReplaced: () => {
        if (!cancelled) notify("error", REPLACED_MESSAGE);
      },
    });
    storeOpening.current = opening;
    void opening.then(async (result) => {
      if (cancelled) return;
      const blocked = blockedNotice.current;
      if (blocked !== null) setNotices((current) => current.filter((notice) => notice.id !== blocked));
      storeIsOpen.current = true;
      setOpened(result);
      if (result.problem) notify("error", result.problem);
      try {
        setGames(await result.store.listGames());
      } catch (error) {
        notify("error", `The library could not be read: ${errorText(error)}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const refreshSlots = useCallback(async () => {
    const player = playerRef.current;
    if (!player?.loadedGame) return;
    try {
      setSlots(await player.listStates());
    } catch (error) {
      notify("error", `The save slots could not be read: ${errorText(error)}`);
    }
  }, [notify]);

  const openMenu = useCallback(() => {
    const player = playerRef.current;
    if (!player?.loadedGame || menuOpenRef.current) return;
    player.pause("user");
    // Buttons held when the menu opens would otherwise stay down in the game.
    latchRef.current?.releaseSource("keyboard");
    latchRef.current?.releaseSource("mouse");
    latchRef.current?.releaseSource("gamepad");
    latchRef.current?.releaseSource("touch");
    mouseHeld.current.clear();
    setFastForwardHeld(new Set());
    menuOpenRef.current = true;
    setMenuOpen(true);
    void refreshSlots();
  }, [refreshSlots]);

  const closeMenu = useCallback(() => {
    if (!menuOpenRef.current) return;
    menuOpenRef.current = false;
    setMenuOpen(false);
    setRebinding(null);
    playerRef.current?.resume("user");
  }, []);

  // Focus goes back to the game once the menu is gone; while it is still
  // there, it keeps focus inside itself.
  // The menu's Tools and Tune items hand focus to their panel instead.
  const menuWasOpen = useRef(false);
  useEffect(() => {
    if (menuWasOpen.current && !menuOpen && !focusLibrary.current && !toolsOpen && !tuneOpen) canvasRef.current?.focus();
    menuWasOpen.current = menuOpen;
  }, [menuOpen]);

  const toggleMenu = useCallback(() => (menuOpenRef.current ? closeMenu() : openMenu()), [openMenu, closeMenu]);

  // The player needs both the store and the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!opened || !canvas) return;
    const renderer = new ScreenRenderer(canvas);
    const getGamepads = () => (navigator.getGamepads ? navigator.getGamepads() : []);
    const player: Player = new Player({
      createCore: (callbacks) => new JsnesCore(callbacks),
      store: opened.store,
      audio,
      screen: renderer,
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
      onAnimationFrame: () => poller.poll(),
      onError: (message) => notify("error", message),
      onMovieFinished: (status) => {
        const summary = replaySummary(status);
        notify(summary.kind, summary.text);
      },
      // Data in memory alone (no IndexedDB) is gone with the page whatever the browser agrees to.
      onSaved: () => opened.store.persistent && onSavedRef.current(),
    });
    const latch = new ButtonLatch(
      (pad, button) => player.setButton(pad, button, true),
      (pad, button) => player.setButton(pad, button, false),
    );
    const router = new PadMenuRouter({
      // With no game open the pads drive the library, as they drive the open menu.
      isMenuOpen: () => menuOpenRef.current || !player.loadedGame,
      toggleMenu: () => {
        setTouchShown(false);
        toggleMenu();
      },
      command: (command) => {
        setPadInUse(true);
        setTouchShown(false);
        (menuOpenRef.current ? menuRef : libraryRef).current?.command(command);
      },
      toGame: (pad, button, pressed) => {
        if (pressed) setTouchShown(false);
        latch.set("gamepad", pad, button, pressed);
      },
    });
    const poller = new GamepadPoller(getGamepads, router.button, router.home, (held) => {
      // The open menu or the library has no game running to speed up.
      if (held && (menuOpenRef.current || !player.loadedGame)) return;
      if (held) setTouchShown(false);
      holdFastForward("gamepad", held);
    });
    playerRef.current = player;
    rendererRef.current = renderer;
    latchRef.current = latch;
    pollerRef.current = poller;
    playerReady.current.resolve(player);
    const removeDebugHandle = debugHandleWanted(window.location.search, import.meta.env.DEV) ? installDebugHandle(player, audio) : () => {};
    return () => {
      removeDebugHandle();
      void player.dispose();
      playerReady.current = deferred<Player>();
      playerRef.current = null;
      rendererRef.current = null;
      latchRef.current = null;
      pollerRef.current = null;
    };
  }, [opened, audio, notify, toggleMenu, holdFastForward]);

  const fastForwarding = fastForwardOn || fastForwardHeld.size > 0;
  useEffect(() => {
    playerRef.current?.setSpeed(fastForwarding ? displayPrefs.fastForwardSpeed : 1);
  }, [fastForwarding, displayPrefs.fastForwardSpeed, opened, game]);

  useEffect(() => saveDisplayPrefs(storage, displayPrefs), [storage, displayPrefs]);

  // A new player keeps the default length until told; a change starts the buffer over.
  useEffect(() => {
    playerRef.current?.setReplaySeconds(replaySeconds);
    saveReplaySeconds(storage, replaySeconds);
  }, [storage, replaySeconds, opened]);

  // The player polls the pads only while the game runs; the open menu and the library poll them themselves.
  useEffect(() => {
    if (game && !menuOpen) return;
    let handle = requestAnimationFrame(function poll() {
      pollerRef.current?.poll();
      handle = requestAnimationFrame(poll);
    });
    return () => cancelAnimationFrame(handle);
  }, [game, menuOpen]);

  // A key press or click means the mouse or keyboard is in use again. A key
  // press hides the touch controls; a touch brings them back unless the menu
  // turned them off. Keys typed into a text field are left out: on a phone
  // they come from the on-screen keyboard, which is touch play still, and
  // some on-screen keyboards send "Unidentified" keys or compose wherever
  // focus is.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      setPadInUse(false);
      if (isTextEntry(event.target) || event.isComposing || event.key === "Unidentified") return;
      setTouchShown(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      setPadInUse(false);
      keyboardFocus.current = false;
      lastPointerType.current = event.pointerType;
      if (event.pointerType === "touch" && touchEnabled.current) setTouchShown(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  // A mouse click on a control outside the game (Theme, a notice's Dismiss)
  // leaves focus there, and such a control keeps the game's keys; while a
  // game runs, the picture takes focus back after the click. Keyboard focus
  // moved with Tab is left alone, and so are the tools panel and the
  // console, whose keys stay in them.
  useEffect(() => {
    let pointerTarget: EventTarget | null = null;
    const onPointerDown = (event: PointerEvent) => {
      pointerTarget = event.target;
    };
    const onClick = (event: MouseEvent) => {
      const clicked = pointerTarget;
      pointerTarget = null;
      const canvas = canvasRef.current;
      if (clicked === null || !(event.target instanceof Element) || !playerRef.current?.loadedGame || menuOpenRef.current || !canvas) return;
      // A control the click removed (the menu's Tools… or Tune…, gone with the menu) leaves focus where its action put it.
      if (!event.target.isConnected) return;
      if (stageRef.current?.contains(event.target) || event.target.closest(".tools-panel, .tune-panel, .console-panel") || isTextEntry(event.target)) return;
      if (event.target.closest("button, a, select, input, label, [tabindex]")) canvas.focus();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("click", onClick);
    };
  }, []);

  const touchPlay = game !== null && touchShown;
  const stageBox = useBoxSize(stageRef, touchPlay);
  const touchPlaced = useMemo(
    () => (touchPlay && stageBox.width > 0 && stageBox.height > 0 ? placeLayout(PHONE_LAYOUT, stageBox.width, stageBox.height, touchPrefs.size) : null),
    [touchPlay, stageBox, touchPrefs.size],
  );

  // While touch controls show, the page neither scrolls, zooms nor selects text, and the side panels are not offered.
  useEffect(() => {
    document.documentElement.classList.toggle("touch-play", touchPlay);
    if (!touchPlay) latchRef.current?.releaseSource("touch");
    else {
      setToolsOpen(false);
      setTuneOpen(false);
    }
  }, [touchPlay]);

  /** The panels beside the picture are offered with a game open, outside touch play. */
  const panelsAvailable = game !== null && !touchPlay;
  const toolsAvailable = panelsAvailable && displayPrefs.developerTools;
  // Turning Developer tools off closes the tools panel, so turning it on again does not bring the panel back unasked.
  useEffect(() => {
    if (!displayPrefs.developerTools) setToolsOpen(false);
  }, [displayPrefs.developerTools]);
  const closeTools = useCallback(() => {
    setToolsOpen(false);
    canvasRef.current?.focus();
  }, []);
  const openTools = useCallback(() => {
    if (toolsAvailable) setToolsOpen(true);
  }, [toolsAvailable]);
  const toggleTools = useCallback(() => (toolsOpen ? closeTools() : openTools()), [toolsOpen, closeTools, openTools]);
  const onToolsProblem = useCallback((message: string) => notify("error", message), [notify]);
  /** The console key shows or hides the console; shown so, its input takes focus. Offered as the tools are: with Developer tools on, outside touch play. */
  const toggleConsole = useCallback(() => {
    if (!toolsAvailable) return;
    const showing = !displayPrefs.showConsole;
    setDisplayPrefs((current) => ({ ...current, showConsole: showing }));
    setConsoleFocus(showing);
  }, [toolsAvailable, displayPrefs.showConsole]);
  const leaveConsole = useCallback(() => canvasRef.current?.focus(), []);

  /** The open game's tunables and values; null for a game with no bundled tunables file. */
  const gameTune = tune && game && tune.tunables.romSha256 === game.id ? tune : null;
  const gameProfile = profile && game && profile.romSha256 === game.id ? profile.profile : null;
  const tuneAvailable = panelsAvailable && gameTune !== null;
  const closeTunePanel = useCallback(() => {
    setTuneOpen(false);
    canvasRef.current?.focus();
  }, []);
  const toggleTunePanel = useCallback(() => {
    if (tuneOpen) closeTunePanel();
    else if (tuneAvailable) setTuneOpen(true);
  }, [tuneOpen, tuneAvailable, closeTunePanel]);
  // A pause the console made ends when the console goes, so a hidden console never leaves the game stopped with nothing saying why.
  useEffect(() => {
    if (!(displayPrefs.showConsole && toolsAvailable)) playerRef.current?.resume("console");
  }, [displayPrefs.showConsole, toolsAvailable]);

  useEffect(() => saveTouchPrefs(storage, touchPrefs), [storage, touchPrefs]);

  const onTouchButton = useCallback((button: Button, pressed: boolean) => latchRef.current?.set("touch", 1, button, pressed), []);
  const onTouchFastForward = useCallback((held: boolean) => holdFastForward("touch", held), [holdFastForward]);

  const showTouch = useCallback((shown: boolean) => {
    setTouchPrefs((current) => ({ ...current, enabled: shown }));
    setTouchShown(shown);
  }, []);

  /**
   * The store once it opens; an action asked for before then says it is
   * waiting, then goes ahead. While another tab blocks the open, the blocked
   * notice stays up beside this one.
   */
  const readyStore = useCallback(async (): Promise<GameStore> => {
    const opening = storeOpening.current;
    if (!opening) throw new Error("The library was never opened.");
    if (!storeIsOpen.current) notify("info", OPENING_MESSAGE);
    return (await opening).store;
  }, [notify]);

  const refreshGames = useCallback(async () => {
    try {
      setGames(await (await readyStore()).listGames());
    } catch (error) {
      notify("error", `The library could not be read: ${errorText(error)}`);
    }
  }, [readyStore, notify]);

  /** The saved state a start begins from: none for power-on. Throws, with a message for the user, when it is gone. */
  const startState = useCallback(async (store: GameStore, id: string, from: StartFrom): Promise<StateRecord["state"] | undefined> => {
    if (from === "power-on") return undefined;
    if (from === "resume") {
      const resume = await store.getResume(id);
      if (!resume) throw new Error("it has no resume state; start it from power-on instead.");
      return resume.state;
    }
    const record = await store.getState(id, from.slot);
    if (!record) throw new Error(`slot ${from.slot} is empty; start it from power-on instead.`);
    return record.state;
  }, []);

  /**
   * The game's tunables file and profile: on the development server from the
   * local ROM folder beside it (the files a games.json entry names, when
   * given), else those kept in this browser.
   */
  const findGameFiles = useCallback(
    async (romSha256: string, fileName: string, named?: Pick<ListedGame, "tunables" | "profile">): Promise<GameFiles> => {
      const local: GameFiles = import.meta.env.DEV && hasLocalFolder() ? await localGameFiles(romSha256, fileName, named) : { tunables: null, profile: null, problems: [] };
      const keptTunables = local.tunables ? null : storedTunables(storage, romSha256);
      const keptProfile = local.profile ? null : storedProfile(storage, romSha256);
      return {
        tunables: local.tunables ?? keptTunables?.tunables ?? null,
        profile: local.profile ?? keptProfile?.profile ?? null,
        problems: [...local.problems, ...[keptTunables?.problem, keptProfile?.problem].filter((problem): problem is string => typeof problem === "string")],
      };
    },
    [storage],
  );

  const playGame = useCallback(
    async (id: string, from: StartFrom, named?: Pick<ListedGame, "tunables" | "profile">) => {
      try {
        const store = await readyStore();
        // The player is made in the render after the store opens.
        const player = await playerReady.current.promise;
        const record = await store.getRom(id);
        if (!record) {
          notify("error", "That game is no longer stored in this browser.");
          await refreshGames();
          return;
        }
        await player.open(record, await startState(store, id, from));
        const files = await findGameFiles(id, record.name, named);
        for (const problem of files.problems) notify("warning", problem);
        openTune(player, files.tunables);
        setProfile(files.profile ? { romSha256: id, profile: files.profile } : null);
        await store.markPlayed(id);
        setVideo(player.video);
        setGame(player.loadedGame);
        // F5 and F7 go on with the slot the game was opened from.
        if (typeof from === "object") setSlot(from.slot);
      } catch (error) {
        notify("error", `The game could not be opened: ${errorText(error)}`);
      }
    },
    [readyStore, refreshGames, startState, notify, openTune, findGameFiles],
  );

  /** A tunables file or game profile picked in the page: kept for the open game and used at once. */
  const loadGameFile = useCallback(
    async (file: File): Promise<"tunables" | "profile" | null> => {
      const player = playerRef.current;
      const id = player?.loadedGame?.id;
      if (!player || !id) return null;
      try {
        const loaded = readGameFile(await file.text(), file.name, id);
        if (loaded.kind === "tunables") {
          storeTunables(storage, loaded.tunables);
          openTune(player, loaded.tunables);
          notify("info", `Loaded ${file.name}: the Tune panel has ${loaded.tunables.values.length} values for this game.`);
        } else {
          storeProfile(storage, id, loaded.profile);
          setProfile({ romSha256: id, profile: loaded.profile });
          notify("info", `Loaded ${file.name}: the console has ${loaded.profile.title}'s values and commands.`);
        }
        return loaded.kind;
      } catch (error) {
        notify("error", errorText(error));
        return null;
      }
    },
    [storage, openTune, notify],
  );

  const saveTuneVersion = useCallback(
    async (gameId: string, tunables: Tunables, values: TunedValues) => {
      try {
        const version = await saveTunedVersion(await readyStore(), gameId, tunables, values);
        const base = version.patchName.replace(/\.bps$/, "");
        downloadBlob(new Blob([version.bps as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }), version.patchName);
        downloadBlob(new Blob([version.valuesJson], { type: "application/json" }), `${base}.json`);
        const title = displayTitle(version.result.game).title;
        notify("info", version.result.duplicate ? `That version is already in the library as “${title}”.` : `Saved “${title}” to the library; ${version.patchName} is downloading.`);
      } catch (error) {
        notify("error", `The version could not be saved: ${errorText(error)}`);
      }
      await refreshGames();
    },
    [readyStore, refreshGames, notify],
  );

  /**
   * Each file is checked and added; a ROM already in the library (same
   * SHA-256) is named, not added again. A single new file starts at once:
   * picking one game means playing it; several only fill the library.
   */
  const addFiles = useCallback(
    async (files: File[]) => {
      let store: GameStore;
      try {
        store = await readyStore();
      } catch (error) {
        notify("error", `The games could not be added: ${errorText(error)}`);
        return;
      }
      const added: GameRecord[] = [];
      for (const file of files) {
        try {
          const data = new Uint8Array(await file.arrayBuffer());
          const parsed = parseInes(data);
          if (!parsed.ok) {
            notify("error", `${file.name}: ${parsed.error}`);
            continue;
          }
          const result = await store.addRom(file.name, data);
          if (result.duplicate) notify("info", `${file.name} is already in the library as “${displayTitle(result.game).title}”.`);
          else added.push(result.game);
        } catch (error) {
          notify("error", `${file.name} could not be added: ${errorText(error)}`);
        }
      }
      if (added.length > 0) notify("info", added.length === 1 ? "Added 1 game." : `Added ${added.length} games.`);
      await refreshGames();
      if (files.length === 1 && added.length === 1) await playGame(added[0].id, "power-on");
    },
    [readyStore, refreshGames, playGame, notify],
  );

  useEffect(() => {
    if (testLink?.ok && "label" in testLink && testLink.label) document.title = `${testLink.label} · retrowright`;
  }, [testLink]);

  /** A game's saves for the library's choice; null, with a notice, when they cannot be read. */
  const loadSaves = useCallback(
    async (id: string): Promise<GameSaves | null> => {
      try {
        return await gameSaves(await readyStore(), id);
      } catch (error) {
        notify("error", `The game's saves could not be read: ${errorText(error)}`);
        return null;
      }
    },
    [readyStore, notify],
  );

  const changeGame = useCallback(
    async (change: (store: GameStore) => Promise<void>, failure: string) => {
      try {
        await change(await readyStore());
      } catch (error) {
        notify("error", `${failure}: ${errorText(error)}`);
      }
      await refreshGames();
    },
    [readyStore, refreshGames, notify],
  );

  const onAddFiles = useCallback((files: File[]) => void addFiles(files), [addFiles]);

  /** Applies a patch file to a game; the patched ROM joins the library as its own game, and the original stays. */
  const applyPatchFile = useCallback(
    async (id: string, file: File) => {
      try {
        const result = await addPatchedGame(await readyStore(), id, file.name, new Uint8Array(await file.arrayBuffer()));
        const title = displayTitle(result.game).title;
        notify("info", result.duplicate ? `The patched game is already in the library as “${title}”.` : `Patched with ${file.name}: added “${title}”.`);
      } catch (error) {
        notify("error", `${file.name} could not be applied: ${errorText(error)}`);
      }
      await refreshGames();
    },
    [readyStore, refreshGames, notify],
  );

  const readStorageUse = useCallback(() => storageUse(storageApi), [storageApi]);

  const exportBackup = useCallback(
    async ({ gameId, includeRoms }: ExportRequest) => {
      try {
        const store = await readyStore();
        // A backup of one game carries its saves alone; the page's settings come with a whole backup.
        const settings = gameId === null && storage ? settingsSnapshot(storage) : null;
        const backup = await buildBackup(store, { gameIds: gameId === null ? undefined : [gameId], includeRoms, settings, now: Date.now() });
        const one = gameId === null ? undefined : (await store.listGames()).find((game) => game.id === gameId);
        const name = one ? displayTitle(one).title.replace(/[\\/:*?"<>|]/g, "") : "retrowright";
        downloadJson(serializeBackup(backup), `${name}-saves-${fileStamp()}${BACKUP_EXTENSION}`);
        const games = backup.saves.length === 1 ? "1 game" : `${backup.saves.length} games`;
        notify("info", `Exported the saves of ${games}; the file is downloading.`);
      } catch (error) {
        notify("error", `The saves could not be exported: ${errorText(error)}`);
      }
    },
    [readyStore, storage, notify],
  );

  /** Merges a backup into this browser, then reads the library and the settings it may have brought again. */
  const importBackup = useCallback(
    async (file: File) => {
      try {
        const backup = parseBackup(JSON.parse(await file.text()));
        const report = await restoreBackup(await readyStore(), backup, storage);
        if (report.settingsRestored) {
          // Each setting from the file is checked as it is read; one that cannot be read says so and keeps the defaults.
          const restoredBindings = loadBindings(storage);
          const restoredTouch = loadTouchPrefs(storage);
          const restoredDisplay = loadDisplayPrefs(storage);
          const restoredReplay = loadReplaySeconds(storage);
          setBindings(restoredBindings.bindings);
          setTheme(loadTheme(storage));
          setTouchPrefs(restoredTouch.prefs);
          setDisplayPrefs(restoredDisplay.prefs);
          setReplaySeconds(restoredReplay.seconds);
          setLibraryKey((key) => key + 1);
          // Written back at once: when a setting falls back to the defaults the state may not change, and the unreadable value would stay stored.
          saveBindings(storage, restoredBindings.bindings);
          saveTouchPrefs(storage, restoredTouch.prefs);
          saveDisplayPrefs(storage, restoredDisplay.prefs);
          saveReplaySeconds(storage, restoredReplay.seconds);
          for (const problem of [restoredBindings.problem, restoredTouch.problem, restoredDisplay.problem, restoredReplay.problem]) if (problem) notify("error", problem);
        }
        // Several sentences long: it stays until dismissed.
        notify("info", restoreSummary(report), true);
      } catch (error) {
        notify("error", `${file.name} could not be imported: ${errorText(error)}`);
      }
      await refreshGames();
    },
    [readyStore, storage, refreshGames, notify],
  );

  /** Stores the open game as its resume state, with the picture now, for Continue. */
  const saveResume = useCallback(async () => {
    const player = playerRef.current;
    if (!player?.loadedGame) return;
    try {
      await player.saveResume(rendererRef.current?.thumbnail() ?? null);
    } catch (error) {
      notify("error", `The game could not be kept for Continue: ${errorText(error)}`);
    }
  }, [notify]);

  const saveState = useCallback(
    async (target: StateSlot) => {
      const player = playerRef.current;
      if (!player?.loadedGame) return;
      try {
        await player.saveState(target, rendererRef.current?.thumbnail() ?? null);
        setSlot(target);
        notify("info", `Saved to slot ${target}.`);
        await refreshSlots();
      } catch (error) {
        notify("error", `The state could not be saved: ${errorText(error)}`);
      }
    },
    [notify, refreshSlots],
  );

  const loadState = useCallback(
    async (target: StateSlot) => {
      const player = playerRef.current;
      if (!player?.loadedGame) return;
      try {
        const loaded = await player.loadState(target);
        if (loaded) setSlot(target);
        notify("info", loaded ? `Loaded slot ${target}.` : `Slot ${target} is empty.`);
      } catch (error) {
        notify("error", `The state could not be loaded: ${errorText(error)}`);
      }
    },
    [notify],
  );

  /** Downloads the frame now as a PNG at the core's own size, named after the game and the time, and resolves to what it says. */
  const saveScreenshot = useCallback(async (): Promise<string> => {
    const picture = playerRef.current?.picture();
    const name = playerRef.current?.loadedGame?.name;
    if (!picture || !name) throw new Error("No game is open.");
    const fileName = screenshotFileName(name.replace(/\.nes$/i, ""), new Date());
    downloadBlob(await encodeScreenshot(picture.pixels, picture.video), fileName);
    return `Screenshot saved as ${fileName}.`;
  }, []);

  const takeScreenshot = useCallback(async () => {
    if (!playerRef.current?.loadedGame) return;
    try {
      notify("info", await saveScreenshot());
    } catch (error) {
      notify("error", `The screenshot could not be saved: ${errorText(error)}`);
    }
  }, [notify, saveScreenshot]);

  const reset = useCallback(() => {
    try {
      playerRef.current?.reset();
      notify("info", "Reset.");
    } catch (error) {
      notify("error", errorText(error));
    }
  }, [notify]);

  const quit = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    await saveResume();
    await player.close();
    // Closing the menu after the game clears its pause, so the next game starts running.
    closeMenu();
    focusLibrary.current = true;
    setToolsOpen(false);
    setTuneOpen(false);
    setGame(null);
    setVideo(null);
    setFastForwardOn(false);
    setFastForwardHeld(new Set());
    setSlots([]);
    setMovieStatus(IDLE_MOVIE);
    setSlot(FIRST_SLOT);
    setRecordChoice(FIRST_RECORD_CHOICE);
    await refreshGames();
  }, [closeMenu, refreshGames, saveResume]);

  // The picture takes focus once its section shows: a browser does not focus
  // a canvas whose section is still hidden, and the mouse acts only on a focused picture.
  useEffect(() => {
    if (game) canvasRef.current?.focus();
  }, [game]);

  useEffect(() => {
    if (game || !focusLibrary.current) return;
    focusLibrary.current = false;
    libraryRef.current?.focusStart();
  }, [game, games]);

  const toggleRecord = useCallback(() => {
    const player = playerRef.current;
    if (!player?.loadedGame) return;
    try {
      if (player.movieStatus().mode === "recording") {
        const movie = player.stopRecording();
        downloadMovie(movie);
        notify("info", `Recorded ${movie.frames} frames; the movie file is downloading.`);
      } else {
        markCount.current = 0;
        player.startRecording(RECORD_CHOICES[recordChoice].start);
      }
    } catch (error) {
      notify("error", errorText(error));
    }
    // A stop that saved nothing still ends the recording.
    setMovieStatus(player.movieStatus());
  }, [recordChoice, notify]);

  const markCheckpoint = useCallback(() => {
    const player = playerRef.current;
    if (!player?.loadedGame) return;
    if (player.movieStatus().mode !== "recording") {
      notify("info", "Marks are added while recording; nothing was marked.");
      return;
    }
    const checkpoint = player.mark(`mark ${++markCount.current}`);
    notify("info", `Marked "${checkpoint.name}" at frame ${checkpoint.frame}.`);
  }, [notify]);

  /** Downloads the instant replay as a movie, named after the game and the time. */
  const saveReplay = useCallback(() => {
    const player = playerRef.current;
    if (!player?.loadedGame) return;
    try {
      const movie = player.saveReplay();
      downloadMovie(movie, "replay");
      const seconds = Math.round(movie.frames / (player.video?.frameRate ?? 60));
      notify("info", `Saved the last ${seconds} seconds (${movie.frames} frames) as a movie; the file is downloading.`);
    } catch (error) {
      notify("error", errorText(error));
    }
  }, [notify]);

  /** Plays a movie file's text in the open game; a movie of another ROM is refused with the player's message. */
  const playMovieText = useCallback(
    (text: string, fileName: string) => {
      const player = playerRef.current;
      if (!player?.loadedGame) return;
      try {
        player.playMovie(parseMovie(JSON.parse(text)));
        setMovieStatus(player.movieStatus());
        closeMenu();
      } catch (error) {
        notify("error", `${fileName} could not be played: ${errorText(error)}`);
      }
    },
    [notify, closeMenu],
  );

  const playMovieFile = useCallback(async (file: File) => playMovieText(await file.text(), file.name), [playMovieText]);

  /** What the developer console drives: the player, and the page's saves, screenshots and movies, each answering in a sentence. */
  const consoleHost = useMemo((): ConsoleHost => {
    const open = (): Player => {
      const player = playerRef.current;
      if (!player?.loadedGame) throw new Error("No game is open.");
      return player;
    };
    return {
      memory: { peek: (address) => open().peek(address), poke: (address, value) => open().poke(address, value), palette: () => open().palette() },
      isPaused: () => playerRef.current?.isPausedBy("console") ?? false,
      pause: () => open().pause("console"),
      resume: () => open().resume("console"),
      step: (frames) => open().step(frames),
      waitFrames: async (frames) => {
        const player = open();
        if (player.isPausedBy("console")) {
          player.step(frames);
          return;
        }
        const until = player.framesRun + frames;
        while (player.framesRun < until) {
          await new Promise((resolve) => setTimeout(resolve, FRAME_POLL_MS));
          if (playerRef.current !== player || !player.loadedGame) throw new Error("The game closed while the command waited.");
        }
      },
      framesRun: () => open().framesRun,
      rate: () => open().rate,
      setRate: (rate) => open().setRate(rate),
      reset: () => open().reset(),
      saveState: async (target) => {
        await open().saveState(target, rendererRef.current?.thumbnail() ?? null);
        setSlot(target);
        await refreshSlots();
        return `Saved to slot ${target}.`;
      },
      loadState: async (target) => {
        const loaded = await open().loadState(target);
        if (!loaded) return `Slot ${target} is empty.`;
        setSlot(target);
        return `Loaded slot ${target}.`;
      },
      screenshot: saveScreenshot,
      record: () => {
        const player = open();
        if (player.movieStatus().mode !== "idle") throw new Error("A movie is already recording or playing; stop ends it.");
        markCount.current = 0;
        player.startRecording(RECORD_CHOICES[recordChoice].start);
        setMovieStatus(player.movieStatus());
        return `Recording from ${RECORD_CHOICES[recordChoice].label}; stop ends it and downloads the movie.`;
      },
      stop: () => {
        const player = open();
        const mode = player.movieStatus().mode;
        if (mode === "playing") {
          player.stopMovie();
          setMovieStatus(player.movieStatus());
          return "Stopped the movie; the game goes on.";
        }
        if (mode !== "recording") throw new Error("Nothing is recording or playing.");
        try {
          const movie = player.stopRecording();
          downloadMovie(movie);
          return `Recorded ${movie.frames} frames; the movie file is downloading.`;
        } finally {
          // A stop that saved nothing still ends the recording.
          setMovieStatus(player.movieStatus());
        }
      },
      replay: () => {
        const player = open();
        const movie = player.saveReplay();
        downloadMovie(movie, "replay");
        return `Saved the last ${Math.round(movie.frames / (player.video?.frameRate ?? 60))} seconds (${movie.frames} frames) as a movie; the file is downloading.`;
      },
    };
  }, [recordChoice, refreshSlots, saveScreenshot]);

  // A watch or a value of the last game means nothing in the next.
  useEffect(() => {
    consoleSession.watches.splice(0);
  }, [consoleSession, game?.id]);

  // A test link fetches its ROM from the development server, adds it to the
  // library unless it is there already (so its saves are kept as any game's),
  // and starts it from power-on; with a movie, it then plays the movie from
  // the movie's own start. A movie that cannot be fetched leaves the game running.
  useEffect(() => {
    if (!import.meta.env.DEV || !testLink || testLinkStarted.current) return;
    testLinkStarted.current = true;
    if (!testLink.ok) {
      notify("error", testLink.problem);
      return;
    }
    if ("gameId" in testLink) {
      void (async () => {
        try {
          const games = await localGamesList();
          const listed = games.find((game) => game.id === testLink.gameId);
          if (!listed) {
            notify("error", `Test link: game=${testLink.gameId} is not in the local ROM folder's games.json${games.length ? `, which lists ${games.map((game) => game.id).join(", ")}` : ", which lists none"}.`);
            return;
          }
          namedFiles.current = { tunables: listed.tunables, profile: listed.profile };
          testLinkStarted.current = false;
          setTestLink(listedGameLink(listed));
        } catch (error) {
          notify("error", `Test link: game=${testLink.gameId} could not be opened: ${errorText(error)}`);
        }
      })();
      return;
    }
    void (async () => {
      try {
        const response = await fetch(testLink.url);
        if (!response.ok) {
          notify("error", missingTestFile(testLink.fileName, response.status, await response.text()));
          return;
        }
        const data = new Uint8Array(await response.arrayBuffer());
        const parsed = parseInes(data);
        if (!parsed.ok) {
          notify("error", `${testLink.fileName}: ${parsed.error}`);
          return;
        }
        let movieText: string | null = null;
        if (testLink.movie) {
          const movieResponse = await fetch(testLink.movie.url);
          if (movieResponse.ok) movieText = await movieResponse.text();
          else notify("error", missingTestFile(testLink.movie.fileName, movieResponse.status, await movieResponse.text()));
        }
        const store = await readyStore();
        const { game } = await store.addRom(testLink.fileName, data);
        if (testLink.title && game.title !== testLink.title) await store.renameGame(game.id, testLink.title);
        await refreshGames();
        await playGame(game.id, "power-on", namedFiles.current);
        if (movieText !== null && testLink.movie && playerRef.current?.loadedGame?.id === game.id) playMovieText(movieText, testLink.movie.fileName);
      } catch (error) {
        notify("error", `Test link: “${testLink.fileName}” could not be opened: ${errorText(error)}`);
      }
    })();
  }, [testLink, readyStore, refreshGames, playGame, playMovieText, notify]);

  // The movie indicator follows the player's frame count while a movie records or plays.
  useEffect(() => {
    if (!game) return;
    const timer = setInterval(() => setMovieStatus(playerRef.current?.movieStatus() ?? IDLE_MOVIE), MOVIE_STATUS_MS);
    return () => clearInterval(timer);
  }, [game]);

  // Keyboard and mouse: game buttons, hotkeys, Esc for the menu, and the key or mouse button being rebound.
  useEffect(() => {
    const finishRebinding = (target: BindingTarget, code: string) => changeBindings(bindTarget(bindings, target, code));
    /** A hotkey's action when its key or mouse button goes down; fast-forward is held instead, by its source. */
    const runHotkey = (action: Action) => {
      if (action === Hotkey.Screenshot) void takeScreenshot();
      else if (action === Hotkey.SaveState) void saveState(slot);
      else if (action === Hotkey.LoadState) void loadState(slot);
      else if (action === Hotkey.Record) toggleRecord();
      else if (action === Hotkey.Mark) markCheckpoint();
      else if (action === Hotkey.Tools) toggleTools();
      else if (action === Hotkey.SaveReplay) saveReplay();
      else if (action === Hotkey.Console) toggleConsole();
      else if (action === Hotkey.Tune) toggleTunePanel();
      else {
        const chosen = SLOT_HOTKEYS[action];
        if (chosen) {
          setSlot(chosen);
          notify("info", `Slot ${chosen} chosen.`);
        }
      }
    };
    /**
     * Whether the focused element takes the game buttons' keys (Enter, Space,
     * the arrows) for itself. A control outside the game section always does;
     * one in the play bar only after Tab reached it, because a click leaves
     * focus on Mute or Menu and the keys must then drive the game again.
     */
    const keepsButtonKeys = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      target !== document.body &&
      target !== canvasRef.current &&
      (keyboardFocus.current || !stageRef.current?.contains(target));
    const onKeyDown = (event: KeyboardEvent) => {
      if (rebinding) {
        event.preventDefault();
        if (event.code !== "Escape") finishRebinding(rebinding, event.code);
        setRebinding(null);
        return;
      }
      if (!playerRef.current?.loadedGame) return;
      if (menuOpenRef.current) {
        // The open menu handles its own keys; F5 must still not reload the page. Tab (fast-forward) moves focus in the menu.
        const action = actionForCode(bindings, event.code);
        if (action && action !== Hotkey.FastForward && !padButtonOf(action)) event.preventDefault();
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        openMenu();
        return;
      }
      if (isTextEntry(event.target)) return;
      // Tab fast-forwards only from the picture; elsewhere, and always with
      // Shift, it moves focus, so the keyboard alone reaches Menu, Mute and
      // the volume slider while a game runs. A control reached that way keeps
      // the game buttons' keys until the next click (see keepsButtonKeys);
      // hotkeys still act, so F5 saves instead of reloading the page.
      if (event.code === "Tab") {
        const fromPicture = event.target === canvasRef.current && !event.shiftKey;
        keyboardFocus.current = !fromPicture;
        if (!fromPicture) return;
      }
      const pads = padButtonsForCode(bindings, event.code);
      if (pads.length > 0) {
        if (keepsButtonKeys(event.target)) return;
        event.preventDefault();
        for (const { player, button } of pads) latchRef.current?.set(`keyboard:${event.code}`, player, button, true);
        return;
      }
      const action = actionForCode(bindings, event.code);
      if (!action) return;
      event.preventDefault();
      if (event.repeat) return;
      else if (action === Hotkey.FastForward) holdFastForward("keyboard", true);
      else runHotkey(action);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const action = actionForCode(bindings, event.code);
      if (action === Hotkey.FastForward) {
        event.preventDefault();
        holdFastForward("keyboard", false);
      } else if (padButtonsForCode(bindings, event.code).length > 0) {
        // A button activates on Space's keyup, so a control keeping the keys keeps that too.
        if (!keepsButtonKeys(event.target)) event.preventDefault();
        latchRef.current?.releaseSource(`keyboard:${event.code}`);
      }
    };

    // The mouse acts only over the picture, and only once the picture has
    // focus: a click that gives focus back to it (from a control, the tools
    // panel or another window) presses nothing. Elsewhere it works as normal.
    const onMouseDown = (event: MouseEvent) => {
      const code = mouseCode(event.button);
      if (rebinding) {
        // Kept from the page: the click must not also press the control under the pointer.
        event.preventDefault();
        event.stopPropagation();
        swallowAfterBinding.current = { click: event.button === 0, contextMenu: event.button === 2 };
        finishRebinding(rebinding, code);
        setRebinding(null);
        return;
      }
      const resumed = clickResumed.current;
      clickResumed.current = false;
      const canvas = canvasRef.current;
      if (!canvas || event.target !== canvas || resumed || document.activeElement !== canvas || lastPointerType.current === "touch") return;
      if (!playerRef.current?.loadedGame || menuOpenRef.current || mouseHeld.current.has(event.button)) return;
      const pads = padButtonsForCode(bindings, code);
      const action = actionForCode(bindings, code);
      if (pads.length === 0 && !action) return;
      event.preventDefault();
      if (pads.length > 0) {
        mouseHeld.current.set(event.button, "pad");
        for (const { player, button } of pads) latchRef.current?.set(`mouse:${code}`, player, button, true);
      } else if (action) {
        mouseHeld.current.set(event.button, action);
        if (action === Hotkey.FastForward) holdFastForward("mouse", true);
        else runHotkey(action);
      }
    };
    const releaseMouse = (button: number) => {
      const held = mouseHeld.current.get(button);
      if (held === undefined) return;
      mouseHeld.current.delete(button);
      if (held === "pad") latchRef.current?.releaseSource(`mouse:${mouseCode(button)}`);
      else if (held === Hotkey.FastForward) holdFastForward("mouse", false);
    };
    // On the window, so a button let go outside the picture is let go in the game too.
    const onMouseUp = (event: MouseEvent) => releaseMouse(event.button);
    const onClick = (event: MouseEvent) => {
      if (!swallowAfterBinding.current.click) return;
      swallowAfterBinding.current.click = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const onContextMenu = (event: MouseEvent) => {
      const swallow = swallowAfterBinding.current.contextMenu;
      swallowAfterBinding.current.contextMenu = false;
      if (swallow || event.target === canvasRef.current) event.preventDefault();
    };
    const onBlur = () => {
      latchRef.current?.releaseSource("keyboard");
      holdFastForward("keyboard", false);
      for (const button of [...mouseHeld.current.keys()]) releaseMouse(button);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [bindings, changeBindings, rebinding, slot, saveState, loadState, toggleRecord, markCheckpoint, saveReplay, openMenu, notify, holdFastForward, takeScreenshot, toggleTools, toggleConsole, toggleTunePanel]);

  // Pause while the tab is hidden; store battery RAM and the resume state when
  // the tab hides or the page goes away (a closing tab is hidden first in most
  // browsers, and pagehide covers the rest).
  useEffect(() => {
    const onVisibility = () => {
      const player = playerRef.current;
      if (!player) return;
      if (document.hidden) {
        latchRef.current?.releaseSource("keyboard");
        player.pause("hidden");
        void saveResume();
      } else {
        player.resume("hidden");
      }
    };
    const onPageHide = () => {
      void saveResume();
      void playerRef.current?.saveBatteryRam();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [saveResume]);

  // A running game pauses when the window loses focus, since its keys no
  // longer reach the page; a click or key press on the page resumes it.
  useEffect(() => {
    if (!game) return;
    const onBlur = () => {
      const player = playerRef.current;
      if (!player?.loadedGame || menuOpenRef.current || document.hidden) return;
      player.pause("focus");
      setFocusPaused(true);
    };
    const onReturn = (event?: Event) => {
      const player = playerRef.current;
      if (!player?.isPausedBy("focus")) return;
      player.resume("focus");
      setFocusPaused(false);
      if (event?.type === "pointerdown") clickResumed.current = true;
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", onReturn, true);
    window.addEventListener("keydown", onReturn, true);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onReturn, true);
      window.removeEventListener("keydown", onReturn, true);
      onReturn();
    };
  }, [game]);

  // Browsers allow sound only after a user gesture; start it on the first one.
  useEffect(() => {
    const start = () => {
      window.removeEventListener("pointerdown", start, true);
      window.removeEventListener("keydown", start, true);
      setSoundStarted(true);
      audio
        .start()
        .then(() => setAudioState(audio.getStats().state))
        .catch((error: unknown) => {
          setAudioState("unavailable");
          notify("error", `No sound: ${errorText(error)}`);
        });
    };
    window.addEventListener("pointerdown", start, true);
    window.addEventListener("keydown", start, true);
    return () => {
      window.removeEventListener("pointerdown", start, true);
      window.removeEventListener("keydown", start, true);
    };
  }, [audio, notify]);

  useEffect(() => audio.setVolume(volume), [audio, volume]);
  useEffect(() => audio.setMuted(muted), [audio, muted]);

  useEffect(() => {
    const onConnect = (event: GamepadEvent) => setGamepad(event.gamepad.id);
    const onDisconnect = () => setGamepad(null);
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);
    return () => {
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
    };
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const request = document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen();
    request?.catch((error: unknown) => notify("error", `Fullscreen was refused: ${errorText(error)}`));
  }, [notify]);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(storage, theme);
  }, [theme, storage]);

  const onOfflineReady = useCallback(() => notify("info", "retrowright is kept in this browser: it now opens without a network."), [notify]);
  const onUpdateError = useCallback((message: string) => notify("error", message), [notify]);
  const keepGameForReload = useCallback(async () => {
    await saveResume();
    await playerRef.current?.saveBatteryRam();
  }, [saveResume]);

  const noticeView = (notice: Notice) => (
    <p key={notice.id} className={`notice ${notice.kind}`}>
      <span>{notice.text}</span>
      <button type="button" aria-label="Dismiss" onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}>
        ×
      </button>
    </p>
  );

  const controlsPanelShown = controlsShown && panelsAvailable;
  const tunePanelShown = tuneOpen && tuneAvailable;
  const toolsPanelShown = toolsOpen && toolsAvailable;
  const consoleShown = displayPrefs.showConsole && toolsAvailable;
  const besideClasses = `${controlsPanelShown ? " with-controls" : ""}${tunePanelShown ? " with-tune" : ""}${toolsPanelShown ? " with-tools" : ""}${consoleShown ? " with-console" : ""}`;
  const sidePanelsShown = controlsPanelShown || tunePanelShown || toolsPanelShown || consoleShown;
  const consoleTable = consoleShown ? consoleTableFor(playerRef.current?.gameMapId ?? null, gameProfile) : null;

  return (
    <div className={`app${besideClasses}`}>
      {testLink?.ok && "label" in testLink && testLink.label && (
        <p className="test-label" role="note" aria-label={`Test link: ${testLink.label}`}>
          {testLink.label}
        </p>
      )}
      <header className="top">
        <h1>retrowright</h1>
        <span className="subtitle">NES in the browser</span>
        <button type="button" className="theme" onClick={() => setTheme(nextTheme(theme))} aria-label={`Theme: ${theme}`}>
          Theme: {theme}
        </button>
      </header>

      {/* Saves, loads, imports and updates are read out politely; errors interrupt. Both regions stay mounted, so a screen reader hears what is added. */}
      <div className="notices">
        <div role="status" aria-live="polite">
          {notices.filter((notice) => notice.kind !== "error").map(noticeView)}
          <UpdateNotice onOfflineReady={onOfflineReady} onError={onUpdateError} beforeReload={keepGameForReload} />
        </div>
        <div role="alert">{notices.filter((notice) => notice.kind === "error").map(noticeView)}</div>
      </div>

      <main className={`layout${besideClasses}`}>
        {/* Deliberate: hidden, not unmounted, while the library shows: the player keeps drawing to this canvas. */}
        <section className={touchPlay ? "stage touch-play" : "stage"} aria-label="Game" ref={stageRef} hidden={!game}>
          {/* Deliberate: the Screen keeps its place in the tree in touch play too: a new canvas would leave the player drawing to the old one. */}
          <Screen
            ref={canvasRef}
            label={game ? `${game.name} screen` : "Game screen"}
            video={video}
            display={displayPrefs}
            fit={touchPlaced?.screen}
            corner={
              game && (
                <>
                  {!touchPlay && (
                    <button type="button" className="menu-corner" aria-label="Open menu" aria-haspopup="dialog" onClick={openMenu}>
                      ☰
                    </button>
                  )}
                  {focusPaused ? (
                    <p className="screen-message focus-paused">Paused: click to resume</p>
                  ) : (
                    !soundStarted && <p className="screen-message sound-hint">Click or press a key to start sound</p>
                  )}
                </>
              )
            }
          />
          {touchPlaced && (
            <TouchControls placed={touchPlaced} opacity={touchPrefs.opacity} vibrate={touchPrefs.vibrate} paused={menuOpen} onButton={onTouchButton} onMenu={openMenu} onFastForward={onTouchFastForward} />
          )}
          <div className="bar play-bar" hidden={touchPlay}>
            <button type="button" className="menu-open" aria-haspopup="dialog" onClick={openMenu} disabled={!game}>
              Menu <kbd>Esc</kbd>
            </button>
            <button type="button" className="mute" onClick={() => setMuted(!muted)} aria-pressed={muted}>
              {muted ? "Unmute" : "Mute"}
            </button>
            <label className="volume">
              Volume
              <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
            </label>
            <MovieIndicator status={movieStatus} />
            {soundStarted && audioState !== "running" && <span className="hint">Sound: {audioState}</span>}
          </div>
          {menuOpen && game && video && (
            <QuickMenu
              video={video}
              displayPrefs={displayPrefs}
              fastForwardOn={fastForwardOn}
              onDisplayPrefs={setDisplayPrefs}
              controlsShown={controlsShown}
              onControlsShown={(shown) => {
                setControlsForTab(false);
                setDisplayPrefs((current) => ({ ...current, showControls: shown }));
              }}
              onToggleFastForward={() => setFastForwardOn(!fastForwardOn)}
              onScreenshot={() => void takeScreenshot()}
              toolsAvailable={toolsAvailable}
              onTools={() => {
                setToolsOpen(true);
                closeMenu();
              }}
              tuneAvailable={tuneAvailable}
              onTune={() => {
                setTuneOpen(true);
                closeMenu();
              }}
              loadTunablesAvailable={panelsAvailable && !tuneAvailable}
              onLoadGameFile={(file) => {
                closeMenu();
                void loadGameFile(file).then((kind) => kind === "tunables" && setTuneOpen(true));
              }}
              ref={menuRef}
              gameName={game.name.replace(/\.nes$/i, "")}
              slots={slots}
              currentSlot={slot}
              movieStatus={movieStatus}
              recordChoice={recordChoice}
              bindings={bindings}
              rebinding={rebinding}
              gamepad={gamepad}
              padInUse={padInUse}
              fullscreen={{ available: document.fullscreenEnabled === true, on: fullscreen }}
              theme={theme}
              touch={{ shown: touchShown, prefs: touchPrefs, vibrateAvailable: typeof navigator.vibrate === "function" }}
              onTouchShown={showTouch}
              onTouchPrefs={setTouchPrefs}
              onResume={closeMenu}
              onSave={(target) => {
                closeMenu();
                void saveState(target);
              }}
              onLoad={(target) => {
                closeMenu();
                void loadState(target);
              }}
              onReset={() => {
                reset();
                closeMenu();
              }}
              onQuit={() => void quit()}
              onRebind={setRebinding}
              onResetDefaults={() => changeBindings(DEFAULT_BINDINGS)}
              onChangeBindings={changeBindings}
              onToggleFullscreen={toggleFullscreen}
              onNextTheme={() => setTheme(nextTheme(theme))}
              onRecordChoice={setRecordChoice}
              onToggleRecord={toggleRecord}
              onMark={markCheckpoint}
              replaySeconds={replaySeconds}
              onReplaySeconds={setReplaySeconds}
              onSaveReplay={saveReplay}
              onPlayMovieFile={(file) => void playMovieFile(file)}
              onStopMovie={() => {
                playerRef.current?.stopMovie();
                setMovieStatus(playerRef.current?.movieStatus() ?? IDLE_MOVIE);
              }}
            />
          )}
        </section>

        {/* Deliberate: one column beside the picture (under it on a narrow window), the panels stacked in a fixed order, so no panel ever covers the picture and the picture keeps its width however many are open. */}
        {sidePanelsShown && (
          <div className="side-panels">
            {controlsPanelShown && <ControlsSidePanel bindings={bindings} />}

            {tunePanelShown && game && gameTune && (
              <TunePanel
                key={game.id}
                tunables={gameTune.tunables}
                values={gameTune.values}
                onChange={(key, value) => applyTune(playerRef.current!, gameTune.tunables, { ...gameTune.values, [key]: value })}
                onReset={() => applyTune(playerRef.current!, gameTune.tunables, defaultValues(gameTune.tunables))}
                onSaveVersion={() => void saveTuneVersion(game.id, gameTune.tunables, gameTune.values)}
                onLoadFile={(file) => void loadGameFile(file)}
                tuneKey={bindings[Hotkey.Tune].length > 0 ? bindings[Hotkey.Tune].map(keyLabel).join(" or ") : undefined}
                onClose={closeTunePanel}
              />
            )}

            {toolsPanelShown && game && playerRef.current && (
              <ToolsPanel
                key={game.id}
                host={playerRef.current}
                romSha256={game.id}
                storage={storage}
                toolsKey={bindings[Hotkey.Tools].length > 0 ? bindings[Hotkey.Tools].map(keyLabel).join(" or ") : undefined}
                onClose={closeTools}
                onProblem={onToolsProblem}
              />
            )}

            {consoleShown && (
              <ConsolePanel
                session={consoleSession}
                context={{
                  host: consoleHost,
                  game: consoleTable,
                  values: [
                    ...(consoleTable?.values ?? []),
                    ...(gameTune ? tunableValues(gameTune.tunables, gameTune.values, (values) => applyTune(playerRef.current!, gameTune.tunables, values)) : []),
                  ],
                }}
                consoleKey={bindings[Hotkey.Console].length > 0 ? bindings[Hotkey.Console].map(keyLabel).join(" or ") : undefined}
                autoFocus={consoleFocus}
                onLeave={leaveConsole}
              />
            )}
          </div>
        )}

        {!game && (
          <Library
            key={libraryKey}
            ref={libraryRef}
            games={games}
            persistence={persistence}
            readStorageUse={readStorageUse}
            onExport={(request) => void exportBackup(request)}
            onImport={(file) => void importBackup(file)}
            persistent={opened?.store.persistent ?? true}
            storage={storage}
            padInUse={padInUse}
            loadSaves={loadSaves}
            onAddFiles={onAddFiles}
            onPlay={(id, from) => void playGame(id, from)}
            onRename={(id, title) => void changeGame((store) => store.renameGame(id, title), "The game could not be renamed")}
            onFavourite={(id, favourite) => void changeGame((store) => store.setFavourite(id, favourite), "The favourite could not be saved")}
            onRemove={(id, withSaves) => void changeGame((store) => store.removeGame(id, { withSaves }), "The game could not be removed")}
            onApplyPatch={(id, file) => void applyPatchFile(id, file)}
          />
        )}
      </main>
    </div>
  );
}
