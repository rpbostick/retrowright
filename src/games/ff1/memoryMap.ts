import type { AddressNote, GameMemoryMap } from "../gameMap";

// Final Fantasy (USA, NES): the party, gold and where the party is, read
// from RAM.
//
// Sources:
// - DISASM: Disch's commented disassembly of the US ROM, variables.inc
//   (github.com/Entroper/FF1Disassembly, "Final Fantasy Disassembly/variables.inc").
// - DATACRYSTAL: Data Crystal, "Final Fantasy/RAM map"
//   (datacrystal.tcrf.net/wiki/Final_Fantasy/RAM_map).
//
// "Verified" says what the running game showed, on jsnes: a new game was
// started and named, the party menu opened, and the party walked into
// Coneria Castle and back out; the values were read at those points and
// compared with the screen. The movie harness/makeFf1NewGame.ts writes checks
// the same values on every replay.

export const CHARACTER_BASE = 0x6100; // DISASM ch_stats, $40 bytes per character
export const CHARACTER_SIZE = 0x40;
export const GOLD = 0x601c; // DISASM gold = unsram + $1C, 3 bytes, little-endian
const MAP_FLAGS = 0x2d; // DISASM mapflags: bit 0 set on a standard map
export const CURRENT_MAP = 0x48; // DISASM cur_map
const WORLD_SCROLL_X = 0x27; // DISASM ow_scroll_x, in tiles
const WORLD_SCROLL_Y = 0x28;
const MAP_SCROLL_X = 0x29; // DISASM sm_scroll_x, in tiles
const MAP_SCROLL_Y = 0x2a;
const BATTLE_FLAG = 0x81; // DATACRYSTAL: $68 in battle
/** DISASM btl_rngstate, the index into the battle RNG table; in battery RAM. */
export const BATTLE_RNG_STATE = 0x688a;

export const OFFSET = {
  class: 0x00,
  ailments: 0x01,
  name: 0x02, // 4 bytes
  hp: 0x0a, // 2 bytes
  maxHp: 0x0c, // 2 bytes
  level: 0x26, // 0-based out of battle (DISASM)
} as const;

export const CLASS_NAMES = ["Fighter", "Thief", "Black Belt", "Red Mage", "White Mage", "Black Mage", "Knight", "Ninja", "Master", "Red Wizard", "White Wizard", "Black Wizard"];

/** Standard-map numbers seen in the running game; others read as "map #N". */
export const MAP_NAMES: Readonly<Record<number, string>> = {
  0x08: "Coneria Castle 1F",
};

export const WORLD_MAP = "World map";

// DISASM ch_ailments values (DATACRYSTAL lists the same bits).
const AILMENTS: [number, string][] = [
  [0x01, "dead"],
  [0x02, "stone"],
  [0x04, "poison"],
  [0x08, "dark"],
  [0x10, "stun"],
  [0x20, "sleep"],
  [0x40, "mute"],
];

/**
 * The game's text tiles: $80-$89 are 0-9, $8A-$A3 A-Z, $A4-$BD a-z, $FF a
 * space; the order of the name-entry grid. A tile outside these reads as
 * "{$xx}" so a wrong byte shows instead of vanishing.
 */
export function decodeText(bytes: number[]): string {
  return bytes
    .map((byte) => {
      if (byte >= 0x80 && byte <= 0x89) return String.fromCharCode(0x30 + byte - 0x80);
      if (byte >= 0x8a && byte <= 0xa3) return String.fromCharCode(0x41 + byte - 0x8a);
      if (byte >= 0xa4 && byte <= 0xbd) return String.fromCharCode(0x61 + byte - 0xa4);
      if (byte === 0xff) return " ";
      return `{$${byte.toString(16).padStart(2, "0")}}`;
    })
    .join("")
    .trimEnd();
}

function word(peek: (address: number) => number, address: number): number {
  return peek(address) | (peek(address + 1) << 8);
}

// Type aliases rather than interfaces: only an alias is assignable to the
// index signature of ViewValue, which GameMemoryMap.read returns.
export type FinalFantasyCharacter = { classId: number; class: string; name: string; level: number; hp: number; maxHp: number; status: string };

export type FinalFantasyView = {
  party: FinalFantasyCharacter[];
  gold: number;
  onWorldMap: boolean;
  mapId: number | null;
  map: string;
  scrollX: number;
  scrollY: number;
  inBattle: boolean;
};

function readCharacter(peek: (address: number) => number, slot: number): FinalFantasyCharacter {
  const base = CHARACTER_BASE + slot * CHARACTER_SIZE;
  const classId = peek(base + OFFSET.class);
  const ailments = peek(base + OFFSET.ailments);
  return {
    classId,
    class: CLASS_NAMES[classId] ?? `class #${classId}`,
    name: decodeText([0, 1, 2, 3].map((index) => peek(base + OFFSET.name + index))),
    level: peek(base + OFFSET.level) + 1,
    hp: word(peek, base + OFFSET.hp),
    maxHp: word(peek, base + OFFSET.maxHp),
    status: AILMENTS.filter(([bit]) => ailments & bit).map(([, label]) => label).join("+") || "ok",
  };
}

export function readFinalFantasy(peek: (address: number) => number): FinalFantasyView {
  const onStandardMap = (peek(MAP_FLAGS) & 0x01) !== 0;
  const mapId = peek(CURRENT_MAP);
  return {
    party: [0, 1, 2, 3].map((slot) => readCharacter(peek, slot)),
    gold: peek(GOLD) | (peek(GOLD + 1) << 8) | (peek(GOLD + 2) << 16),
    onWorldMap: !onStandardMap,
    mapId: onStandardMap ? mapId : null,
    map: onStandardMap ? (MAP_NAMES[mapId] ?? `map #${mapId}`) : WORLD_MAP,
    scrollX: peek(onStandardMap ? MAP_SCROLL_X : WORLD_SCROLL_X),
    scrollY: peek(onStandardMap ? MAP_SCROLL_Y : WORLD_SCROLL_Y),
    inBattle: peek(BATTLE_FLAG) === 0x68,
  };
}

const SINGLE_BYTES: Readonly<Record<number, string>> = {
  [MAP_FLAGS]: "map flags (bit 0: on a standard map)",
  [CURRENT_MAP]: "current standard map",
  [WORLD_SCROLL_X]: "world map scroll X",
  [WORLD_SCROLL_Y]: "world map scroll Y",
  [MAP_SCROLL_X]: "standard map scroll X",
  [MAP_SCROLL_Y]: "standard map scroll Y",
  [BATTLE_FLAG]: "battle flag ($68 in battle, unverified)",
  [BATTLE_RNG_STATE]: "battle RNG state",
};

const CHARACTER_FIELDS: [offset: number, size: number, label: string][] = [
  [OFFSET.class, 1, "class"],
  [OFFSET.ailments, 1, "ailments"],
  [OFFSET.name, 4, "name"],
  [OFFSET.hp, 2, "HP"],
  [OFFSET.maxHp, 2, "max HP"],
  [OFFSET.level, 1, "level - 1"],
];

/** Names the addresses this map reads, the same constants readFinalFantasy uses. */
export function nameFinalFantasyAddress(address: number): string | null {
  if (address in SINGLE_BYTES) return SINGLE_BYTES[address];
  if (address >= GOLD && address < GOLD + 3) return `gold, byte ${address - GOLD}`;
  if (address >= CHARACTER_BASE && address < CHARACTER_BASE + 4 * CHARACTER_SIZE) {
    const slot = Math.floor((address - CHARACTER_BASE) / CHARACTER_SIZE);
    const offset = (address - CHARACTER_BASE) % CHARACTER_SIZE;
    const field = CHARACTER_FIELDS.find(([start, size]) => offset >= start && offset < start + size);
    if (!field) return `character ${slot}, stats +$${offset.toString(16).toUpperCase().padStart(2, "0")}`;
    const [start, size, label] = field;
    return size === 1 ? `character ${slot} ${label}` : `character ${slot} ${label}, byte ${offset - start}`;
  }
  return null;
}

const NAME_SCREEN ="named ABCD on the name screen; $6102-$6105 read 8A 8B 8C 8D";

export const FINAL_FANTASY_ADDRESSES: readonly AddressNote[] = [
  { address: "$6100 + $40n", meaning: "character n's class (0 Fighter ... 11 Black Wizard)", source: "DISASM ch_class", verified: "default party read 0, 1, 2, 3 for Fighter, Thief, Black Belt, Red Mage; promoted classes 6-11 not seen" },
  { address: "$6101 + $40n", meaning: "ailments bits (1 dead, 2 stone, 4 poison, 8 dark, $10 stun, $20 sleep, $40 mute)", source: "DISASM ch_ailments; DATACRYSTAL", verified: "0 for a new party only; no ailment has been seen set" },
  { address: "$6102-$6105 + $40n", meaning: "name, 4 text tiles", source: "DISASM ch_name", verified: NAME_SCREEN },
  { address: "$610A-$610B + $40n", meaning: "current HP, little-endian", source: "DISASM ch_curhp", verified: "35, 30, 33, 30 for a new party, as the party menu shows" },
  { address: "$610C-$610D + $40n", meaning: "maximum HP, little-endian", source: "DISASM ch_maxhp", verified: "35, 30, 33, 30 for a new party, as the party menu shows" },
  { address: "$6126 + $40n", meaning: "level minus 1 (outside battle)", source: "DISASM ch_level; DATACRYSTAL", verified: "0 for a new party; the menu shows L 1" },
  { address: "$601C-$601E", meaning: "gold, 24-bit little-endian", source: "DISASM gold", verified: "400 for a new party; the menu shows 400 G" },
  { address: "$2D bit 0", meaning: "set on a standard map (town, castle, dungeon), clear on the world map", source: "DISASM mapflags", verified: "clear at the start and after leaving the castle, set inside Coneria Castle" },
  { address: "$48", meaning: "standard map number", source: "DISASM cur_map", verified: "8 inside Coneria Castle 1F; other map numbers not seen" },
  { address: "$27, $28", meaning: "world map scroll X, Y in tiles", source: "DISASM ow_scroll_x/y; DATACRYSTAL", verified: "Y fell by one per tile walked north from the start (158 to 152)" },
  { address: "$29, $2A", meaning: "standard map scroll X, Y in tiles", source: "DISASM sm_scroll_x/y; DATACRYSTAL", verified: "Y fell by one per tile walked north in Coneria Castle; $68/$69 (player position) stayed scroll + 7" },
  { address: "$81", meaning: "$68 during a battle", source: "DATACRYSTAL", verified: null },
  { address: "$688A", meaning: "battle RNG state, an index into the RNG table (battery RAM)", source: "DISASM btl_rngstate", verified: "the TAS's first fight on jsnes depends on its starting value (docs/accuracy.md)" },
  { address: "$80-$89, $8A-$A3, $A4-$BD, $FF", meaning: "text tiles 0-9, A-Z, a-z, space", source: "the name-entry grid's order", verified: "A-D only (8A-8D); the movie's names check the letters it types" },
];

export const finalFantasy: GameMemoryMap = {
  id: "ff1",
  title: "Final Fantasy (USA)",
  // SHA-256 of PRG and CHR of the US release (the file's SHA-256 with its iNES header is f81377a4…).
  romContentSha256: ["fa456d852372173ea31b192459ba1a2026f779df67793327ba6e132476c1d034"],
  addresses: FINAL_FANTASY_ADDRESSES,
  read: readFinalFantasy,
  nameAddress: nameFinalFantasyAddress,
};
