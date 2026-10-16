import { useCallback, useState } from "react";
import type { Tunables, TunedValues } from "../tune/tunables";
import { loadTunedValues, saveTunedValues } from "../tune/tuneStore";

/** What the Tune section needs from the player. */
export interface TuneHost {
  pokeRom(address: number, value: number): void;
}

export interface TuneState {
  tunables: Tunables;
  values: TunedValues;
}

/**
 * The open game's tunables and their values. `open` brings back the values
 * kept for the ROM and writes them into the game; `apply` writes new ones and
 * keeps them, so they hold across closing the tools and reloading the page.
 */
export function useTune(storage: Storage | undefined, onProblem: (message: string) => void) {
  const [tune, setTune] = useState<TuneState | null>(null);

  const apply = useCallback(
    (host: TuneHost, tunables: Tunables, values: TunedValues) => {
      try {
        for (const value of tunables.values) host.pokeRom(value.cpuAddress, values[value.key]);
      } catch (error) {
        onProblem(`The tuned values could not be written into the game: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      saveTunedValues(storage, tunables.romSha256, values);
      setTune({ tunables, values });
    },
    [storage, onProblem],
  );

  const open = useCallback(
    (host: TuneHost, tunables: Tunables | null) => {
      if (!tunables) {
        setTune(null);
        return;
      }
      const kept = loadTunedValues(storage, tunables);
      if (kept.problem) onProblem(kept.problem);
      apply(host, tunables, kept.values);
    },
    [storage, onProblem, apply],
  );

  return { tune, open, apply };
}
