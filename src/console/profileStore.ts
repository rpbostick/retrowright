import { parseGameProfile, type GameProfile } from "./gameProfile";

// The game profile loaded for each ROM, kept in the browser under the ROM's
// SHA-256 and a "retrowright." key, so it travels with the settings in a backup.

const fileKey = (romSha256: string) => `retrowright.profile.${romSha256}`;

/** The profile kept for a ROM; null with none, and a problem to show when the kept one cannot be read. */
export function storedProfile(storage: Storage | undefined, romSha256: string): { profile: GameProfile | null; problem: string | null } {
  const text = storage?.getItem(fileKey(romSha256));
  if (!text) return { profile: null, problem: null };
  try {
    return { profile: parseGameProfile(JSON.parse(text), "The game profile kept for this game"), problem: null };
  } catch (error) {
    return { profile: null, problem: error instanceof Error ? error.message : String(error) };
  }
}

/** Keeps a profile for one ROM it names. */
export function storeProfile(storage: Storage | undefined, romSha256: string, profile: GameProfile): void {
  if (!profile.romSha256.includes(romSha256)) throw new Error(`${profile.title}'s profile is not for this ROM.`);
  storage?.setItem(fileKey(romSha256), JSON.stringify(profile));
}
