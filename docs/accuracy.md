# Accuracy

How closely the core runs real games, measured by replaying tool-assisted movies made on other emulators. A TAS is frame-exact input: it leaves its route at the first frame where the two emulators differ in a way the game notices, so how far it gets is a measure of the core. Each result names the core and version, the movie, and the start it was replayed from, so a later core change can be run against the same movie and compared.

Sources of the movies are in `movies/TAS-SOURCES.md`. The movies stay local (`movies/tas/`).

## Final Fantasy (USA), TAS 4450S (FCEUX, 257725 frames, no resets)

**jsnes 2.1.0: completes the game.** Replayed from power-on with cleared battery RAM and jsnes's own power-on work RAM, the movie stays in step for all 257725 frames: the party beats Garland and the pirates in Pravoka, goes through every dungeon on the route, and reaches Chaos; the movie's last input picks the Bane sword with one Fighter left at 1 HP, and with no further input the battle ends at frame 258118 and the ending text follows (seen at frame 261300).

Milestones on that run (frame after which the state was read; map numbers are the game's `$48`):

| Frame | Milestone |
| ---: | --- |
| 1122 | first battle, imps on the world map (ends 1384, no damage) |
| 2145 | Temple of Fiends (map 12) |
| 2528 | Garland fight; ends 5349, gold 400 to 650, the lead Fighter dead (moved to the back at 5862) |
| 7561 | Coneria Castle 1F (map 8) |
| 12251 | Pravoka (map 1); pirates fight 13639 to 16657, gold 650 to 960 |
| 23368 to 256538 | every later dungeon and town, map numbers in order 22, 27, 28, 10, 20, 9, 8, 19, 13, 29, 30, 60, 21, 31, 32, 4, 15, 37, 38, 5, 6, 44, 45, 46, 43, 42, 18, 3, 7, 23, 40, 41, 47-51, 14, 33-36, 12, 52-59 |
| 257587 | last battle, Chaos (map 59) |
| 257725 | movie ends: Bane sword chosen, one Fighter at 1 HP, three dead |
| 258118 | battle over (no input after 257725) |

There is no first diverging frame to report on this start.

### Start alignment

Measured with `npm run tas:sweep`, which compares each start with the run above every 60 frames (map, scroll position, party HP and deaths, gold) from frame 600 on, and stops at the first difference. "Lead" shifts the movie against jsnes's frame 0: lead 1 runs one empty frame first, lead -1 drops the movie's first (empty) frame.

| Lead | jsnes power-on RAM | Zeros | FCEUX pattern (4 x $00, 4 x $FF) |
| ---: | --- | --- | --- |
| -3, -2 | no game started by frame 600 | same | same |
| -1 | off at 6480 | off at 1260 | **in step to 257640 (whole movie)** |
| 0 | **whole movie** | off at 1260 | off at 6480 |
| 1 | off at 6480 | off at 1260 | off at 12660 |
| 2 | off at 12660 | off at 1260 | off at 9540 |
| 3 | off at 9540 | off at 1260 | off at 6480 |

(Leads -3 to 3 were compared to frame 15000, and lead -1 with the FCEUX pattern to the end of the movie.)

- jsnes's own power-on RAM at lead 0 and FCEUX's pattern at lead -1 give the same run; every FCEUX-pattern column matches the jsnes column one lead later. So with FCEUX's RAM contents jsnes needs the movie one frame earlier: the game's start-up takes one frame longer on jsnes when its RAM holds FCEUX's pattern, or one frame less when it holds jsnes's. Which of the two is jsnes's actual difference from FCEUX (a RAM-dependent loop at start-up, or the frame on which jsnes's first `frame()` begins) is not established here.
- All-zero RAM is off by one tile on the world map at frame 1260 on every lead: something the game reads before it initialises it differs.
- A one-frame shift is enough to fail: at lead -1 on jsnes RAM, both runs show the same screen at 6420 and 6440, then in the Temple of Fiends a bat walks into the party's path (its text box opens) and the party stops a tile short of the princess.

### Battle RNG state

Final Fantasy keeps the battle RNG's state at `$688A`, in battery RAM (Disch's disassembly, `btl_rngstate`), and the movie was made from a cleared cartridge. Nothing reads it before the first battle. Of the 256 starting values, 17 (0, 5, 7, 9, 10, 18, 23, 35, 90, 95, 133, 136, 153, 157, 173, 179, 220) give the same imp fight and stay in step to frame 3000; all but 0 leave the route in the Garland fight by frame 3360. The start is cleared battery RAM, as the movie's notes say.

### Reproduce

```sh
npm run fm2 -- movies/tas/FinalFantasy-noResets-final-fromStart.fm2 movies/tas/ff1-tas-4450.rwmovie.json --rom roms/Final_Fantasy_USA.nes
npm run tas:trace -- roms/Final_Fantasy_USA.nes movies/tas/ff1-tas-4450.rwmovie.json --out <dir> --shots --after 3600
npm run tas:sweep -- roms/Final_Fantasy_USA.nes movies/tas/FinalFantasy-noResets-final-fromStart.fm2 --leads -3,-2,-1,0,1,2,3 --ram jsnes,zeros,fceux --until 15000
```

The full trace runs at about 1000 frames a second (about 4.5 minutes).

## jsnes against MesenCE, frame by frame

`npm run diff` replays a movie on jsnes 2.1.0 and in MesenCE 2.2.1 (run as an external program in its `--testrunner` mode) and compares work RAM and cartridge RAM after each frame; see `docs/design.md` (Harness). MesenCE starts from jsnes's power-on memory (work RAM and the movie's cleared battery RAM written by the Lua script before the first frame), so the two differ only in how they run.

### Frame alignment

- **Input.** MesenCE raises its `inputPolled` event at scanline 241, right after `endFrame` at scanline 240, and the pad set there holds until the next poll; there is no poll before its first `endFrame`. On a synthetic ROM that reads the pad in a busy loop, an A press held during movie frame 5 is read during frame 6's count on both emulators (jsnes for the whole frame, MesenCE from scanline 241 after frame 5 to scanline 241 after frame 6). On a synthetic ROM that reads the pad in its NMI handler, the two agree byte for byte for 40 frames with presses at frames 5-7 and 20 (`harness/mesen.test.ts`).
- **Start offset: 0.** "Lead" shifts the movie against MesenCE's frame 0, as in the jsnes start alignment above. Measured with `--leads`:

| Lead | ff1-new-game, every frame, game state | TAS 4450S, every 60 frames from 600 to 15000, game state |
| ---: | --- | --- |
| -2 | differs from frame 3 | differs at 600 |
| -1 | differs from frame 3 | differs at 6480 |
| **0** | **the same at all 3278 frames** | **the same to 15000** |
| 1 | differs from frame 2 | differs at 6480 |
| 2 | differs from frame 1 | differs at 12660 |

So jsnes and MesenCE run the same number of frames before Final Fantasy's first input read, and a movie needs no shift between them. Leads ±1 leave the TAS's route at 6480, the frame where a one-frame shift also failed on jsnes alone.

### Results

"Game state" is what the Final Fantasy memory map reads (party, gold, map, scroll position, battle flag). None of the raw bytes that differ below are in the memory map; the names given are Disch's disassembly's (`variables.inc`).

**ff1-new-game (3278 frames, every frame compared).** Game state is the same at every frame. Raw memory:

- Frame 7, 10 bytes: `$37` menustall `$00`, `$3B` dest_y `$03`, `$3E-$3F` text_ptr `$20 $BF`, `$57` cur_bank `$0D`, `$58` ret_bank `$0E`, `$3C6`, `$3C7`, `$3CA`, `$3CB` (cur_pal) `$01` on jsnes; all still `$FF`, the power-on value, in MesenCE. jsnes's start-up code reaches these writes before the end of frame 7, MesenCE's after it. From frame 8 to 304 the two are identical.
- Frame 305, just after the first Start press (held during frames 300-303), 2 bytes: `$3E` text_ptr `$6C` against `$69`, `$54` ppu_dest `$CF` against `$CD` (jsnes, then MesenCE). These are drawing pointers the main loop is advancing when the frame ends: jsnes's loop got further through the same work before its frame ended, a CPU/PPU timing difference within the frame, not a different game. Both screens are black (the fade after Start).

**TAS 4450S (257725 frames).** Every frame compared to frame 6000:

- Frame 7: the same 10 start-up bytes as above.
- Frame 15 (from frame 8 on), just after the first Start press (held during frame 10): `$3E` text_ptr `$6A`/`$68` and `$54` ppu_dest `$CE`/`$CC`, the same timing difference.
- Frame 1468: the game state differs for one frame, world map scroll Y 130 on jsnes and 131 in MesenCE (MesenCE takes the step north one frame later); memory is identical again from frame 1469 to 2144. Both screens are black (a transition).
- Frame 2145 (from frame 1469 on), the frame the party enters the Temple of Fiends: `$10` `$4E`/`$4C`, `$12` `$4F`/`$47`, `$14` `$30`/`$55` (all in `tmp`, scratch bytes), `$724F-$7252` `$30`/`$17` (in `mapdata`, the buffer the temple's map is being unpacked into): the two are at different points of loading the map when the frame ends. The screenshots differ visibly: the world map closes to a strip as the party enters, and MesenCE draws the strip a few lines lower and taller than jsnes, a timed mid-frame effect landing on other scanlines. Game state stays the same at every frame from 1469 to 6000.

Every 60 frames over the whole movie, the game state is the same at all 4295 frames compared (60 to 257700): **MesenCE keeps the TAS in step to the end, as jsnes does**, and neither leaves the route before the other. (At this spacing raw memory first differs at frame 180, in `tmp` scratch bytes `$10-$13` and `$7800`, during the start-up screens.)

`npm run diff` saves a screenshot from each emulator at each of these frames under its `--out` folder; they show a commercial game, so they are not in the repository.

### Reproduce (MesenCE)

```sh
npm run diff -- roms/Final_Fantasy_USA.nes movies/ff1-new-game.rwmovie.json --leads -2,-1,0,1,2
npm run diff -- roms/Final_Fantasy_USA.nes movies/ff1-new-game.rwmovie.json --lead 0 --from 8 --out <dir>
npm run diff -- roms/Final_Fantasy_USA.nes movies/tas/ff1-tas-4450.rwmovie.json --leads -2,-1,0,1,2 --every 60 --from 600 --until 15000
npm run diff -- roms/Final_Fantasy_USA.nes movies/tas/ff1-tas-4450.rwmovie.json --lead 0 --from 1469 --until 6000 --out <dir>
npm run diff -- roms/Final_Fantasy_USA.nes movies/tas/ff1-tas-4450.rwmovie.json --lead 0 --every 60 --out <dir>
```

MesenCE runs about 300 frames a second with a dump after every frame; the whole TAS every 60 frames takes about 15 minutes (jsnes 256 s, MesenCE 640 s).
