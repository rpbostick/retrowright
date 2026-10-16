# retrowright's design

retrowright is a static page: no server, no account, nothing uploaded. Everything a player has (games, saves, settings) lives in the browser, and everything a game project brings (tunables, console commands, test builds) comes in as files at run time. The code is in layers, each depending only on those below it, so the emulator core can be replaced and the same movies replayed in the browser and in Node.

```
ui (React)                  src/ui/
player · tune · console     src/player/  src/tune/  src/console/  src/tools/
input · touch · audio       src/input/  src/touch/  src/audio/  src/timing/
movies · patches · storage  src/movie/  src/patch/  src/storage/
core                        src/core/  src/rom/
harness (Node)              harness/  e2e/
```

## Core

`EmulatorCore` (`src/core/types.ts`) is the one interface the rest of the app uses: `load`, `frame`, `reset`, `buttonDown`/`buttonUp` per player, `batteryRam`/`restoreBatteryRam`, `saveState`/`loadState`, `picture`, a side-effect-free `peek` and `poke`, and the video description (picture size, pixel aspect, frame rate). `JsnesCore` implements it on jsnes 2.1.0, and nothing else imports jsnes, so a second core (`docs/research/cores.md`) slots in behind the same interface. `src/rom/ines.ts` parses iNES and NES 2.0 headers and lists the supported mappers, checked against jsnes by a test.

jsnes is used as a library, and where it falls short `JsnesCore` works around it from outside rather than patching it:

- **Battery RAM.** jsnes has no public call to restore it. Its cartridge RAM lives at `$6000-$7FFF` of `cpu.mem`, so `restoreBatteryRam` writes a saved image there after `loadROM`, and `reset` carries it over, as a real reset keeps SRAM.
- **The picture.** jsnes keeps the finished frame in its PPU buffer, which is part of its save state; `picture()` reads it, so a resume state brings back the exact frame at once.
- **The pads.** A NES pad's shift register takes all eight buttons at the `$4016` strobe; jsnes reads each button live, so a game reading the pad across the end of a frame could read Left from one frame and Right from the next. `PadLatch` (`src/core/jsnesPads.ts`) copies the buttons into jsnes's controller state only while the strobe is high and as it falls.
- **Debug hooks.** `setDebugHooks` (execute, read and write hooks), `romOffset` and `ppuSnapshot` are optional members, wrapped onto jsnes's CPU and mapper instances only while a tool is open (`src/core/jsnesDebug.ts`), as jsnes's own Game Genie swaps a method. A run without them pays nothing, and they are never part of a save state or movie. `npm run hooks:cost` measures them. `docs/research/toolkit.md` has the jsnes internals they rely on.
- **ROM bytes.** `pokeRom` writes a PRG byte into jsnes's bank and every slot mapping it now, so a tuned value holds through bank switches, Reset and save states.

## Player

`Player` (`src/player/player.ts`) owns a loaded game: the frame loop, the pads, battery saves, save states, the resume state, recording and playback. The frame loop is a fixed-step pacer on `requestAnimationFrame` (`src/timing/framePacer.ts`), so 120 Hz and 144 Hz screens still run the game at its own frame rate, and fast-forward is more steps per tick. Sound goes out through an AudioWorklet fed by a ring buffer (`src/audio/`); it is muted while fast-forwarding, when two to four times the samples would overflow the buffer.

The held buttons are one ordered set across every input (keys, mouse, combos, gamepads, touch), and each frame's pads are computed from it (`src/input/opposites.ts`): of two opposite directions the one pressed last wins, as fight sticks' "last input priority" does, because games are not written for both at once. Movies record what the game saw.

**Instant replay** keeps a save state every 5 seconds and the pads of every frame since the oldest state still needed (`src/movie/replayBuffer.ts`), after RetroArch's rewind buffer and BizHawk's greenzone. The states are JSON text in a ring, so memory stays bounded: about 20 MB for 60 seconds of Final Fantasy, a state being about 1.8 MB. Taking a state costs some 40 to 50 ms, so the interval trades a hitch every 5 seconds against the states held.

## Input and touch

`src/input/` holds the key bindings (two keys per button and hotkey, combos, player 2's keys, stored versioned so older saved bindings load), the Gamepad API poller, and the router that sends a pad's buttons to the menu, the library or the game. A browser opens a file picker or fullscreen only for a click or key press, so those items say so to a gamepad instead of failing silently.

The touch layout is data, `src/touch/layouts/phone.json`, in a format modelled on the ideas documented for Delta's `.deltaskin` skins: per orientation, the screen rectangle and each control's frame, buttons, touch margins and anchor. `src/touch/layout.ts` scales and places it and hit-tests fingers; `src/touch/touchTracker.ts` follows each finger. No skin image is used; the controls are drawn in CSS and SVG.

## Storage

The library, ROMs, battery RAM, save states with their pictures, and resume states are in IndexedDB (`src/storage/gameStore.ts`), keyed by the ROM's SHA-256, so a save finds its game whatever the file is called. Settings are in `localStorage` under `retrowright.` keys. `src/storage/persistence.ts` asks for persistent storage after the first save, since a browser may otherwise clear the page's data.

A backup file (`src/storage/backup.ts`) is JSON with `format: "retrowright-backup"` and a `version`; a newer version is refused by name. Import keeps whichever of two saves is newer, so importing twice changes nothing.

## Movies

A `.rwmovie.json` file (`src/movie/format.ts`), modelled on FCEUX's `.fm2` and BizHawk's `.bk2`:

| Field | Meaning |
| --- | --- |
| `format`, `version` | `"retrowright-movie"`, `1` |
| `rom` | `name` and `sha256` of the whole ROM file |
| `core` | `name` and `version` of the core it was recorded on |
| `start` | `{"kind": "power-on", "batteryRam": null or base64}` or `{"kind": "save-state", "state": …}` |
| `frames` | frames the movie runs |
| `inputs` | `{frame, pad1, pad2}` where the pads change; each holds until the next |
| `events` | `{frame, kind: "reset"}` |
| `checkpoints` | `{frame, name, expect: {memory?, screenHash?}}` |

Frames are emulated frames, never time: an input at frame N applies just before frame N runs, and a checkpoint at frame N is checked after N frames. A pad is a bit mask in the controller's order (A 1, B 2, Select 4, Start 8, Up 16, Down 32, Left 64, Right 128). `screenHash` is FNV-1a over the picture's RGB bytes; `memory` holds assertions such as `$0048 == 8` or, for a game with a memory map (`src/games/`), `party[0].hp >= 30`. Because the runner (`src/movie/runner.ts`) drives an `EmulatorCore`, the same movie replays in the page and in Node, and a test replays movies twice to check determinism.

## Patches

IPS and BPS come from Rom Patcher JS (MIT), whose format modules are vendored in `src/vendor/rompatcher/` and wrapped by `src/patch/patch.ts`, rather than written here. BPS is preferred: it records the source and target CRC32, so a patch for another ROM fails loudly. A patched ROM is a new library entry keyed by its own SHA-256, so the original and its saves stay as they were.

## Tune

A tunables file (`format: "retrowright-tunables"`, `src/tune/tunables.ts`) names ROM bytes by their file offset and CPU address, with a range, a default and optional named choices, keyed by the ROM's SHA-256. The page bundles none: a file is loaded by the player, or found beside a ROM on the development server, so retrowright knows no game in particular. Values are written with `pokeRom` and kept per game; **Save as new version…** makes a BPS from the stored ROM to the tuned one.

## Console and tools

The console (`src/console/`) parses commands and runs them against a narrow session interface, so `src/console/console.test.ts` runs every command against a stub. A game's own values and commands come from data beside the game, not from the console's code: a built-in table (`src/games/consoleTables.ts`) or a **game profile** (`format: "retrowright-game-profile"`, `src/console/gameProfile.ts`), whose commands are steps (`require`, `stopWhen`, `when`, `set`, `write`, `increase`, `wait`) run in order.

The tools (`src/tools/`: RAM search, watch list, memory activity) have no UI of their own; `src/ui/ToolsPanel.tsx` and the views beside it draw them. They follow FCEUX's and BizHawk's RAM Search and RAM Watch, and Mesen's separation of debugger from player options (`docs/research/toolkit.md`).

## UI

The page is React (`src/ui/`): the library, the menu (HTML, not drawn on the canvas, so screen readers and keyboard navigation work), the panels beside the picture, and the touch controls. Panels share one column beside the picture and never cover it. The focus trap of the menu and dialogs is a dozen lines in `src/ui/menuFocus.ts` rather than the focus-trap package, because the arrow-key and gamepad movement around it is the larger part and focus-trap does not provide it. The library follows OpenEmu, ES-DE and LaunchBox (`docs/research/emulator-ux.md`), with the player's own frames as pictures, since the art databases cannot be used from a public static page.

The service worker and manifest come from vite-plugin-pwa (Workbox). The worker waits for the player's Reload instead of replacing the files under a running game, and its scope is the folder the page is served from, so the same build works at the root or under `/retrowright/`.

## Harness

`harness/` runs the same code in Node: the movie replay and its CLI, the `.fm2` converter, the TAS trace and sweep, the patch CLI, and the comparison with MesenCE. `npm run diff` replays a movie on jsnes and in [MesenCE](https://github.com/SourMesen/Mesen2) (GPL-3.0), run as a separate program (`$HOME/tools/mesen/Mesen`, or the path `RETROWRIGHT_MESEN` names) with a temporary `XDG_CONFIG_HOME` so no settings or saves are shared; `tools/mesen/replay.lua` sets the pad at each `inputPolled` event and dumps memory, and `harness/diff.ts` compares work and cartridge RAM after every Nth frame, naming addresses through the game's memory map. MesenCE starts from jsnes's power-on memory, so a difference comes from running. No picture hash is compared: the two palettes differ, so screenshots are saved for comparing by eye. The tests that need a ROM or MesenCE skip without them, naming what is missing.

The development server's test ROM folder (`harness/testRomsPlugin.ts`) is a Vite `configureServer` hook, so the production build has no trace of it; a test builds the page and checks. `harness/nameScan.ts` keeps a game project's names out of the repository: a project lists them in a file outside the history (`RETROWRIGHT_NAME_SCAN`, else a git-ignored `.name-scan`), and the tests scan every tracked file and the build for them. `npm run licenses` writes `THIRD_PARTY_LICENSES` from the lockfile and the installed packages, and a test fails when it is out of date.

Other projects build on retrowright through the modules `package.json` exports (`retrowright/core/*`, `movie/*`, `patch/*`, `tune/*`, `console/*`, `storage/*`, `test/*`, `harness/*`, `e2e/*` and two UI helpers).

## Browser checks

`e2e/` drives headless Firefox through puppeteer-core over WebDriver BiDi, against `dist/` served under `/retrowright/` (`e2e/staticServer.mjs`) or the development server, and opens the page with `?debug`, which installs a read-only `window.__retrowright` for frame counts and memory. Each writes screenshots and a report under `.out/page/`. Most use synthetic ROMs built in code (`src/test/syntheticRom.ts`) that show their state in RAM or the backdrop colour; those that need a commercial ROM skip without it. `npm run e2e:all` builds once and runs them all; `e2e/a11y.mjs` runs axe-core against WCAG 2.1 A and AA in both themes.
