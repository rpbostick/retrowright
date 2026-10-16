import { createBps } from "../patch/patch";
import type { AddResult, GameStore } from "../storage/gameStore";
import { changeSummary, tunedRom, type Tunables, type TunedValues } from "../tune/tunables";
import { addPatchedGame } from "./patchedGame";

export interface TunedVersion {
  result: AddResult;
  /** "tuned push 12, brake 7.bps": the patch's file name, which also names the version in the library. */
  patchName: string;
  bps: Uint8Array;
  /** The values as a file of their own, to keep beside the patch. */
  valuesJson: string;
}

/**
 * Makes a BPS from the game as stored to the game with the tuned bytes and
 * adds the result to the library through the same path as Apply patch, so the
 * new entry is the patch applied to the stored ROM and records where it came from.
 */
export async function saveTunedVersion(store: GameStore, id: string, tunables: Tunables, values: TunedValues): Promise<TunedVersion> {
  const rom = await store.getRom(id);
  if (!rom) throw new Error("That game is no longer stored in this browser.");
  const summary = changeSummary(tunables, values);
  const bps = createBps(rom.data, tunedRom(rom.data, tunables, values), `${tunables.patch} tuned: ${summary}`);
  const patchName = `tuned ${summary}.bps`;
  const result = await addPatchedGame(store, id, patchName, bps);
  const valuesJson = `${JSON.stringify({ romSha256: tunables.romSha256, tunedSha256: result.game.id, patch: tunables.patch, values }, null, 2)}\n`;
  return { result, patchName, bps, valuesJson };
}
