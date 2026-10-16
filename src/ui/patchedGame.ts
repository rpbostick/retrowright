import { applyPatch } from "../patch/patch";
import { parseInes } from "../rom/ines";
import type { AddResult, GameStore } from "../storage/gameStore";
import { displayTitle, patchedFileName, patchedTitle } from "./gameTitle";

/**
 * Applies a patch file to a game in the library and adds the patched ROM as a
 * new game keyed by its own SHA-256, recording which game and patch it came
 * from. The original game is not changed. Throws, with a message for the
 * player, when the game is gone, the patch does not fit (a BPS for another
 * ROM names the CRC32 it expects) or the result is not an NES ROM.
 */
export async function addPatchedGame(store: GameStore, id: string, patchName: string, patch: Uint8Array): Promise<AddResult> {
  const [rom, games] = await Promise.all([store.getRom(id), store.listGames()]);
  const original = games.find((game) => game.id === id);
  if (!rom || !original) throw new Error("That game is no longer stored in this browser.");
  const applied = applyPatch(rom.data, patch);
  const parsed = parseInes(applied.data);
  if (!parsed.ok) throw new Error(`The patched ROM is not one this player can run: ${parsed.error}`);
  const romTitle = displayTitle(original).title;
  const result = await store.addRom(patchedFileName(rom.name, patchName), applied.data, { romId: id, romTitle, patchName });
  if (result.duplicate || original.title === null) return result;
  // The player's own title for the original carries over, with the patch's name.
  const title = patchedTitle(original.title, patchName);
  await store.renameGame(result.game.id, title);
  return { ...result, game: { ...result.game, title } };
}
