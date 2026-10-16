# retrowright

An NES emulator that runs in the browser from a static page, on the [jsnes](https://github.com/bfirsh/jsnes) core (Apache-2.0). It keeps a library of your games with their saves, plays them with a keyboard, a gamepad or touch, records and replays movies, and has developer tools for looking inside a running game. It installs as a web app and works offline.

No games are included. You load ROM files from your own computer; they stay in your browser and are never uploaded, and the page makes no request beyond its own files.

## Run it

The app, its build and `npm test` need Node.js 20 or later; the browser checks under `e2e/` need Node.js 22.12 or later (for puppeteer-core) and Firefox.

```sh
npm install
npm run dev        # development server, prints a local URL
npm run build      # static site in dist/
npm run preview    # serves dist/ locally
```

`dist/` uses relative asset paths, so it works from any folder as it is. `npm run build:pages` builds it for `https://<user>.github.io/retrowright/` instead, with absolute paths under `/retrowright/` (the `RETROWRIGHT_BASE` variable names another path); copy `dist/` to the Pages branch or upload it as a Pages artifact.

## Adding games

**Add games…** on the library page picks one or more `.nes` files, or drop them anywhere on the page. Play copies of cartridges you own, or homebrew: the empty library links to the NESdev wiki's list of homebrew games. Each file is checked first: the page says plainly when one is not an NES ROM, is cut short, or needs a mapper the emulator does not support. A file already in the library (the same SHA-256, whatever its name) is not added twice.

A game's ⋯ menu applies an `.ips` or `.bps` patch to it and adds the result as a new game; the original stays as it was. A BPS patch made for another ROM is refused with the CRC32 it expects.

## Features

### Library

Each game is a card with your own picture of it (the frame you left it on, or your newest save state's; no cover art is fetched), its title (from the file name, with region tags moved under it, and renamable) and when you last played it. Star favourites, sort by last played or title, switch between grid and list, and search once there are more than twelve games. **Continue** at the top opens the game you played last on the exact frame you left: the running game is kept whenever the tab is hidden, the page closes or you quit to the library. Arrow keys or a gamepad's D-pad move between cards.

Everything is kept in this browser (IndexedDB). After your first save the page asks the browser to keep its data (`navigator.storage.persist()`) and says what it answered; **Saves and storage…** shows that answer and the room used. **Export everything** downloads one `.rwbackup.json` with every game's saves and the settings (and the ROMs, if you tick it); **Import a backup…** reads it in any browser, matching saves to games by SHA-256 and never overwriting a newer save.

### Save states

Battery saves (for games that save to the cartridge) are kept per game. Save states have eight slots per game, shown as cards with a picture and the time; F5 saves to the current slot, F7 loads it, 1-3 choose a slot.

### The menu

Esc, Select+Start on a gamepad (or its Home button) or the ☰ button opens the menu and pauses the game: Resume, Save state, Load state, Reset, Controls, Touch controls, Display and speed, Screenshot, Tune, Tools, Save the last minute, Record and play movie, and Quit to library. It works with the keyboard, a gamepad or the mouse, and screen readers read it.

### Movies and instant replay

**Record** (F9) records a movie of what you press, from power-on or from the current state; **Mark** (F8) adds a checkpoint holding the screen hash. **Stop and save** downloads it as a `.rwmovie.json`; **Play movie…** replays it frame for frame and reports each checkpoint. Movies are plain JSON (the format is in `docs/design.md`); `npm run fm2` converts an FCEUX `.fm2` movie.

While you play, the player keeps the last minute (30, 60 or 120 seconds, or off, in **Record and play movie…**). R or **Save the last minute** downloads it as a movie that replays to the same picture, for the moment something goes wrong before you thought to record.

### Display and speed

Integer scaling, the NES's 8:7 pixel aspect or square pixels, a scanline overlay with its intensity, the light or dark theme, and fullscreen. Hold Tab, a gamepad's right trigger or the touch » button to fast-forward at 2×, 3× or 4×. F2 saves a screenshot as a PNG at the core's own 256×240. These settings are remembered and travel in an export.

### Controls

| NES | Keyboard | Second set | Gamepad (standard mapping) |
| --- | --- | --- | --- |
| D-pad | Arrow keys | W, A, S, D | D-pad or left stick |
| B | Z | right mouse button, over the picture | bottom or left face button |
| A | X | left mouse button, over the picture | right or top face button |
| Select | Left Shift | Right Shift | Back / Select |
| Start | Enter | Numpad Enter | Start |

| Action | Key |
| --- | --- |
| Menu | Esc |
| Save / load state | F5 / F7 |
| Record a movie / mark a checkpoint | F9 / F8 |
| Fast-forward while held | Tab |
| Screenshot | F2 |
| Tune panel / tools panel | F3 / F4 |
| Save the last minute | R |
| Developer console | ` (backtick) |

Every key but Esc can be rebound in **Controls…**, which shows a picture of the pad and a primary and secondary key per button. **Combos** bind one key to several buttons (Down+B, Down+A), and player 2's buttons can take keys too. As on a real pad, a game never sees Left with Right or Up with Down: of two held, the one pressed last wins. **Show controls beside the game** keeps a panel of the bindings beside the picture. The first gamepad is player 1 and a second is player 2.

### Touch play

On a phone or tablet the game fills the page with an on-screen D-pad, A, B, an A+B area, Select, Start, » and ☰, in portrait and landscape. Several fingers work at once, a finger can slide between buttons, and each button reaches a little past its edge. **Touch controls…** sets their size, opacity and vibration. A key press or gamepad button hides them; the next touch brings them back.

### Tune

A game can come with a **tunables file**: JSON naming bytes of its ROM that change how it plays (`src/tune/tunables.ts` reads it). **Load tunables…** in the menu picks one; F3 or **Tune…** then opens a panel of sliders that change the running game at once. The values are kept per game, and **Save as new version…** adds the tuned game to the library and downloads its `.bps` patch.

### Developer tools

With **Developer tools** on in **Display and speed…**:

- **Tools…** (F4) opens a RAM search over work and cartridge RAM (equal, greater, less, changed, unchanged; 1 or 2 bytes, signed or not), a watch list kept per game, and a memory viewer that marks bytes changed, read and written.
- The backtick opens a console: `pause`, `step`, `speed`, `peek`, `poke`, `watch`, `save`, `load`, `screenshot`, `record`, `replay` and `help` for the rest, with history and Tab completion. A **game profile** (JSON, picked in **Load tunables…**) gives a game named values and commands of its own; `src/console/gameProfile.ts` reads it.

### Install and play offline

The page is an installable web app (**Install** in Chrome and Edge, **Add to Home Screen** on iPhone and iPad). After the first visit it opens without a network, with the games and saves already stored. A new version never replaces a running page: a notice offers **Reload** when one is ready.

## Development

`npm run dev` with `RETROWRIGHT_TEST_ROMS` naming a folder serves that folder's ROMs, movies, tunables files and game profiles read-only at `/local-roms/` and `/local-movies/`, so `/?play=local-roms/<file>.nes&label=<name>` opens a ROM in a labelled tab and `&movie=local-movies/<file>` plays a movie on it. The production build has none of this (`harness/testRomsPlugin.ts`).

Command-line tools, on the same code as the page:

```sh
npm run replay -- <rom> <movie> [--screenshots <dir>]   # replay a movie in Node and check its checkpoints
npm run fm2 -- <in.fm2> <out.rwmovie.json> --rom <rom>  # convert an FCEUX movie
npm run patch -- create <source> <target> <out.bps>     # or: apply <rom> <patch> <out>
npm run diff -- <rom> <movie>                           # compare jsnes with MesenCE frame by frame
```

How the code is laid out and why, the file formats and the browser checks are in [`docs/design.md`](docs/design.md); measured accuracy is in [`docs/accuracy.md`](docs/accuracy.md).

## Build and test

```sh
npm test               # unit tests (Vitest); movie tests skip a ROM that is not in roms/
npm run test:no-roms   # the same with no ROMs at all
npm run build          # type-check and build dist/
npm run e2e:all        # build, then every browser check in headless Firefox
npm run build:pages && npm run e2e:pages   # the Pages build, served under /retrowright/
npm run scan:secrets   # secretlint over the tree and dist/
npm run licenses       # rewrite THIRD_PARTY_LICENSES after changing a dependency
```

Local test ROMs go in `roms/` (git-ignored); ROM files, movies of commercial games and screenshots of them are never committed. The browser checks build synthetic ROMs in code where they can, and skip with a message when a ROM they need is missing. `npm run e2e:repeat -- <script> 20` runs one check twenty times and counts the passes.

## Licence

MIT (see `LICENSE`). jsnes is Apache-2.0 and Rom Patcher JS, vendored for patches, is MIT; see `NOTICE`. The built page carries the licences of everything it includes in `THIRD_PARTY_LICENSES.txt`.
