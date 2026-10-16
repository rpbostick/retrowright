import { DEFAULT_REPLAY_SECONDS, REPLAY_SECONDS, type ReplaySeconds } from "../movie/replayBuffer";

// How long the instant replay is, or 0 for off. Its own storage key rather
// than a field of the display settings, so neither needs a format version for
// the other; a backup carries it as every "retrowright." key.

const STORAGE_KEY = "retrowright.replay";

export interface LoadedReplaySeconds {
  seconds: ReplaySeconds;
  /** Said to the player when the saved setting could not be read and the default is used instead. */
  problem?: string;
}

export function loadReplaySeconds(storage: Storage | undefined): LoadedReplaySeconds {
  const raw = storage?.getItem(STORAGE_KEY);
  if (raw === null || raw === undefined) return { seconds: DEFAULT_REPLAY_SECONDS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const seconds = typeof parsed === "object" && parsed !== null ? (parsed as { seconds?: unknown }).seconds : undefined;
  if (!(REPLAY_SECONDS as readonly unknown[]).includes(seconds)) {
    return { seconds: DEFAULT_REPLAY_SECONDS, problem: `The saved instant replay setting could not be read, so it is on, at ${DEFAULT_REPLAY_SECONDS} seconds.` };
  }
  return { seconds: seconds as ReplaySeconds };
}

export function saveReplaySeconds(storage: Storage | undefined, seconds: ReplaySeconds): void {
  storage?.setItem(STORAGE_KEY, JSON.stringify({ seconds }));
}
