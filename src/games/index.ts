import { sha256Hex } from "../storage/gameStore";
import { finalFantasy } from "./ff1/memoryMap";
import type { GameMemoryMap } from "./gameMap";

export const GAME_MAPS: readonly GameMemoryMap[] = [finalFantasy];

const INES_HEADER_BYTES = 16;

/** SHA-256 of everything after the iNES header; see GameMemoryMap.romContentSha256. */
export function romContentSha256(rom: Uint8Array): Promise<string> {
  return sha256Hex(rom.subarray(INES_HEADER_BYTES));
}

/** The memory map that knows this ROM, or null for a game without one. */
export async function findGameMap(rom: Uint8Array): Promise<GameMemoryMap | null> {
  const content = await romContentSha256(rom);
  return GAME_MAPS.find((map) => map.romContentSha256.includes(content)) ?? null;
}
