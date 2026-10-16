# TAS sources

Tool-assisted movies used as accuracy tests. The movies themselves are not committed: they are kept locally under `movies/tas/` (git-ignored), with their conversions. This file records where each came from, so anyone can fetch the same bytes and check them.

## Final Fantasy (USA): TheAxeMan, "Console Verification", submission 4450S

| | |
| --- | --- |
| Page | https://tasvideos.org/4450S |
| Download | https://tasvideos.org/4450S?handler=Download (`submission4450.zip`, 32437 bytes) |
| Fetched | 2026-10-10 |
| SHA-256 of the zip | `beb6f907dcb36fa20c5e340cbbc61096fbcf0b870c39a3a6b43893ee8ddf8e2f` |
| File in the zip | `FinalFantasy-noResets-final-fromStart.fm2` (3866137 bytes) |
| SHA-256 of the .fm2 | `62b061ca00f25f4f9b0bd084fe5ba67f702c8af8fa3dad7c968acc50fc6f6d91` |
| Local copy | `movies/tas/FinalFantasy-noResets-final-fromStart.fm2` |
| Converted | `movies/tas/ff1-tas-4450.rwmovie.json` |

The submission was rejected (slower than the published any% run, 2079M), so it never became a publication; the zip on the submission page is the movie. Header: `version 3`, `emuVersion 21040`, `rerecordCount 48871`, `palFlag 0`, `romFilename Final Fantasy (U)`, one gamepad on port 0, no save state (it starts from power-on), 257725 frames, no reset or power commands. The submission page gives FCEUX 2.2.2 as the emulator.

ROM: the header's `romChecksum` is `base64:JK5e34N1Fi+RpoRtMgLj1g==`, MD5 `24ae5edf8375162f91a6846d3202e3d6` of PRG and CHR. `roms/Final_Fantasy_USA.nes` has the same MD5 (file SHA-256 `f81377a4…`, the ROM the Final Fantasy memory map knows), so they match.

Converted with:

```sh
npm run fm2 -- movies/tas/FinalFantasy-noResets-final-fromStart.fm2 movies/tas/ff1-tas-4450.rwmovie.json --rom roms/Final_Fantasy_USA.nes
```

How far it gets on jsnes, and from which start, is in `docs/accuracy.md`.
