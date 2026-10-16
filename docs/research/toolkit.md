# A ROM toolkit: prior art for retrowright's developer tools

retrowright plays NES games, records and replays movies, reads Final Fantasy's state through a memory map, and compares jsnes with MesenCE frame by frame (`harness/`, `docs/accuracy.md`). This note surveys the tools emulators offer for taking a game apart (memory, graphics, CPU trace, patches, labels), says which of them retrowright writes itself and which it takes from elsewhere, and records what jsnes offers for them.

Of these, retrowright has the RAM search, the watch list and the memory viewer (`src/tools/`, the tools panel), the core's debug hooks, `romOffset` and `ppuSnapshot` (`src/core/types.ts`, `src/core/jsnesDebug.ts`), and IPS and BPS patching on Rom Patcher JS (`src/patch/`). The tile viewers, the trace logger, the disassembler and the label readers are not written.

## Method and its limits

- Licences were read from each repository's own licence file, in a shallow clone of its default branch at the time of writing; the file is named in the licence table. Where a repository has no licence file, the table says so. npm packages were checked through the registry's `license` field and named as such.
- Mesen's tool list and label formats and FCEUX's `.nl` format were read from their documentation pages [4][5][6]. The feature lists of FCEUX, BizHawk, mGBA and no$ are from their documentation as previously known and were not re-read; treat them as a starting point to check, not a citation. What users praise comes from forum threads, each a handful of posts, and is marked as such.
- GPL programs are studied for features and run as separate programs, as MesenCE is. None of their source was read for this note, and none is copied into retrowright (MIT).
- The jsnes facts are from jsnes 2.1.0's own source in `node_modules/jsnes/src/` (Apache-2.0), with file and line numbers, and from a probe that wrapped its CPU methods while running Final Fantasy (section 2).

## Summary

| Piece | Choice |
| --- | --- |
| Memory viewer and RAM search | **Written here** (`src/tools/`). No browser library does it; it is a small UI over `EmulatorCore.peek` and a per-frame snapshot, after FCEUX's and BizHawk's RAM Search (compare to previous value, to a number, changed or unchanged, narrowing list) and RAM Watch |
| Tile, palette and nametable viewers | **To write.** Decoding 2bpp NES tiles and the 64-colour palette is a few dozen lines; no maintained JS library exists. Mesen's PPU Viewer and FCEUX's PPU and Name Table viewers are the layouts to follow; `EmulatorCore.ppuSnapshot` gives the data |
| CPU trace logger and breakpoints | **To write**, on the core's debug hooks (section 2), with Mesen's and FCEUX's trace line (PC, bytes, disassembly, A X Y P SP, cycle, scanline) and their breakpoint kinds (execute, read, write, with a condition) |
| 6502 disassembly for the trace | **To write**: a small table-driven disassembler from the 6502 opcode table; `6502-reasm` (MIT, one 2017 release) is the only npm candidate and is unmaintained |
| Patch maker and applier (IPS, BPS) | **Rom Patcher JS** (MIT), vendored (`src/vendor/rompatcher/`): it applies and creates IPS and BPS in the browser and in Node. Flips (GPL-3.0) is the reference desktop tool, run as a separate program to cross-check patches |
| Labels from Ghidra or REA | **To write**: a reader for Mesen `.mlb` and FCEUX `.nl` (plain text, a few lines each), and a small Ghidra script (Ghidra is Apache-2.0) that writes `.mlb`. ca65 `.dbg` only if a ca65 disassembly is used |

## 1. The toolkit pieces

### 1.1 Memory viewer and RAM search

**The desktop emulators (from their documentation):**
- *FCEUX* (GPL-2.0): Hex Editor, RAM Search (narrow candidates by comparing each address with its previous value, a given value or a given address, with "changed", "unchanged", "greater", "less"), RAM Watch, Cheat search, and Lua. These are the tools TAS and ROM-hacking guides point to for "find the address that changes when the player jumps".
- *BizHawk* (MIT front end): RAM Search and RAM Watch modelled on FCEUX's, with sizes (1, 2, 4 bytes), signedness and endianness, plus a hex editor and Lua. Its RAM tools work the same on every system it runs, which is why TASers use it for SNES and GBA too.
- *Mesen* (GPL-3.0): Memory Tools, a hex editor and memory viewer, with labels shown on addresses [4]. Its documentation lists no RAM search as such.
- *mGBA* (MPL-2.0): a memory viewer and memory search for GBA, a GDB stub and a command-line debugger.
- *no$nes, no$gba*: freeware, closed source; a hex view with a debugger. Studied only from its help text.

**What users praise:** Mesen's debugger tools over FCEUX's in nesdev forum threads ("offers a number of tools that FCEUX is missing", a preferred interface), while long-time users keep FCEUX out of habit, and one developer reports FCEUX's debugger occasionally crashing when typing in its text fields [8][9][10] (forum threads and one set of notes). No thread found praises a RAM search specifically.

**Browser and JS:** no library found that implements RAM search over an emulator. EmulatorJS (GPL-3.0) offers cheats through RetroArch cores, not a search.

**jsnes:** work RAM at `cpu.mem[$0000-$07FF]` and cartridge RAM at `cpu.mem[$6000-$7FFF]` (`node_modules/jsnes/src/cpu.js:2336`, `:2435`), which `EmulatorCore.peek` reads without side effects.

**Why it is written here.** A RAM search is a list of candidate addresses and a snapshot of their values from the previous step; each step filters by a comparison. On the NES it is 2 KB of work RAM plus 8 KB of cartridge RAM, so a full snapshot per frame is cheap. It needs nothing from the core beyond `peek`, and is tested in Node against movies the harness replays (`src/tools/ramSearch.test.ts` finds Final Fantasy's map byte). The memory viewer's read and write marks come from the access hooks of section 2.

### 1.2 Tile, palette and nametable viewers

**The desktop emulators:** FCEUX has a PPU Viewer (both pattern tables, the palettes, pick a palette to colour the tiles) and a Name Table Viewer (the four nametables with the scroll rectangle drawn on them). Mesen's PPU Viewer combines CHR, nametables, sprites and palette with a hover panel per tile (address, tile index, palette, attribute). mGBA has tile, sprite (OAM), map and palette viewers. no$nes and no$gba have VRAM viewers.

**Browser and JS:** browser tile editors exist, but no maintained library that decodes NES tiles from an emulator's state. YY-CHR, Tile Layer Pro and NEXXT are desktop editors.

**jsnes:** the PPU keeps its memory in plain arrays on the instance: `vramMem` (`node_modules/jsnes/src/ppu/index.js:23`, pattern tables at `$0000-$1FFF`, nametables at `$2000-$2FFF` through `vramMirrorTable` at `:168`), `spriteMem` (`:24`, OAM), `imgPalette` and `sprPalette` (`:149-150`, already converted to RGB), `ptTile` (`:153`, decoded tiles) and `nameTable` (`:162`). All are part of its save state. Banked CHR is copied into `vramMem` by the mappers (`node_modules/jsnes/src/mappers/mapper0.js:460`, `loadVromBank`), so `vramMem` always holds what the PPU sees now.

**Shape.** `EmulatorCore.ppuSnapshot()` returns copies of pattern memory, nametables (after mirroring), OAM and the 32 palette indices; a viewer draws them into canvases. Decoding a 2bpp tile is 16 bytes to 64 pixels. Palette indices rather than jsnes's RGB keep a viewer independent of jsnes's palette, which differs from MesenCE's.

### 1.3 CPU trace logger and breakpoints

**The desktop emulators:** FCEUX's debugger has breakpoints on execute, read and write of a CPU address or range, with conditions (`A == #$05`) and a Trace Logger that writes every instruction with registers, optionally only code not yet logged (via its Code/Data Logger). Mesen's Debugger has the same breakpoint kinds plus PPU memory breakpoints, conditions in a richer expression language, an Event Viewer that plots register writes on a scanline-by-dot grid, a Trace Logger with a configurable line format, and a Performance Profiler. mGBA has breakpoints and watchpoints in its CLI debugger and a GDB stub. BizHawk has a debugger and a trace logger whose output differs per core.

**Browser and JS:** none that hook jsnes. jsnes's own Game Genie (`node_modules/jsnes/src/cpu.js:2297-2322`) shows the pattern jsnes uses for optional per-read work: it swaps `loadFromCartridge` on the instance only while codes are active, so the plain path pays nothing.

**Shape.** On the core's debug hooks (section 2), with the trace line in Mesen's and FCEUX's spirit: `PC  bytes  mnemonic operand  A X Y P SP  cycle  scanline`, with labels from section 3. The trace belongs in a ring buffer (the probe below keeps 65536 PCs at a cost of a third of the speed), written to a file only on request.

**6502 disassembly.** The trace and a code view need one. Candidates: `6502-reasm` on npm (MIT by its registry field, one release, 2017), the Kaitai Struct `code_6502` spec (needs the Kaitai runtime), cc65's `da65` (zlib, a separate C program), 6502bench SourceGen (Apache-2.0, a Windows desktop disassembler that also exports labels). jsnes's `OPCODE_TABLE` (`node_modules/jsnes/src/cpu.js`, decoded at `:851`) holds instruction and addressing mode per opcode but no mnemonic strings. A 256-entry table (mnemonic, mode, size) and a formatter, tested against the opcode sizes in jsnes's table, is smaller than adapting any of these, and a ROM's code view also needs the bank and label lookups none of them has.

### 1.4 Patch maker and applier (IPS, BPS)

**The desktop tools:** Flips (Floating IPS, GPL-3.0, its repository also holds `bps_spec.md`) is the reference for creating and applying BPS and IPS; Lunar IPS is closed freeware. Several emulators apply a patch placed next to the ROM when loading it; which formats each accepts was not checked.

**Browser and JS:** **Rom Patcher JS** (MIT, LICENSE file) applies IPS, BPS and other formats, creates patches, runs in the browser and in Node (`node index.js patch`, `node index.js create`, from its README), and unzips. `rpatcher` (npm) and `rompatcher-ts` are rewrites of it; their licences were not read from a file (a search summary gives GPL-3.0 for the latter).

**Why Rom Patcher JS.** retrowright vendors its BPS and IPS format modules (MIT, attributed in `NOTICE`) rather than its whole web app: it needs patching in the library (apply a patch to a stored ROM, keep the result as a new library entry keyed by its SHA-256) and patch creation in the harness (`npm run patch`). BPS is preferred: it records the source and target CRC32, so applying it to the wrong ROM fails loudly, and it carries metadata. `e2e/patch.mjs` cross-checks a patch made in retrowright with Flips, run as a separate program, when Flips is installed.

## 2. What jsnes offers for trace and breakpoints

### jsnes 2.1.0's CPU, where the hooks go

- **The frame loop:** `NES.frame` (`node_modules/jsnes/src/nes.js:62-113`) calls `cpu.emulate()` once per instruction (`:80`) until the PPU sets `frameEnded` (`:88`). There is no step call: a single instruction can only be run by calling `cpu.emulate()` directly, which skips the APU clocking at `:84` and the frame-end check.
- **One instruction:** `CPU.emulate` (`node_modules/jsnes/src/cpu.js:748`). An NMI taken "immediately" returns at `:754-768` without running an instruction; IRQ and reset are serviced at `:797-825`. The opcode is fetched at `:842` from `REG_PC + 1` (jsnes keeps `REG_PC` one less than the next opcode's address), decoded at `:851`, and `opaddr` is kept at `:859`. **The execute hook goes at `:842`, before the fetch: PC is `REG_PC + 1`.**
- **Every bus access goes through seven methods:** `load` (`:2333`, data reads, including PPU and APU registers), `loadDirect` (`:2382`, zero page and operand fetches), `load16bit` (`:2395`, two-byte reads: operands, pointers, vectors), `loadFromCartridge` (`:2297`, opcode fetch and anything above `$4000`), `write` (`:2422`), `push` (`:2455`) and `pull` (`:2466`). A grep for `this.mem[` in `cpu.js` finds only these and the power-on fill (`:645-648`), so no instruction writes RAM behind them. **Read and write hooks go in `load`, `write`, `push` and `pull`; operand and opcode fetches (`loadDirect`, `load16bit`, `loadFromCartridge`) are execute-side and are left out of data breakpoints, as Mesen and FCEUX do.**
- **Banks:** mappers copy PRG banks into `cpu.mem[$8000-$FFFF]` (`node_modules/jsnes/src/mappers/mapper0.js:446`, `loadRomBank`; `:544`, `load8kRomBank`) and keep no record of which bank sits where. A label for PRG ROM (Mesen's `P:` prefix, FCEUX's per-bank `.nl` files) is keyed by ROM offset, so the trace needs a CPU-address-to-ROM-offset map; `JsnesCore` wraps `loadRomBank` and `load8kRomBank` to record the bank per 8 KB slot (`PrgBankMap` in `src/core/jsnesDebug.ts`).
- **Halting mid-frame:** jsnes has no way to stop inside `frame()` and resume. A breakpoint can stop between instructions only by throwing out of the loop, which sets `crashed` (`node_modules/jsnes/src/nes.js:108-110`). So a hook that asks to stop records the hit and lets the frame finish, which is enough for "who wrote `$0057`" and for trace capture; stopping on the instruction itself would need a step loop outside `NES.frame` that reproduces `:76-107` one instruction at a time.

### The probe

A probe, not part of the repository, loaded Final Fantasy into a bare jsnes `NES`, wrapped `emulate` (recording PC into a 65536-entry ring), and `load`, `loadDirect`, `load16bit`, `write`, `push`, `pull` (counting calls, and checking `write` against a watch set), and ran 3000 frames without input, against an unwrapped run:

| Run | Time | Frames/s | Work RAM SHA-256 after 3000 frames |
| --- | ---: | ---: | --- |
| Plain | 3005 ms | 998 | `68084f1b7f56a5f7…` |
| Wrapped | 4479 ms | 670 | `68084f1b7f56a5f7…` (same) |

Over 3000 frames: 29,694,742 instructions; 849,374 `load`, 988,526 `loadDirect`, 28,583,545 `load16bit`, 385,320 `write`, 81,936 `push`, 81,928 `pull` calls. So hooks can be added from outside jsnes, by wrapping methods on the instance, without changing what the game does, at about 1.5 times the cost; the plain core keeps its speed while no tool is open because the wrappers are installed only then (jsnes's own Game Genie swap). The game was idle at the title screen (the last PCs were all `$FEBB`), so the count says nothing about a busy frame.

### What `EmulatorCore` has

All optional, so a core without them still plays and replays (`src/core/types.ts`): `setDebugHooks` (an execute hook before each instruction, and read and write hooks on data accesses in given address ranges, each able to ask for a stop at the end of the frame), `romOffset` (the PRG ROM offset mapped at a CPU address) and `ppuSnapshot`. `JsnesCore` implements them by instance wrapping as in the probe, behind `src/core/` (nothing else imports jsnes). Registers are on the CPU object (`REG_ACC`, `REG_X`, `REG_Y`, `REG_SP`, `REG_PC`; the status byte from `getStatus()`, used at `node_modules/jsnes/src/cpu.js:798`). Hooks are not part of save states or movies, so replay stays exact; `harness/replay.test.ts` replays a movie with hooks on and off and compares frame hashes.

## 3. Labels from Ghidra and REA

**Formats the emulators read:**
- **Mesen `.mlb`**: one label per line, `<type>:<address>[-<end>]:<label>[:<comment>]`, with `P` PRG ROM offset, `R` internal RAM, `S` save RAM, `W` work RAM, `G` register (e.g. `P:100:MyLabel:This is a comment`, `R:200-2FF:ShadowOam`). That is the old format, in Mesen 1's documentation. The new format, for Mesen 2, names the memory instead of a letter: asm6f's source maps `G`, `P`, `R`, `S`, `W` to `NesMemory`, `NesPrgRom`, `NesInternalRam`, `NesSaveRam`, `NesWorkRam` (`asm6f.c:1281`), and writes the new format with `-m` and the old with `-M`. A reader should take both. Mesen also imports ca65 `.dbg` files (written with `--dbgfile`) and NESASM `.fns` files [5].
- **FCEUX `.nl`**: one file per 16 KB PRG bank, `<rom>.nes.<bank in hex>.nl`, plus `<rom>.nes.ram.nl` for `$0000-$7FFF`; each line `$C000#Name#Comment`, with `/n` after the address for an array [6].
- **ca65 `.dbg`**: the richest (files, lines, scopes, segments), and the format to read if a ca65 disassembly is used.
- **Ghidra** (Apache-2.0) has no NES loader of its own. GhidraNes, the iNES loader extension, adds memory blocks and the hardware register labels, but its repository has no licence file, so it is usable as a tool and not as code to adapt. Ghidra's symbol table can be exported by a script.

**Shape.** `.mlb` suits retrowright as its own label format: it is plain text, carries ROM offset rather than CPU address so it survives bank switching, and assemblers such as asm6f write it. `.nl` is read for FCEUX users. Labels made in Ghidra join through a short Ghidra script (Java or Python, written for this, since Ghidra's own scripts are Apache-2.0 and may be read) that walks the program's functions and labels and writes `.mlb` lines: `P:` for symbols in a PRG block (offset = bank × bank size + address − bank base, using GhidraNes's block names), `R:`/`S:` for RAM. REA output goes through the same `.mlb` writer, whatever its native form. The trace and memory views then show `ReadPad+$12` instead of `$B34F`, using `romOffset` to look up `P:` labels and the address itself for `R:` and `S:`.

The same file loads into Mesen, so Ghidra's labels show in MesenCE and in retrowright alike. The Final Fantasy memory map (`src/games/ff1/memoryMap.ts`) already names RAM addresses, which can be written as `R:` lines.

## 4. SNES and GBA

What carries over: the RAM search, memory viewer, patching (BPS was designed for SNES ROMs; Rom Patcher JS covers both), the `.mlb` label reader, and sharing a change as a BPS patch rather than a ROM. What does not: the jsnes hooks and the PPU snapshot, which belong to each core.

- **SNES:** Mesen 2 (the same GPL-3.0 program as MesenCE) is a multi-system emulator (its README: NES, SNES, Game Boy, Game Boy Advance, PC Engine, SMS/Game Gear, WonderSwan) with the NES tools on each; its new `.mlb` format names memory per system (section 3), but the SNES and GBA names were not checked; bsnes-plus (GPL-2.0, per its README; no licence file) is the other debugger used for SNES hacking. Assemblers: asar (LGPL-3.0, with a looser grant for personal use; a patch assembler widely used in SNES hacking), WLA-DX (GPL-2.0-or-later, as a separate program).
- **GBA:** mGBA (MPL-2.0) has memory search, tile, sprite, map and palette viewers, and a GDB stub, and is the one desktop emulator whose code could be used in retrowright (MPL-2.0, file-level copyleft). The pret decompilations (for example pokeemerald) build byte for byte with their own toolchain; pokeemerald has no licence file. Ghidra's ARM support is native, so GBA work in Ghidra needs no loader extension.
- In the browser, both need a new core (`docs/research/cores.md`; emulator-ux.md's note on threads applies: SharedArrayBuffer cannot be enabled on GitHub Pages), so the SNES and GBA tools wait on that core.

## 5. Bearing of `docs/research/emulator-ux.md` on the toolkit's interface

- Menus stay HTML, not drawn on the canvas, reachable by keyboard and gamepad, with visible focus (section 6 of that document). The tool panels follow: a memory table is an HTML table, a tile viewer a canvas with HTML controls.
- RetroArch's lesson: features hidden in a menu that outgrew its purpose. The tools sit in their own panel beside the screen, opened from the menu, not inside the quick menu.
- Hardcore achievement mode must block cheats and similar tools [that document, section 3]: if achievements come, memory editing and breakpoints turn off with them.
- The licence rule there (GPL code is not taken into an MIT repository) is the same rule this note follows.

## 6. Licence table

| Candidate | What | Licence (file read) | Use in retrowright |
| --- | --- | --- | --- |
| jsnes 2.1.0 | The core | Apache-2.0 (`package.json` `license`; `NOTICE` in this repo) | Used; hooks by instance wrapping |
| Rom Patcher JS | IPS/BPS apply and create, browser and Node | MIT (`LICENSE`) | **Used**: the BPS and IPS modules are vendored, credited in `NOTICE` |
| Flips | IPS/BPS reference tool, BPS spec | GPL-3.0 (`COPYING`, `COPYING.gpl3`) | Separate program, to cross-check patches |
| Mesen 2 / MesenCE | NES/SNES/GBA debugger | GPL-3.0 (`LICENSE`) | Separate program (for `npm run diff`); features studied |
| FCEUX | NES debugger, RAM Search | GPL-2.0 (`COPYING`) | Features studied |
| BizHawk | Multi-system TAS emulator, RAM Search | MIT for the C# front end, cores mixed (`LICENSE`) | Features studied; its front-end code could be read, but the RAM search is too small to need it |
| mGBA | GBA emulator and debugger | MPL-2.0 (`LICENSE`) | Studied; usable for GBA |
| Ghidra | Disassembler and decompiler | Apache-2.0 (`LICENSE`) | Run outside retrowright; a label-export script writes `.mlb` from it |
| GhidraNes | Ghidra iNES loader | No licence file (GitHub reports none) | Run as a tool only |
| 6502bench SourceGen | 6502 disassembler | Apache-2.0 (`LICENSE`) | Optional desktop tool |
| nesgodisasm | NES disassembler to asm6/ca65/nesasm | Apache-2.0 (`LICENSE`) | Optional, for games without a community disassembly |
| 6502-reasm | JS 6502 disassembler | MIT (npm registry `license` field; not read from a file) | Not used: one 2017 release |
| cc65 (ca65, ld65, da65) | Assembler, linker, disassembler | zlib (`LICENSE`) | Optional assembler |
| asm6f | Assembler, writes `.mlb` and `.nl` | Public-domain style grant (`LICENSE.txt`) | Optional assembler, as a separate program |
| asar | SNES assembler | LGPL-3.0 (`LICENSE`, `license-lgpl.txt`) | Separate program, for SNES |
| WLA-DX | Multi-CPU assembler | GPL-2.0-or-later (`LICENSE`) | Separate program only |
| bsnes-plus | SNES debugger | GPL-2.0 (README; no licence file) | Studied only |
| pret/pokeemerald | GBA decompilation | None | Reference |
| EmulatorJS | Web front end | GPL-3.0 (from emulator-ux.md) | Not used |
| YY-CHR, Tile Layer Pro, NEXXT, Lunar IPS, Lunar Magic, no$nes, no$gba | Desktop editors and emulators | Closed freeware or unstated | Features studied only |

## Sources

1. Rom Patcher JS, README and LICENSE: https://github.com/marcrobledo/RomPatcher.js
2. Flips, README, COPYING and `bps_spec.md`: https://github.com/Alcaro/Flips
3. Mesen 2: https://github.com/SourMesen/Mesen2
4. Mesen documentation, debugging tools: https://www.mesen.ca/docs/debugging.html
5. Mesen documentation, integration with compilers (`.mlb`, `.dbg`, `.fns`): https://www.mesen.ca/docs/debugging/debuggerintegration.html
6. FCEUX help, NL files format: https://fceux.com/web/help/NLFilesFormat.html
7. FCEUX: https://github.com/TASEmulators/fceux ; BizHawk: https://github.com/TASEmulators/BizHawk ; mGBA: https://github.com/mgba-emu/mgba
8. nesdev forum, "Any accurate emulator with good debug features?": https://archive.nes.science/nesdev-forums/f3/t16619.xhtml
9. nesdev forum, "Your NES emulator of choice?": https://archive.nes.science/nesdev-forums/f5/t15491.xhtml
10. NES development tools notes (FCEUX debugger, moving to Mesen): https://notes.chipx86.com/Knowledge+Base/Software+and+Services/Development/NES+Development+Tools
11. GhidraNes: https://github.com/kylewlacy/GhidraNes ; Ghidra: https://github.com/NationalSecurityAgency/ghidra
12. 6502bench SourceGen: https://github.com/fadden/6502bench ; nesgodisasm: https://github.com/retroenv/nesgodisasm ; 6502-reasm: https://www.npmjs.com/package/6502-reasm
13. cc65: https://github.com/cc65/cc65 ; asm6f: https://github.com/freem/asm6f ; asar: https://github.com/RPGHacker/asar ; WLA-DX: https://github.com/vhelin/wla-dx ; bsnes-plus: https://github.com/devinacker/bsnes-plus
14. pret/pokeemerald: https://github.com/pret/pokeemerald
