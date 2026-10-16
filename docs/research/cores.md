# SNES and GBA cores: research for retrowright

Research only: no code from any project below is in this repository, and retrowright runs no SNES or GBA game. GPL emulators were not read for their code; only their LICENSE files were opened, to confirm they are out.

retrowright runs NES games on jsnes behind `EmulatorCore` (`src/core/types.ts`): `load`, `frame`, `reset`, `buttonDown`/`buttonUp` per player, `batteryRam`/`restoreBatteryRam`, `saveState`/`loadState`, `picture`, and a side-effect-free `peek`. `harness/` replays movies on that interface in Node and compares memory with MesenCE (`harness/mesen.ts`, `harness/diff.ts`), and `docs/accuracy.md` reports how far a TAS stays in step. A SNES or GBA core has to fit the same interface, run in Node for the harness, run at full speed in a phone browser, and give the reverse-engineering toolkit what it needs: memory reads and writes, and hooks for CPU trace and breakpoints.

## Method and its limits

- **Licences** were read from each repository's own files in a shallow clone made on 2026-10-12 (not kept in the repository). The file is named in the table. "Headers" means the source files' own licence comments were also checked. Two rows are not from a clone: the mGBA wasm port's licence is its npm package's `license` field, and the Cult-of-GBA BIOS licence was fetched as the single file linked in the SkyEmu row.
- **Accuracy** is what each project publishes about test ROMs; none was re-run here. Where a project publishes nothing, the column says so.
- **Speed** is from the projects' own statements. No probe was run: no candidate SNES core has a ready wasm build to load in headless Firefox, and building one needs Emscripten. So "full speed on a mid-range phone" is unmeasured for every SNES candidate, and for GBA is known only from the web builds' existence.
- Dates of last activity were not read from the clones; "maintained" is from each README's own notice or the project page.

## Candidates

### SNES

| Candidate | Licence (file checked) | Language, form | Maintained | Accuracy (published) | Speed (published) | EmulatorCore and toolkit fit | Node |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **ares** ([repo](https://github.com/ares-emulator/ares)) | ISC (`LICENSE`); bundled parts in the same file are BSD-2/3, zlib, MIT, Apache-2.0 (MoltenVK), MPL-2.0 (librashader), public domain (LZMA); no GPL text in the tree except MPL's definition of "Secondary License" | C++ with its own libraries (nall, libco coroutines); native only | Yes, active team | Descended from higan; described as fully cycle-accurate ([gametechwiki](https://emulation.gametechwiki.com/index.php/Super_Famicom_(SNES)_emulators)). Also emulates GBA | Accuracy costs speed: the higan line needs a fast desktop CPU (inferred from its design: one coroutine per chip, synchronised per cycle); no wasm build exists (no Emscripten references in the tree) | Has everything internally (save states, memory, a tracer in the desktop UI), but no library API; would need a C wrapper and a libco backend for wasm (libco switches stacks, which wasm does not allow without Asyncify or a rewrite) | Only through the same wasm build |
| **LakeSnes** ([repo](https://github.com/angelo-wf/LakeSnes), archived) and its **dinkc64 fork** ([repo](https://github.com/dinkc64/LakeSnes)) | MIT (`LICENSE.txt`, the same text in both repositories); source files carry no headers, except the fork's only added files: `snes/cx4.c` says "License: MIT", (c) 2023 dink, and `snes/cx4.h` has no header; bundles kuba--/zip (Unlicense); SDL2 (zlib) only in the front end | C99, library-shaped core in `snes/`; native only | Original archived; the fork is active (90 commits and CX4 support, from its project page) | LoROM, HiROM, ExHiROM, no co-processors (fork adds CX4). Scanline PPU (no mid-scanline effects), per-sample DSP; CPU and SPC timing "should be cycle-accurate", CPU-SPC communication not ([README](https://github.com/angelo-wf/LakeSnes#compatibility)). Tested against PeterLemon CPU tests, TomHarte 65816 and SPC700 tests, blargg SPC/DSP tests (its README's resources list); no pass table | "Around 80% of one core" on the author's old hardware, against 15% for snes9x (README). Wasm on a phone: unknown, likely marginal | Good shape: `snes_runFrame`, `snes_setButtonState`, `snes_setPixels`, `snes_setSamples`, `snes_saveBattery`/`loadBattery`, `snes_saveState`/`loadState`, public `ram[0x20000]`; `snes_read` has side effects, so `peek` needs its own path; `snes_runCpuCycle`/`snes_runSpcCycle` and `tracing.c` (in both repositories) are a start for trace and breakpoints | Through a wasm build |
| **SnesJs** ([repo](https://github.com/angelo-wf/SnesJs), archived) | MIT (`LICENSE.txt`) | JavaScript | No (archived) | LoROM only; 65816 not cycle-accurate, no emulation mode; scanline PPU; no DSP echo ([README](https://github.com/angelo-wf/SnesJs#about)) | "Not able to run at full speed" on a 5th-gen Core i5 (README) | Per-instruction trace mode exists | Yes, plain JS |
| **JSMoo** ([repo](https://github.com/raddad772/jsmoo)) | MIT (`license.txt`) | JavaScript and AssemblyScript | Proof of concept | 65816 cycle-accurate, SPC700 not yet, scanline PPU, **no DSP** (README); its author also wrote the SPC700 SingleStepTests | "Fast, on old-ish PCs" in Chrome (README), no numbers | Not library-shaped; no audio | Yes |
| **rsnes** ([repo](https://github.com/nat-rix/rsnes)) | MIT (`LICENSE`) | Rust library crate plus a winit/wgpu front end | Not established | "Many games are already playable, but some graphics and sounds are faulty"; no SA-1, no Super FX; no tests yet (README) | None published; "running on WASM" is an unticked item | Save states yes, battery saves no; "API neither tested nor documented" (README) | Would need a wasm build |
| **jgenesis** ([repo](https://github.com/jsgroth/jgenesis)) | **GPL-3.0 (`LICENSE`)**: out | Rust, has a web build | | | | | |
| **bsnes** ([repo](https://github.com/bsnes-emu/bsnes)) | **GPL-3.0-or-later (`LICENSE.txt`)**: out | C++ | | | | | |
| **snes9x** ([repo](https://github.com/snes9xgit/snes9x)) | **Non-commercial (`LICENSE`: "for non-commercial purposes", "Under no circumstances will commercial rights be given")**: out | C++ | | | | | |
| **Beetle Supafaust** ([repo](https://github.com/libretro/supafaust)) | **GPL-2.0 (`COPYING`)**: out | C++ | | | | | |
| **Mesen2 / MesenCE** ([MesenCE](https://github.com/nesdev-org/MesenCE)) | GPL-3.0 (`LICENSE`): out as a core; used only as an external program for comparison, as it already is | C++/C# | | The reference retrowright already compares against | | | |

### GBA

| Candidate | Licence (file checked) | BIOS without a dump | Language, form | Maintained | Accuracy (published) | Speed (published) | EmulatorCore and toolkit fit | Node |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **mGBA** ([repo](https://github.com/mgba-emu/mgba)) | MPL-2.0 (`LICENSE`; headers, e.g. `src/gba/gba.c`). Bundled: inih (BSD-3), LZMA SDK and SQLite (public domain), zlib, libpng (libpng licence; GPL text only in libpng's build scripts and `contrib/`, not compiled), discord-rpc (MIT, desktop only) | **Yes**: built-in HLE BIOS (`src/gba/hle-bios.s`, README "A built-in BIOS implementation") | C, library API `struct mCore` | Yes, active | Its author's test suite ([mgba-emu/suite](https://github.com/mgba-emu/suite)); mGBA 0.8.0 passed all 625 HLE-BIOS tests where VBA-M passed 425 ([forum thread](https://forums.mgba.io/showthread.php?tid=18)); no current full table found | Fast natively; runs in phone browsers as gbajs3 ([live](https://gba.nicholas-vancise.dev)); no fps figures published | Everything: `runFrame`, `step`, `setKeys`, `saveState`/`loadState`, `savedataClone`, `rawRead8`/`rawWrite8` (no side effects) and `busRead8`, and a debugger with `setBreakpoint`, `setWatchpoint`, `trace` and access logs (`include/mgba/core/core.h`, `include/mgba/debugger/debugger.h`) | Through a wasm build |
| **mGBA wasm port** ([thenick775/mgba `feature/wasm`](https://github.com/thenick775/mgba/tree/feature/wasm), npm `@thenick775/mgba-wasm`) | MPL-2.0 (npm `license` field; the repo is a fork of the above) | Yes (mGBA's) | Emscripten build, 2.56 MB unpacked (npm 2.5.1) | Yes | As mGBA | As above | Its JS API is a whole front end (`loadGame`, `saveState(slot)`, `buttonPress`, its own main loop); no frame stepping or memory API, so retrowright would build its own thin glue over `mCore` instead | Not designed for it |
| **gbajs3** ([repo](https://github.com/thenick775/gbajs3)) | BSD-2 for its own code over gbajs (BSD-2) and mGBA (MPL-2.0) (`LICENSE`) | Yes (mGBA's) | React front end over the port above | Yes | As mGBA | Runs on phones | A front end, not a core; useful as a reference for browser audio and saves | No |
| **SkyEmu** ([repo](https://github.com/skylersaleh/SkyEmu)) | MIT (`LICENSE`); ships the Cult-of-GBA BIOS, MIT ([its LICENSE](https://github.com/Cult-of-GBA/BIOS/blob/master/LICENSE)), in `src/gba_bios.h` | **Yes**: Cult-of-GBA replacement BIOS, less accurate than a dump (README) | C, one large header per system, Emscripten web build ([web.skyemu.app](https://web.skyemu.app/)) | Yes | AGS aging cartridge passes; ArmWrestler and FuzzARM 100%; mGBA suite timing 2020/2020 with the official BIOS ([README](https://github.com/skylersaleh/SkyEmu#accuracycompatibility), [docs/Accuracy.md](https://github.com/skylersaleh/SkyEmu/blob/HEAD/docs/Accuracy.md)) | Web build installs as a PWA on Android and iOS; "a performance cost" in the browser (README), no numbers | No library API; an HTTP debug server in the app. Also does GB, GBC and DS. The project's `AGENTS.md` forbids AI-written code in contributions upstream, so patches to it would have to be written by hand | Through a wasm build |
| **gbajs** ([repo](https://github.com/endrift/gbajs), archived) | BSD-2 (`COPYING`, README) | Yes: ships `resources/bios.bin`, a replacement BIOS | JavaScript | No (gbajs3's LICENSE calls it archived) | Predecessor of mGBA by the same author; no table | Not measured | Plain JS objects; memory readable | Yes |
| **gbajs2** ([repo](https://github.com/andychase/gbajs2)) | BSD-2 (`COPYING`) | As gbajs | JavaScript | Not established | As gbajs | | | Yes |
| **IodineGBA** ([repo](https://github.com/taisel/IodineGBA)) | MIT (in the README and every source header, e.g. `IodineGBA/core/CPU.js`; no LICENSE file) | **No**: `attachBIOS` needs a BIOS before it runs (`IodineGBA/core/Emulator.js`) | JavaScript, web worker | Not established | No table | Designed for browsers | Not library-shaped | Yes, with shims |
| **RustBoyAdvance-NG** ([repo](https://github.com/michelhe/rustboyadvance-ng)) | MIT (`LICENSE`) | **No**: "You need to obtain a gba bios binary"; it suggests ReGBA's open BIOS (README); the MIT Cult-of-GBA BIOS could be loaded instead | Rust, has a wasm platform crate (`platform/rustboyadvance-wasm`) | Pushed to in 2026 ([gittrend](https://gittrend.io/repo/michelhe/rustboyadvance-ng)) | No table | Wasm demo exists; no numbers | Has a debugger feature | Through wasm |
| **ares** (above) | ISC | **No**: loads `bios.rom` (`ares/gba/system/bios.cpp`) | C++ | Yes | Accurate | Heavy | As for SNES | |
| **NanoBoyAdvance** ([repo](https://github.com/nba-emu/NanoBoyAdvance)) | **GPL-3.0 (`LICENSE`)**: out | | | | | | | |
| **Hades** ([repo](https://github.com/hades-emu/Hades)) | **GPL-2.0 (`LICENSE.md`)**: out | | | | | | | |
| **gpSP** ([repo](https://github.com/libretro/gpsp)) | **GPL-2.0 (`COPYING`)**: out | | | | | | | |

### Front ends that bundle cores

| Front end | Licence (file checked) | Note |
| --- | --- | --- |
| **EmulatorJS** ([repo](https://github.com/EmulatorJS/EmulatorJS)) | **GPL-3.0 (`LICENSE`)**: out | RetroArch compiled to wasm |
| **Nostalgist.js** ([repo](https://github.com/arianrhodsandlot/nostalgist)) | MIT (`license`) | Loads libretro cores built with Emscripten; each core keeps its own licence, so its SNES choice is snes9x (non-commercial) and its GBA choice mGBA (MPL-2.0). Running a libretro core through RetroArch's wasm build also brings RetroArch itself, which is GPL-3.0. The libretro API offers `retro_run` (one frame), `retro_serialize`, and memory by region, but no trace or breakpoints |

## Recommendation

### GBA: mGBA, built by retrowright with Emscripten

- **Why.** The only candidate that is permissive, accurate, maintained, needs no BIOS dump, and already has the whole toolkit as a C API: frame and instruction stepping, side-effect-free memory reads and writes, save states, battery saves, breakpoints, watchpoints and trace. It is known to run in phone browsers (gbajs3).
- **What retrowright adds.** A small C file of glue compiled with mGBA to wasm (one build for the browser and for Node), exporting what `EmulatorCore` needs and nothing of mGBA's front end; a TypeScript `MgbaCore` implementing `EmulatorCore`; GBA buttons (L, R) and a 240x160 picture, which today's fixed `SCREEN_WIDTH`/`SCREEN_HEIGHT` and `Button` enum do not allow.
- **MPL-2.0 duty.** File-level copyleft: any mGBA file retrowright changes must be published as source under MPL-2.0. Keep mGBA unmodified as a pinned submodule or vendored copy with its LICENSE, and put retrowright's glue in its own files; then only the notice and a source link are needed.
- **Risks.** Wasm speed on a mid-range phone is unmeasured. mGBA's audio is resampled by its own code; sample-exact audio comparisons between builds may differ. The HLE BIOS is not the real BIOS: a movie recorded with a real BIOS on another emulator can diverge at boot.
- **Runner-up.** SkyEmu: equally permissive, more accurate on published tests, ships an MIT BIOS; but no library API, no trace hooks outside its HTTP server, and contributions upstream must be hand-written.

### SNES: no permissive core is good enough; start with LakeSnes, decide on ares or our own core after measuring

Plainly: every accurate SNES core found is GPL or non-commercial (bsnes, snes9x, Mesen2, Supafaust, jgenesis), except ares, which is accurate and ISC but too heavy for a phone and not built for wasm. The permissive cores that are light (LakeSnes, SnesJs, JSMoo, rsnes) are incomplete: scanline PPUs, missing co-processors, and in JSMoo no audio.

The options, in order:

1. **LakeSnes (the dinkc64 fork), compiled to wasm. Recommended first.** MIT, including the fork's own CX4 files (`snes/cx4.c` says so in its header), C, and already shaped like `EmulatorCore` (run a frame, buttons, pixels, samples, battery, states, RAM, single-cycle stepping). It plays most LoROM/HiROM games. It is the cheapest way to have SNES at all and to measure wasm speed on a phone. What retrowright adds: the wasm glue, a `peek` that bypasses `snes_read`'s side effects, trace and breakpoint hooks in the CPU loop, and SA-1/Super FX/DSP-1 later or never. Risks: mid-scanline effects and timing are off (games that rely on them glitch, and TAS movies made on bsnes or Mesen will leave their route early); its speed in wasm may not reach 60 fps on a phone; its author lists "quick peeks" at Mesen-S, higan, bsnes and ares sources among their resources, so some code may reflect GPL designs. The MIT licence stands; retrowright's own changes to it must come from fullsnes and the SNESdev wiki, not from those sources.
2. **ares's SNES core, ported to wasm.** Accurate and ISC, but needs a libco backend for wasm and a phone fast enough for a cycle-synchronised core; likely desktop-only. A port is worth trying only if option 1's accuracy is not enough and a desktop-only accurate mode is acceptable.
3. **retrowright's own SNES core, written from fullsnes, the SNESdev wiki and anomie's documents, checked frame by frame against MesenCE.** The largest piece of work (65816, SPC700, S-DSP, PPU, DMA/HDMA), but the only way to get accuracy, phone speed, a permissive licence and toolkit hooks designed in. The checks already exist: TomHarte/SingleStepTests for the 65816 and SPC700, PeterLemon's CPU tests, blargg's SPC/DSP tests, undisbeliever's snes-test-roms, and `npm run diff` against MesenCE. LakeSnes (MIT) can be read for design, which is allowed; the GPL cores cannot.

## How each core is checked the way jsnes is

`docs/accuracy.md` checks jsnes two ways: replaying a TAS from another emulator to see how far it stays in step, and replaying a movie on jsnes and in MesenCE and comparing memory after each frame. Both carry over, since MesenCE's README lists SNES and GBA:

- **Frame-by-frame against MesenCE.** `harness/mesen.ts` drives MesenCE's Lua; its memory types differ per system (SNES work RAM 128 KB and SRAM; GBA EWRAM 256 KB, IWRAM 32 KB and save memory). `harness/memoryDump.ts`'s record layout is NES-specific (`addressOfOffset`) and becomes per system. The frame alignment check (`--leads`) is repeated per system, as the input poll point differs.
- **TAS replay.** SNES TASes (bsnes, lsnes `.lsmv`, BizHawk `.bk2`) and GBA TASes (BizHawk, VBA `.vbm`, mGBA) need converters like `npm run fm2`. GBA TASes made with a real BIOS will not boot identically on the HLE BIOS; those need a BIOS dump at test time (never committed) or a "skip BIOS" start on both sides.
- **Test ROMs, as tests.** SNES: SingleStepTests 65816 and SPC700 (JSON, run against the CPU cores in Node), PeterLemon CPU tests, blargg SPC tests, undisbeliever snes-test-roms. GBA: [jsmolka/gba-tests](https://github.com/jsmolka/gba-tests) (MIT; arm, thumb, memory, ppu, bios, save), mGBA suite, ArmWrestler, FuzzARM, SingleStepTests ARM7TDMI. The AGS aging cartridge is Nintendo's and cannot be distributed. Licences of each test set are checked before they are vendored.

## What a second core needs from retrowright

- **A multi-system `EmulatorCore`.** Picture size, frame rate, button set and memory regions come from the core rather than NES constants (`SCREEN_WIDTH`, `Button`, `peek`'s NES map), and movies record the system, with a movie that names none read as NES.
- **One wasm build for the browser and Node.** The harness replays movies in Node on the same `EmulatorCore`, so a core built with Emscripten has to load in both, with its licence notices shipped beside it.
- **The same checks jsnes has.** A test ROM suite run in Node, save state and battery save round trips, `npm run diff` against MesenCE with a per-system memory dump and frame alignment, and a measured frame rate on a desktop and a mid-range phone.
- **The toolkit hooks.** Trace and breakpoints that cost nothing while off: over mGBA's debugger platform, or in a SNES core's CPU loop.

## Sources

- Repositories, each linked in the tables; licence files as named, read in shallow clones (except the two rows named under Method).
- [mGBA README, third-party list and licence section](https://github.com/mgba-emu/mgba#copyright)
- [mGBA forum: test suite results](https://forums.mgba.io/showthread.php?tid=18)
- [thenick775/mgba feature/wasm](https://github.com/thenick775/mgba/tree/feature/wasm), [npm @thenick775/mgba-wasm](https://www.npmjs.com/package/@thenick775/mgba-wasm)
- [SkyEmu accuracy](https://github.com/skylersaleh/SkyEmu#accuracycompatibility), [Cult-of-GBA BIOS licence](https://github.com/Cult-of-GBA/BIOS/blob/master/LICENSE)
- [LakeSnes compatibility and resources](https://github.com/angelo-wf/LakeSnes#compatibility), [dinkc64 fork](https://github.com/dinkc64/LakeSnes)
- [Emulation General Wiki: SNES emulators](https://emulation.gametechwiki.com/index.php/Super_Famicom_(SNES)_emulators), [SkyEmu](https://emulation.gametechwiki.com/index.php/SkyEmu)
- [MesenCE](https://github.com/nesdev-org/MesenCE)
- [jsmolka/gba-tests](https://github.com/jsmolka/gba-tests)
- Hardware documentation for any core retrowright writes: [fullsnes](https://problemkaputt.de/fullsnes.htm), [SNESdev wiki](https://snes.nesdev.org/wiki/Main_Page), [GBATEK](https://problemkaputt.de/gbatek.htm)
