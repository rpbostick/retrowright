import { shownValue, type Tunables, type TunedValues } from "../tune/tunables";
import type { NamedValue } from "./gameTable";

/**
 * A game's tunables as named values, by their keys. Each reads the byte the
 * game reads, in its ROM, and is set through `apply`, the Tune section's own
 * write, so a value set here is kept and shown there as a slider moved there.
 */
export function tunableValues(tunables: Tunables, values: TunedValues, apply: (values: TunedValues) => void): NamedValue[] {
  return tunables.values.map((tunable) => ({
    name: tunable.key,
    description: tunable.description,
    min: tunable.min,
    max: tunable.max,
    read: (memory) => memory.peek(tunable.cpuAddress),
    write: (_memory, value) => apply({ ...values, [tunable.key]: value }),
    show: (value) => (tunable.choices ? `${value} (${shownValue(tunable, value)})` : String(value)),
  }));
}
