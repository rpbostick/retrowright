# AGENTS.md

retrowright is a browser NES emulator (TypeScript, React, Vite, jsnes). Read `docs/design.md` before changing a layer.

- `npm test`: unit tests (Vitest). `npm run build`: type-check and build `dist/`.
- `npm run e2e:all`: build, then every browser check in headless Firefox (needs Firefox and Node.js 22.12+).
- `npm run licenses`: rewrite `THIRD_PARTY_LICENSES` after changing a dependency; a test fails when it is stale.
- `npm run scan:secrets`: secretlint over the tree and `dist/`.
- Never commit ROMs, game bytes, movies or save states of commercial games, or screenshots of them. `roms/` is git-ignored.
- Tests and browser checks build synthetic ROMs in code (`src/test/syntheticRom.ts`); those that need a real ROM skip without it, naming it.
- Only `src/core/` imports jsnes; everything else goes through `EmulatorCore` (`src/core/types.ts`).
- Projects built on retrowright import the modules `package.json` exports (`src/core`, `src/movie`, `src/patch`, `src/tune`, `src/console`, `src/storage`, `src/test`, `harness/`, `e2e/`).
- No game project's names belong in this repository; `harness/nameScan.ts` reads a project's own list from outside it.
