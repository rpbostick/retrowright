import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { MenuCommand } from "../input/padMenu";
import { Hotkey, keyLabel, type Action, type BindingTarget, type KeyBindings } from "../input/keyBindings";
import type { MovieStatus } from "../player/player";
import { REPLAY_SECONDS, type ReplaySeconds } from "../movie/replayBuffer";
import type { StateRecord, StateSlot } from "../storage/gameStore";
import { ControlsPanel } from "./ControlsPanel";
import { focusables, isSlider, needsGesture, nextFocus, PAD_GESTURE_HINT, stepSelect, wrapTab, type Direction } from "./menuFocus";
import { MovieBar, type RecordChoice } from "./MovieBar";
import { savedAtText, SlotGrid } from "./SlotGrid";
import type { Theme } from "./theme";
import type { VideoDescription } from "../core/types";
import { aspectText, effectiveScaling, FAST_FORWARD_SPEEDS, hasSquarePixels, SCANLINE_RANGE, type DisplayPrefs } from "./displayPrefs";
import { OPACITY_RANGE, SIZE_RANGE, type TouchPrefs } from "../touch/touchPrefs";

type View = "main" | "save" | "load" | "confirm" | "controls" | "touch" | "display" | "movie";

const TITLES: Record<View, string> = {
  main: "Menu",
  save: "Save state",
  load: "Load state",
  confirm: "Save over a slot?",
  controls: "Controls",
  touch: "Touch controls",
  display: "Display and speed",
  movie: "Movies",
};

/** The main item each view is opened from, so going back lands on it. */
const OPENED_FROM: Record<Exclude<View, "main">, string> = {
  save: "save",
  load: "load",
  confirm: "save",
  controls: "controls",
  touch: "touch",
  display: "display",
  movie: "movie",
};

const ARROWS: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

export interface QuickMenuHandle {
  /** A gamepad's menu command: what the arrow keys, Enter and Esc do. */
  command(command: MenuCommand): void;
}

export interface QuickMenuProps {
  gameName: string;
  slots: StateRecord[];
  currentSlot: StateSlot;
  movieStatus: MovieStatus;
  recordChoice: RecordChoice;
  bindings: KeyBindings;
  rebinding: BindingTarget | null;
  gamepad: string | null;
  /** True while the player is using a gamepad: items it cannot press show why. */
  padInUse: boolean;
  fullscreen: { available: boolean; on: boolean };
  theme: Theme;
  /** The open game's picture, whose pixel shape the aspect option names. */
  video: VideoDescription;
  displayPrefs: DisplayPrefs;
  /** True while fast-forward is turned on here (not held). */
  fastForwardOn: boolean;
  onDisplayPrefs(prefs: DisplayPrefs): void;
  /** Whether the controls panel shows: the setting, or a test link's `controls=1` for this tab. */
  controlsShown: boolean;
  onControlsShown(shown: boolean): void;
  onToggleFastForward(): void;
  onScreenshot(): void;
  /** False in touch play, where the tools panel is not offered, and while the Developer tools setting is off. */
  toolsAvailable: boolean;
  /** Closes the menu and opens the tools panel beside the screen. */
  onTools(): void;
  /** True when a tunables file is known for the game, outside touch play. */
  tuneAvailable: boolean;
  /** Closes the menu and opens the Tune panel beside the screen. */
  onTune(): void;
  /** True when no tunables file is known for the game, outside touch play: the menu offers to load one. */
  loadTunablesAvailable: boolean;
  /** A tunables file or game profile picked for the game. */
  onLoadGameFile(file: File): void;
  /** Whether the touch controls show, their settings, and whether this browser can vibrate. */
  touch: { shown: boolean; prefs: TouchPrefs; vibrateAvailable: boolean };
  onTouchShown(shown: boolean): void;
  onTouchPrefs(prefs: TouchPrefs): void;
  onResume(): void;
  onSave(slot: StateSlot): void;
  onLoad(slot: StateSlot): void;
  onReset(): void;
  onQuit(): void;
  onRebind(target: BindingTarget | null): void;
  onResetDefaults(): void;
  /** A combo's buttons changed or a combo removed in the Controls view. */
  onChangeBindings(bindings: KeyBindings): void;
  onToggleFullscreen(): void;
  onNextTheme(): void;
  onRecordChoice(choice: RecordChoice): void;
  onToggleRecord(): void;
  onMark(): void;
  /** The instant replay's length in seconds, or 0 while it is off. */
  replaySeconds: ReplaySeconds;
  onReplaySeconds(seconds: ReplaySeconds): void;
  /** Downloads the instant replay as a movie. */
  onSaveReplay(): void;
  onPlayMovieFile(file: File): void;
  onStopMovie(): void;
}

/**
 * The in-game menu: a modal dialog over the paused game, following the
 * WAI-ARIA dialog pattern (focus moves in, Tab stays inside, Esc goes back
 * and finally closes). Arrow keys and a pad's D-pad move between items.
 */
export const QuickMenu = forwardRef<QuickMenuHandle, QuickMenuProps>(function QuickMenu(props, ref) {
  const { slots, currentSlot, movieStatus } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const gameFileInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>("main");
  const [pendingSlot, setPendingSlot] = useState<StateSlot | null>(null);
  /** The main item to focus when the main view shows again. */
  const returnTo = useRef("resume");

  const recording = movieStatus.mode === "recording";
  const playing = movieStatus.mode === "playing";

  const show = (next: View) => {
    if (next === "main" && view !== "main") returnTo.current = OPENED_FROM[view];
    setView(next);
  };

  const back = () => {
    if (view === "main") props.onResume();
    else if (view === "confirm") show("save");
    else show("main");
  };

  // Each view starts with focus on its first item, or, back on the main view,
  // on the item it was opened from.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const target =
      view === "main"
        ? dialog.querySelector<HTMLElement>(`[data-item="${returnTo.current}"]:not([disabled])`)
        : view === "confirm"
          ? dialog.querySelector<HTMLElement>("[data-item=cancel]")
          : view === "save" || view === "load"
            ? dialog.querySelector<HTMLElement>(`[data-slot="${currentSlot}"]`)
            : null;
    (target ?? focusables(dialog).find((element) => element.dataset.item !== "back"))?.focus();
    // Only a change of view moves focus, not a change of the slots or the current slot.
  }, [view]);

  // Focus that leaves the dialog while it is open (a click on the page behind) comes back.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) focusables(dialog)[0]?.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  const move = (direction: Direction) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    nextFocus(dialog, document.activeElement, direction)?.focus();
  };

  useImperativeHandle(ref, () => ({
    command(command) {
      if (props.rebinding) return;
      const active = document.activeElement;
      if (command === "back") back();
      else if (command === "choose") {
        // The browser refuses a file picker or fullscreen without a click or key press; the item shows a hint instead.
        const pressable = active instanceof HTMLButtonElement || (active instanceof HTMLInputElement && active.type === "checkbox");
        if (pressable && dialogRef.current?.contains(active) && !needsGesture(active)) active.click();
      } else if ((command === "left" || command === "right") && stepSelect(active, command)) {
        return;
      } else move(command as Direction);
    },
  }));

  const onKeyDown = (event: ReactKeyboardEvent) => {
    // While a key is being rebound, every key press belongs to the rebinding.
    if (props.rebinding) return;
    if (event.key === "Escape") {
      event.preventDefault();
      // Kept from the page's own Esc handler, which would open the menu again once this closes it.
      event.stopPropagation();
      back();
      return;
    }
    if (event.key === "Tab") {
      wrapTab(dialogRef.current!, event);
      return;
    }
    const direction = ARROWS[event.key];
    if (!direction || event.target instanceof HTMLSelectElement) return;
    // Left and right move a slider's value, as they do outside the menu.
    if ((direction === "left" || direction === "right") && isSlider(event.target)) return;
    event.preventDefault();
    move(direction);
  };

  const pickSaveSlot = (slot: StateSlot) => {
    if (slots.some((record) => record.slot === slot)) {
      setPendingSlot(slot);
      show("confirm");
    } else {
      props.onSave(slot);
    }
  };

  const pending = pendingSlot === null ? undefined : slots.find((record) => record.slot === pendingSlot);

  return (
    <div
      className="menu-backdrop"
      onClick={(event) => {
        // A click beside the menu resumes, as a click outside a dialog closes it.
        if (event.target === event.currentTarget) props.onResume();
      }}
    >
      <div ref={dialogRef} className="quick-menu" role="dialog" aria-modal="true" aria-labelledby="menu-title" onKeyDown={onKeyDown}>
        <header className="menu-head">
          {view !== "main" && (
            <button type="button" className="menu-back" data-item="back" onClick={back} aria-label="Back">
              ‹ Back
            </button>
          )}
          <h2 id="menu-title">{TITLES[view]}</h2>
          <span className="menu-game">{props.gameName}</span>
        </header>

        {view === "main" && (
          <div className="menu-items" role="menu" aria-labelledby="menu-title">
            <MenuItem item="resume" label="Resume" onClick={props.onResume} />
            <MenuItem item="save" label="Save state…" hint={`F5 saves to slot ${currentSlot}`} onClick={() => show("save")} />
            <MenuItem
              item="load"
              label="Load state…"
              hint={recording || playing ? "Not while a movie records or plays" : `F7 loads slot ${currentSlot}`}
              disabled={recording || playing}
              onClick={() => show("load")}
            />
            <MenuItem item="reset" label="Reset" hint={playing ? "Not while a movie plays" : undefined} disabled={playing} onClick={props.onReset} />
            <MenuItem item="controls" label="Controls…" onClick={() => show("controls")} />
            <MenuItem item="touch" label="Touch controls…" hint={props.touch.shown ? "On" : "Off"} onClick={() => show("touch")} />
            <MenuItem item="display" label="Display and speed…" hint={props.fastForwardOn ? "Fast-forward on" : undefined} onClick={() => show("display")} />
            <MenuItem item="screenshot" label="Screenshot" hint={boundKeys(props.bindings, Hotkey.Screenshot)} onClick={props.onScreenshot} />
            {props.tuneAvailable && <MenuItem item="tune" label="Tune…" hint={boundKeys(props.bindings, Hotkey.Tune)} onClick={props.onTune} />}
            {props.loadTunablesAvailable && (
              <>
                <MenuItem item="load-tunables" label="Load tunables…" hint="or a game profile" onClick={() => gameFileInput.current?.click()} />
                <input
                  ref={gameFileInput}
                  id="game-file-input"
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) props.onLoadGameFile(file);
                    event.target.value = "";
                  }}
                />
              </>
            )}
            {props.toolsAvailable && <MenuItem item="tools"label="Tools…" hint={boundKeys(props.bindings, Hotkey.Tools)} onClick={props.onTools} />}
            <MenuItem
              item="save-replay"
              label="Save the last minute"
              hint={props.replaySeconds === 0 ? "Instant replay is off" : recording || playing ? "Not while a movie records or plays" : boundKeys(props.bindings, Hotkey.SaveReplay)}
              disabled={props.replaySeconds === 0 || recording || playing}
              onClick={props.onSaveReplay}
            />
            <MenuItem item="movie" label="Record and play movie…" hint={recording ? "Recording" : playing ? "Playing" : undefined} onClick={() => show("movie")} />
            <MenuItem item="quit" label="Quit to library" hint={recording ? "Stop the recording first" : undefined} disabled={recording} onClick={props.onQuit} />
          </div>
        )}

        {(view === "save" || view === "load") && (
          <>
            <p className="hint">{view === "save" ? "Choose a slot to save to." : "Choose a slot to load."}</p>
            <SlotGrid mode={view} slots={slots} currentSlot={currentSlot} onPick={view === "save" ? pickSaveSlot : props.onLoad} />
          </>
        )}

        {view === "confirm" && pendingSlot !== null && (
          <div className="menu-confirm">
            <p>
              Slot {pendingSlot} holds a save from {pending ? savedAtText(pending.savedAt) : "earlier"}. Save over it?
            </p>
            {pending?.thumbnail && <img className="confirm-picture" src={pending.thumbnail} alt={`The save in slot ${pendingSlot}`} />}
            <div className="bar">
              <button type="button" data-item="overwrite" onClick={() => props.onSave(pendingSlot)}>
                Save over slot {pendingSlot}
              </button>
              <button type="button" data-item="cancel" onClick={() => show("save")}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {view === "controls" && (
          <ControlsPanel
            bindings={props.bindings}
            rebinding={props.rebinding}
            gamepad={props.gamepad}
            onRebind={props.onRebind}
            onResetDefaults={props.onResetDefaults}
            onChangeBindings={props.onChangeBindings}
          />
        )}

        {view === "touch" && (
          <TouchPanel
            {...props.touch}
            onShown={props.onTouchShown}
            onPrefs={props.onTouchPrefs}
          />
        )}

        {view === "display" && (
          <div className="menu-display">
            <button
              type="button"
              data-item="fullscreen"
              data-needs-gesture=""
              aria-pressed={props.fullscreen.on}
              aria-describedby={props.padInUse ? "fullscreen-hint" : undefined}
              disabled={!props.fullscreen.available}
              onClick={props.onToggleFullscreen}
            >
              Fullscreen: {props.fullscreen.on ? "on" : "off"}
            </button>
            {!props.fullscreen.available && <p className="hint">This browser does not allow fullscreen here.</p>}
            {props.fullscreen.available && props.padInUse && (
              <p className="hint" id="fullscreen-hint">
                {PAD_GESTURE_HINT}
              </p>
            )}
            <button type="button" data-item="theme" onClick={props.onNextTheme}>
              Theme: {props.theme}
            </button>
            <DisplayPanel
              video={props.video}
              prefs={props.displayPrefs}
              inTouchLayout={props.touch.shown}
              fastForwardOn={props.fastForwardOn}
              fastForwardKeys={boundKeys(props.bindings, Hotkey.FastForward)}
              onPrefs={props.onDisplayPrefs}
              onToggleFastForward={props.onToggleFastForward}
            />
            <button type="button" data-item="show-controls" aria-pressed={props.controlsShown} onClick={() => props.onControlsShown(!props.controlsShown)}>
              Show controls beside the game: {props.controlsShown ? "on" : "off"}
            </button>
            <button
              type="button"
              data-item="developer-tools"
              aria-pressed={props.displayPrefs.developerTools}
              aria-describedby="developer-tools-hint"
              onClick={() => props.onDisplayPrefs({ ...props.displayPrefs, developerTools: !props.displayPrefs.developerTools })}
            >
              Developer tools: {props.displayPrefs.developerTools ? "on" : "off"}
            </button>
            <p className="hint" id="developer-tools-hint">
              RAM search, the watch list, the memory viewer ({boundKeys(props.bindings, Hotkey.Tools) ?? "Tools…"}) and the console ({boundKeys(props.bindings, Hotkey.Console) ?? "no key bound"}).
            </p>
            {props.touch.shown && <p className="hint">The controls panel is not shown in touch play, which has its own buttons, nor are the Tune panel and the developer tools.</p>}
          </div>
        )}

        {view === "movie" && (
          <>
            <MovieBar
              enabled
              padInUse={props.padInUse}
              status={movieStatus}
              choice={props.recordChoice}
              onChoice={props.onRecordChoice}
              onToggleRecord={props.onToggleRecord}
              onMark={props.onMark}
              onPlayFile={props.onPlayMovieFile}
              onStopMovie={props.onStopMovie}
            />
            <p className="hint">F9 records or stops, F8 marks a checkpoint. Battery saves are off from the start of a movie until the game is opened again.</p>
            <label className="menu-select">
              <span>Instant replay</span>
              <select data-item="replay-seconds" value={props.replaySeconds} onChange={(event) => props.onReplaySeconds(Number(event.target.value) as ReplaySeconds)}>
                {REPLAY_SECONDS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds === 0 ? "Off" : `${seconds} seconds`}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              While no movie records or plays, the game's last stretch is kept, so{" "}
              {boundKeys(props.bindings, Hotkey.SaveReplay) ?? "Save the last minute"} saves it as a movie when something goes wrong.
            </p>
          </>
        )}
      </div>
    </div>
  );
});

interface TouchPanelProps {
  shown: boolean;
  prefs: TouchPrefs;
  vibrateAvailable: boolean;
  onShown(shown: boolean): void;
  onPrefs(prefs: TouchPrefs): void;
}

function TouchPanel({ shown, prefs, vibrateAvailable, onShown, onPrefs }: TouchPanelProps) {
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return (
    <div className="menu-touch">
      <button type="button" data-item="touch-shown" aria-pressed={shown} onClick={() => onShown(!shown)}>
        Touch controls: {shown ? "on" : "off"}
      </button>
      <p className="hint">
        {shown
          ? "They hide when you use a keyboard or gamepad, and come back when you touch the screen."
          : "Turned off here, a touch does not bring them back; turn them on again here."}
      </p>
      <label className="menu-slider">
        <span>Size</span>
        <input
          type="range"
          data-item="touch-size"
          min={SIZE_RANGE.min}
          max={SIZE_RANGE.max}
          step={SIZE_RANGE.step}
          value={prefs.size}
          onChange={(event) => onPrefs({ ...prefs, size: Number(event.target.value) })}
        />
        <output>{percent(prefs.size)}</output>
      </label>
      <label className="menu-slider">
        <span>Opacity</span>
        <input
          type="range"
          data-item="touch-opacity"
          min={OPACITY_RANGE.min}
          max={OPACITY_RANGE.max}
          step={OPACITY_RANGE.step}
          value={prefs.opacity}
          onChange={(event) => onPrefs({ ...prefs, opacity: Number(event.target.value) })}
        />
        <output>{percent(prefs.opacity)}</output>
      </label>
      {vibrateAvailable && (
        <label className="menu-check">
          <input type="checkbox" data-item="touch-vibrate" checked={prefs.vibrate} onChange={(event) => onPrefs({ ...prefs, vibrate: event.target.checked })} />
          Vibrate on press
        </label>
      )}
    </div>
  );
}

interface DisplayPanelProps {
  video: VideoDescription;
  prefs: DisplayPrefs;
  /** True while the touch layout places the picture, where the default scaling is fill. */
  inTouchLayout: boolean;
  fastForwardOn: boolean;
  /** The keys bound to hold fast-forward, as shown, or undefined with none bound. */
  fastForwardKeys: string | undefined;
  onPrefs(prefs: DisplayPrefs): void;
  onToggleFastForward(): void;
}

function DisplayPanel({ video, prefs, inTouchLayout, fastForwardOn, fastForwardKeys, onPrefs, onToggleFastForward }: DisplayPanelProps) {
  const square = hasSquarePixels(video);
  const integer = effectiveScaling(prefs.scaling, inTouchLayout) === "integer";
  return (
    <>
      <button type="button" data-item="scaling" aria-pressed={integer} onClick={() => onPrefs({ ...prefs, scaling: integer ? "fill" : "integer" })}>
        Integer scaling: {integer ? "on" : "off (fill)"}
      </button>
      <button
        type="button"
        data-item="aspect"
        aria-pressed={prefs.aspect === "core"}
        disabled={square}
        onClick={() => onPrefs({ ...prefs, aspect: prefs.aspect === "core" ? "square" : "core" })}
      >
        Pixel aspect: {square || prefs.aspect === "square" ? "square" : aspectText(video)}
      </button>
      <button type="button" data-item="scanlines" aria-pressed={prefs.scanlines} onClick={() => onPrefs({ ...prefs, scanlines: !prefs.scanlines })}>
        Scanlines: {prefs.scanlines ? "on" : "off"}
      </button>
      <label className="menu-slider">
        <span>Scanline intensity</span>
        <input
          type="range"
          data-item="scanline-intensity"
          min={SCANLINE_RANGE.min}
          max={SCANLINE_RANGE.max}
          step={SCANLINE_RANGE.step}
          value={prefs.scanlineIntensity}
          onChange={(event) => onPrefs({ ...prefs, scanlineIntensity: Number(event.target.value) })}
        />
        <output>{Math.round(prefs.scanlineIntensity * 100)}%</output>
      </label>
      <label className="menu-select">
        <span>Fast-forward speed</span>
        <select data-item="fast-forward-speed" value={prefs.fastForwardSpeed} onChange={(event) => onPrefs({ ...prefs, fastForwardSpeed: Number(event.target.value) })}>
          {FAST_FORWARD_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
        </select>
      </label>
      <button type="button" data-item="fast-forward" aria-pressed={fastForwardOn} onClick={onToggleFastForward}>
        Fast-forward: {fastForwardOn ? "on" : "off"}
      </button>
      <p className="hint">Hold {fastForwardKeys ? `${fastForwardKeys}, ` : ""}a pad's right trigger or the touch » to fast-forward; sound is off meanwhile.</p>
    </>
  );
}

/** The keys bound to an action, as shown ("Tab", "F2 or P"), or undefined with none bound. */
function boundKeys(bindings: KeyBindings, action: Action): string | undefined {
  const codes = bindings[action];
  return codes.length > 0 ? codes.map(keyLabel).join(" or ") : undefined;
}

interface MenuItemProps {
  item: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick(): void;
}

function MenuItem({ item, label, hint, disabled, onClick }: MenuItemProps) {
  return (
    <button type="button" role="menuitem" className="menu-item" data-item={item} disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );
}
