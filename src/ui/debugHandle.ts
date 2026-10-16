import type { AudioOutput, AudioStats } from "../audio/audioOutput";
import { serializeMovie } from "../movie/format";
import type { ReplayBufferStats } from "../movie/replayBuffer";
import { rgbaScreenHash } from "../movie/screenHash";
import type { MovieStatus, Player } from "../player/player";
import type { SaveState } from "../core/types";
import { sha256Hex, type StateSlot } from "../storage/gameStore";

/**
 * Read-only view of the running player on window.__retrowright, for the
 * browser checks in e2e/ and for looking at a problem from the devtools
 * console. It can observe but not drive the game. It is installed only in
 * development or when the page is opened with ?debug.
 */
export interface DebugHandle {
  readonly game: string | null;
  /** The open game's library key, the SHA-256 hex of its ROM, or null. */
  readonly romId: string | null;
  readonly framesRun: number;
  readonly measuredFps: number;
  readonly batterySaves: number;
  /** True while the menu has the game paused. */
  readonly paused: boolean;
  audio(): AudioStats;
  /** Buttons the core has held down now, as "pad:button". */
  heldButtons(): string[];
  /** SHA-256 hex of the battery RAM the game has now, or null. */
  batteryRamDigest(): Promise<string | null>;
  /** SHA-256 hex of the battery RAM restored when the game opened, or null. */
  restoredBatteryRamDigest(): Promise<string | null>;
  /** SHA-256 hex of the battery RAM the browser has stored for the game, or null. */
  storedBatteryRamDigest(): Promise<string | null>;
  /** SHA-256 hex of a save state of the machine as it is now, or null. */
  stateDigest(): Promise<string | null>;
  /** SHA-256 hex of the state stored in a slot, encoded as stateDigest() encodes it, or null when empty. */
  storedStateDigest(slot: StateSlot): Promise<string | null>;
  movieStatus(): MovieStatus;
  /** The last recorded movie as its file's text, or null. */
  lastRecording(): string | null;
  /** What the instant replay holds now (states, frames, bytes), or null while it is not kept. */
  replayStats(): ReplayBufferStats | null;
  /** screenHash() of the picture now, or null. */
  screenHash(): string | null;
  /** The game's state through its memory map (party names, map), or null for a game without one. */
  gameState(): unknown;
  /** A byte of the open game's CPU memory, read without side effects; throws with no game open. */
  peek(address: number): number;
  /** screenHash() of the picture the resume state brought back when the game opened with Continue, or null. */
  readonly continuedScreenHash: string | null;
  /** Frames run per frame due: 1, or the fast-forward speed. */
  readonly speed: number;
  /** screenHash() of a picture given as RGBA bytes, e.g. a decoded screenshot; a pure function, it reads nothing of the game. */
  pictureHash(rgba: ArrayLike<number>): string;
}

declare global {
  interface Window {
    __retrowright?: DebugHandle;
  }
}

async function digest(bytes: Uint8Array | null): Promise<string | null> {
  return bytes ? sha256Hex(bytes) : null;
}

function stateDigest(state: SaveState | null): Promise<string | null> {
  return digest(state ? new TextEncoder().encode(JSON.stringify(state)) : null);
}

/** `search` is location.search; `dev` is true under the development server and in tests. */
export function debugHandleWanted(search: string, dev: boolean): boolean {
  return dev || new URLSearchParams(search).has("debug");
}

export function installDebugHandle(player: Player, audio: AudioOutput): () => void {
  const handle: DebugHandle = {
    get game() {
      return player.loadedGame?.name ?? null;
    },
    get romId() {
      return player.loadedGame?.id ?? null;
    },
    get framesRun() {
      return player.framesRun;
    },
    get measuredFps() {
      return player.measuredFps;
    },
    get batterySaves() {
      return player.batterySaves;
    },
    get paused() {
      return player.isPausedBy("user");
    },
    audio: () => audio.getStats(),
    heldButtons: () => player.heldButtons(),
    batteryRamDigest: () => digest(player.currentBatteryRam()),
    restoredBatteryRamDigest: () => digest(player.restoredBatteryRam),
    storedBatteryRamDigest: async () => digest(await player.storedBatteryRam()),
    stateDigest: () => stateDigest(player.currentState()),
    storedStateDigest: async (slot) => stateDigest((await player.listStates()).find((record) => record.slot === slot)?.state ?? null),
    movieStatus: () => player.movieStatus(),
    lastRecording: () => (player.lastRecording ? serializeMovie(player.lastRecording) : null),
    replayStats: () => player.replayStats(),
    screenHash: () => player.currentScreenHash(),
    gameState: () => player.gameState(),
    peek: (address) => player.peek(address),
    get continuedScreenHash() {
      return player.continuedScreenHash;
    },
    get speed() {
      return player.speed;
    },
    pictureHash: (rgba) => rgbaScreenHash(rgba),
  };
  window.__retrowright = handle;
  return () => {
    if (window.__retrowright === handle) delete window.__retrowright;
  };
}
