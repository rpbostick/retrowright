import { useState, type FormEvent } from "react";
import { COMPARISONS, RamSearch, valueBounds, type Comparison, type SearchStep, type ValueFormat } from "../tools/ramSearch";
import { parseValueText } from "../tools/numberText";
import { formatAddress } from "../tools/watchList";

/** The search's result table lists this many candidates at most; the count says how many there are. */
export const SHOWN_CANDIDATES = 20;

const COMPARISON_LABELS: Record<Comparison, string> = {
  equal: "Equal to",
  notEqual: "Not equal to",
  greater: "Greater than",
  less: "Less than",
  changed: "Changed",
  unchanged: "Unchanged",
};

const usesValue = (comparison: Comparison) => comparison !== "changed" && comparison !== "unchanged";

export interface RamSearchViewProps {
  peek(address: number): number;
  onWatch(address: number, format: ValueFormat): void;
}

/**
 * The RAM search: a comparison, an optional value (empty compares with each
 * address's value at the last step), Filter, Undo and Reset, and the
 * candidates left. It re-renders with the panel each animation frame, so the
 * values shown are the game's now.
 */
export function RamSearchView({ peek, onWatch }: RamSearchViewProps) {
  const [format, setFormat] = useState<ValueFormat>({ size: 1, signed: false });
  // Its candidates change in place; `refresh` re-renders after each change.
  const [search] = useState(() => new RamSearch(peek, format));
  const [comparison, setComparison] = useState<Comparison>("equal");
  const [valueText, setValueText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [, setSteps] = useState(0);

  const refresh = () => setSteps((count) => count + 1);

  const changeFormat = (next: ValueFormat) => {
    setFormat(next);
    search.reset(next);
    setProblem(null);
    refresh();
  };

  const filter = (event: FormEvent) => {
    event.preventDefault();
    let step: SearchStep;
    if (comparison === "changed" || comparison === "unchanged" || valueText.trim() === "") {
      step = { comparison };
    } else {
      const value = parseValueText(valueText);
      const { min, max } = valueBounds(format);
      if (value === null || value < min || value > max) {
        setProblem(`Type a whole number from ${min} to ${max}, in decimal or as $hex, or leave it empty to compare with the previous values.`);
        return;
      }
      step = { comparison, value };
    }
    setProblem(null);
    search.filter(step);
    refresh();
  };

  const candidates = search.candidates(SHOWN_CANDIDATES);
  const countText = `${search.count} ${search.count === 1 ? "candidate" : "candidates"}${search.steps > 0 ? ` after ${search.steps} ${search.steps === 1 ? "step" : "steps"}` : ""}`;

  return (
    <section className="tool ram-search" aria-labelledby="ram-search-title">
      <h3 id="ram-search-title">RAM search</h3>
      <form onSubmit={filter}>
        <div className="tool-row">
          <label>
            Size{" "}
            <select data-tool="size" value={format.size} onChange={(event) => changeFormat({ ...format, size: Number(event.target.value) as ValueFormat["size"] })}>
              <option value={1}>1 byte</option>
              <option value={2}>2 bytes</option>
            </select>
          </label>
          <label className="tool-check">
            <input type="checkbox" data-tool="signed" checked={format.signed} onChange={(event) => changeFormat({ ...format, signed: event.target.checked })} />
            Signed
          </label>
        </div>
        <fieldset className="comparisons">
          <legend>Keep addresses whose value is</legend>
          {COMPARISONS.map((option) => (
            <label key={option}>
              <input type="radio" name="comparison" value={option} data-tool={`comparison-${option}`} checked={comparison === option} onChange={() => setComparison(option)} />
              {COMPARISON_LABELS[option]}
            </label>
          ))}
        </fieldset>
        <div className="tool-row">
          <label>
            Value{" "}
            <input
              type="text"
              inputMode="numeric"
              data-tool="value"
              size={8}
              value={valueText}
              disabled={!usesValue(comparison)}
              aria-describedby={problem ? "search-problem search-value-hint" : "search-value-hint"}
              aria-invalid={problem !== null}
              onChange={(event) => setValueText(event.target.value)}
            />
          </label>
          <button type="submit" data-tool="filter">
            Filter
          </button>
          <button type="button" data-tool="undo" disabled={search.steps === 0} onClick={() => search.undo() && refresh()}>
            Undo
          </button>
          <button type="button" data-tool="reset" onClick={() => changeFormat(format)}>
            Reset
          </button>
        </div>
        <p className="hint" id="search-value-hint">
          Empty: compare with each address's value at the last step. Decimal, or $hex.
        </p>
        {problem && (
          <p className="tool-problem" id="search-problem" role="alert">
            {problem}
          </p>
        )}
      </form>
      <p className="search-count" data-tool="count" role="status">
        {countText}
      </p>
      {candidates.length > 0 && (
        <table className="tool-table candidates">
          <caption className="visually-hidden">Candidates{search.count > candidates.length ? `, the first ${candidates.length}` : ""}</caption>
          <thead>
            <tr>
              <th scope="col">Address</th>
              <th scope="col">Value</th>
              <th scope="col">Previous</th>
              <th scope="col">
                <span className="visually-hidden">Watch</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {candidates.map(({ address, value, previous }) => (
              <tr key={address} data-address={address}>
                <th scope="row">{formatAddress(address)}</th>
                <td>{value}</td>
                <td>{previous}</td>
                <td>
                  <button type="button" className="small" data-tool="watch" aria-label={`Watch ${formatAddress(address)}`} onClick={() => onWatch(address, format)}>
                    Watch
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
