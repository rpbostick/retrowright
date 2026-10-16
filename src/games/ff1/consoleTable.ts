import { ramValue, type GameConsoleTable, type NamedValue } from "../../console/gameTable";
import { BATTLE_RNG_STATE, CHARACTER_BASE, CHARACTER_SIZE, CURRENT_MAP, GOLD, OFFSET } from "./memoryMap";

// Final Fantasy's values for the developer console, at the addresses its
// memory map reads (memoryMap.ts gives each one's source and how it was
// checked). Characters are numbered 1 to 4 as the party menu lists them.

const characterValues = (slot: number): NamedValue[] => {
  const base = CHARACTER_BASE + (slot - 1) * CHARACTER_SIZE;
  return [
    ramValue({ name: `hp${slot}`, description: `Character ${slot}'s current HP.`, address: base + OFFSET.hp, bytes: 2, max: 999 }),
    ramValue({ name: `maxHp${slot}`, description: `Character ${slot}'s maximum HP.`, address: base + OFFSET.maxHp, bytes: 2, max: 999 }),
    // The game keeps the level less 1 outside battle.
    ramValue({ name: `level${slot}`, description: `Character ${slot}'s level, as the menu shows it.`, address: base + OFFSET.level, shownOffset: 1, max: 50 }),
  ];
};

export const finalFantasyConsole: GameConsoleTable = {
  title: "Final Fantasy",
  values: [
    ramValue({ name: "gold", description: "The party's gold.", address: GOLD, bytes: 3, max: 999999 }),
    ...[1, 2, 3, 4].flatMap(characterValues),
    ramValue({ name: "map", description: "The standard map the party is on (8 is Coneria Castle 1F); on the world map it keeps the last one.", address: CURRENT_MAP, readOnly: true }),
    ramValue({ name: "battleRng", description: "The battle RNG's index into its table, kept in battery RAM.", address: BATTLE_RNG_STATE }),
  ],
  commands: [],
};
