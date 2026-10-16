// npm run movie:ff1 -- [rom]
// Writes movies/ff1-new-game.rwmovie.json by script: from power-on with empty
// battery RAM, skip the prologue, start a New Game, keep the default party,
// name the four characters, walk north into Coneria Castle and back out.
// The memory checks come from the FF1 memory map; the screen hashes are
// taken from this run and pin it for later replays.

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { JsnesCore } from "../src/core/jsnesCore";
import { Button } from "../src/core/types";
import { findGameMap } from "../src/games";
import { serializeMovie, type Movie } from "../src/movie/format";
import { screenHash } from "../src/movie/screenHash";
import { sha256Hex } from "../src/storage/gameStore";
import { MovieScript } from "./movieScript";
import { formatReport, replay } from "./replay";

const OUTPUT = "movies/ff1-new-game.rwmovie.json";
const NAMES = ["LUKE", "MAYA", "JOHN", "KATE"];
const DEFAULT_PARTY = [
  { class: "Fighter", hp: 35 },
  { class: "Thief", hp: 30 },
  { class: "Black Belt", hp: 33 },
  { class: "Red Mage", hp: 30 },
];
/** The upper-case rows of the name-entry grid; the cursor starts on A. */
const NAME_GRID = ["ABCDEFGHIJ", "KLMNOPQRST", "UVWXYZ"];
const STEP_FRAMES = 16; // one tile of walking

function gridPosition(letter: string): { row: number; column: number } {
  const row = NAME_GRID.findIndex((line) => line.includes(letter));
  if (row < 0) throw new Error(`${letter} is not on the upper-case rows of the name grid.`);
  return { row, column: NAME_GRID[row].indexOf(letter) };
}

function typeName(script: MovieScript, name: string): void {
  script.press(Button.A).wait(30); // open the name screen for the box under the cursor
  let at = { row: 0, column: 0 };
  for (const letter of name) {
    const to = gridPosition(letter);
    for (; at.row < to.row; at.row++) script.press(Button.Down);
    for (; at.row > to.row; at.row--) script.press(Button.Up);
    for (; at.column < to.column; at.column++) script.press(Button.Right);
    for (; at.column > to.column; at.column--) script.press(Button.Left);
    script.press(Button.A);
  }
  script.press(Button.A).wait(30); // a fifth A ends the name and moves to the next box
}

function partyChecks(): string[] {
  return DEFAULT_PARTY.flatMap((member, slot) => [
    `party[${slot}].class == "${member.class}"`,
    `party[${slot}].name == "${NAMES[slot]}"`,
    `party[${slot}].level == 1`,
    `party[${slot}].hp == ${member.hp}`,
    `party[${slot}].maxHp == ${member.hp}`,
    `party[${slot}].status == "ok"`,
  ]);
}

function buildScript(header: ConstructorParameters<typeof MovieScript>[0]): Movie {
  const script = new MovieScript(header);
  script.wait(300).press(Button.Start).wait(60); // the prologue scrolls; Start skips it
  script.press(Button.Down).press(Button.A).wait(60); // New Game
  // The party is made on this screen; its stats are written when it is accepted.
  script.checkpoint("class screen", { memory: ["gold == 400", "party[0].maxHp == 0", "party[3].maxHp == 0"] });
  for (const name of NAMES) typeName(script, name);
  script.wait(30).press(Button.A).wait(300); // accept the party; the game opens on the world map
  script.checkpoint("after naming", { memory: [...partyChecks(), "gold == 400", "onWorldMap == true"] });
  script.press(Button.Up, 10 * STEP_FRAMES, 120); // north into the castle, and on until its hall is drawn
  script.checkpoint("inside the castle", { memory: ['map == "Coneria Castle 1F"', "mapId == 8", "onWorldMap == false"] });
  script.press(Button.Down, 20 * STEP_FRAMES, 120); // south through the gate and out
  script.checkpoint("outside the castle", { memory: [...partyChecks(), `map == "World map"`, "onWorldMap == true", "gold == 400", "inBattle == false"] });
  return script.build();
}

async function main(): Promise<void> {
  const romPath = process.argv[2] ?? "roms/Final_Fantasy_USA.nes";
  const rom = new Uint8Array(readFileSync(romPath));
  const gameMap = await findGameMap(rom);
  if (gameMap?.id !== "ff1") throw new Error(`${romPath} is not the Final Fantasy (USA) ROM the memory map knows.`);
  const probe = new JsnesCore({ onFrame() {}, onAudioSample() {}, onBatteryRamWrite() {} });
  const movie = buildScript({
    rom: { name: basename(romPath), sha256: await sha256Hex(rom) },
    core: { name: probe.name, version: probe.version },
    start: { kind: "power-on", batteryRam: null },
  });
  const hashes = new Map<string, string>();
  const report = await replay({
    createCore: (callbacks) => new JsnesCore(callbacks),
    rom,
    movie,
    gameMap,
    onCheckpoint: (result, pixels) => hashes.set(result.name, screenHash(pixels)),
  });
  console.log(formatReport(report));
  if (!report.passed) throw new Error("The scripted run failed its own memory checks; the movie was not written.");
  for (const checkpoint of movie.checkpoints) {
    const hash = hashes.get(checkpoint.name);
    if (!hash) throw new Error(`No picture at checkpoint "${checkpoint.name}".`);
    checkpoint.expect.screenHash = hash;
  }
  writeFileSync(OUTPUT, serializeMovie(movie));
  console.log(`Wrote ${OUTPUT}: ${movie.frames} frames, ${movie.inputs.length} input changes, ${movie.checkpoints.length} checkpoints.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
