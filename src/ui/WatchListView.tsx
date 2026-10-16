import { useState, type FormEvent } from "react";
import type { ValueSize } from "../tools/ramSearch";
import { parseAddressText } from "../tools/numberText";
import { formatAddress, formatWatchValue, isWatchableAddress, WATCH_FORMATS, type Watch, type WatchFormat } from "../tools/watchList";

const FORMAT_LABELS: Record<WatchFormat, string> = { hex: "Hex", decimal: "Decimal", signed: "Signed" };

export interface WatchListViewProps {
  peek(address: number): number;
  watches: readonly Watch[];
  onChange(watches: Watch[]): void;
}

/** The watch list, its values read each animation frame, with a form to add an address by hand. */
export function WatchListView({ peek, watches, onChange }: WatchListViewProps) {
  const [addressText, setAddressText] = useState("");
  const [size, setSize] = useState<ValueSize>(1);
  const [problem, setProblem] = useState<string | null>(null);

  const update = (index: number, change: Partial<Watch>) => onChange(watches.map((watch, at) => (at === index ? { ...watch, ...change } : watch)));

  const add = (event: FormEvent) => {
    event.preventDefault();
    const address = parseAddressText(addressText);
    if (address === null || !isWatchableAddress(address, size)) {
      setProblem("Type an address in work RAM ($0000-$07FF) or cartridge RAM ($6000-$7FFF), in hex.");
      return;
    }
    setProblem(null);
    setAddressText("");
    onChange([...watches, { address, name: formatAddress(address), size, format: "hex" }]);
  };

  return (
    <section className="tool watch-list" aria-labelledby="watch-list-title">
      <h3 id="watch-list-title">Watch list</h3>
      {watches.length === 0 ? (
        <p className="hint">No watches yet. Add one from the search's results or below.</p>
      ) : (
        <table className="tool-table watches">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Address</th>
              <th scope="col">Value</th>
              <th scope="col">Format</th>
              <th scope="col">
                <span className="visually-hidden">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {watches.map((watch, index) => (
              <tr key={`${watch.address}-${index}`} data-address={watch.address}>
                <td>
                  <input type="text" size={7} data-tool="watch-name" aria-label={`Name of ${formatAddress(watch.address)}`} value={watch.name} onChange={(event) => update(index, { name: event.target.value })} />
                </td>
                <td>
                  {formatAddress(watch.address)}
                  {watch.size === 2 && <span className="hint"> (2 bytes)</span>}
                </td>
                <td className="watch-value" data-tool="watch-value">
                  {formatWatchValue(peek, watch)}
                </td>
                <td>
                  <select aria-label={`Format of ${formatAddress(watch.address)}`} value={watch.format} onChange={(event) => update(index, { format: event.target.value as WatchFormat })}>
                    {WATCH_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {FORMAT_LABELS[format]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button type="button" className="small" aria-label={`Remove ${formatAddress(watch.address)}`} onClick={() => onChange(watches.filter((_, at) => at !== index))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="tool-row" onSubmit={add}>
        <label>
          Address{" "}
          <input
            type="text"
            size={6}
            data-tool="watch-address"
            placeholder="$0048"
            value={addressText}
            aria-invalid={problem !== null}
            aria-describedby={problem ? "watch-problem" : undefined}
            onChange={(event) => setAddressText(event.target.value)}
          />
        </label>
        <label>
          Size{" "}
          <select value={size} onChange={(event) => setSize(Number(event.target.value) as ValueSize)}>
            <option value={1}>1 byte</option>
            <option value={2}>2 bytes</option>
          </select>
        </label>
        <button type="submit">Add watch</button>
      </form>
      {problem && (
        <p className="tool-problem" id="watch-problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
