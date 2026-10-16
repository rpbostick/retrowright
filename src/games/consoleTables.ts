import type { GameConsoleTable } from "../console/gameTable";
import { profileConsoleTable, type GameProfile } from "../console/gameProfile";
import { finalFantasyConsole } from "./ff1/consoleTable";

const BY_MEMORY_MAP: Readonly<Record<string, GameConsoleTable>> = { ff1: finalFantasyConsole };

/**
 * The console table for the open game: by its memory map's id, or from the
 * game profile found for it; null for any other game.
 */
export function consoleTableFor(gameMapId: string | null, profile: GameProfile | null): GameConsoleTable | null {
  if (gameMapId !== null && BY_MEMORY_MAP[gameMapId]) return BY_MEMORY_MAP[gameMapId];
  if (profile) return profileConsoleTable(profile);
  return null;
}
