import { useEffect, useState } from "react";
import type { DebugHooks } from "../core/types";
import { MemoryActivity } from "../tools/memoryActivity";
import { NES_RAM_RANGES } from "../tools/ramSearch";
import { formatAddress } from "../tools/watchList";

const PAGE_SIZE = 0x100;
const ROW_SIZE = 16;
const COLUMNS = Array.from({ length: ROW_SIZE }, (_, column) => column);
const ROWS = Array.from({ length: PAGE_SIZE / ROW_SIZE }, (_, row) => row * ROW_SIZE);
const RANGE_NAMES = ["Work RAM", "Cartridge RAM"];
const PAGES = NES_RAM_RANGES.map(([first, last], index) => ({
  name: RANGE_NAMES[index],
  starts: Array.from({ length: (last - first + 1) / PAGE_SIZE }, (_, page) => first + page * PAGE_SIZE),
}));

/** What the memory viewer needs from the player. */
export interface MemoryHost {
  peek(address: number): number;
  setDebugHooks(hooks: DebugHooks | null): void;
  readonly debugHooksAvailable: boolean;
}

const hex2 = (value: number) => value.toString(16).toUpperCase().padStart(2, "0");

/**
 * A hex view of one 256-byte page of work or cartridge RAM. Bytes that
 * changed, and bytes the game read or wrote (from the access hooks), are
 * highlighted for about half a second. The hooks are set while this is
 * mounted and removed when it goes, so a game with the viewer shut runs
 * without them.
 */
export function MemoryViewer({ host }: { host: MemoryHost }) {
  const [activity] = useState(() => new MemoryActivity());
  const [pageStart, setPageStart] = useState(NES_RAM_RANGES[0][0]);
  const [, setTick] = useState(0);
  const hooked = host.debugHooksAvailable;

  useEffect(() => {
    if (!hooked) return;
    host.setDebugHooks(activity.hooks);
    return () => host.setDebugHooks(null);
  }, [host, activity, hooked]);

  useEffect(() => {
    let handle = requestAnimationFrame(function observe() {
      activity.observe((address) => host.peek(address));
      setTick((tick) => tick + 1);
      handle = requestAnimationFrame(observe);
    });
    return () => cancelAnimationFrame(handle);
  }, [host, activity]);

  return (
    <div className="memory-viewer">
      <div className="tool-row">
        <label>
          Page{" "}
          <select data-tool="memory-page" value={pageStart} onChange={(event) => setPageStart(Number(event.target.value))}>
            {PAGES.map(({ name, starts }) => (
              <optgroup key={name} label={name}>
                {starts.map((start) => (
                  <option key={start} value={start}>
                    {formatAddress(start)}-{formatAddress(start + PAGE_SIZE - 1)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <p className="memory-legend hint">
          <span className="byte changed">changed</span> <span className="byte read">read</span> <span className="byte written">written</span>
        </p>
      </div>
      {!hooked && <p className="hint">This game's core reports no reads or writes; changes still show.</p>}
      <table className="hex-view">
        <caption className="visually-hidden">Memory from {formatAddress(pageStart)}</caption>
        <thead>
          <tr>
            <td />
            {COLUMNS.map((column) => (
              <th key={column} scope="col">
                +{column.toString(16).toUpperCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((offset) => (
            <tr key={offset}>
              <th scope="row">{formatAddress(pageStart + offset)}</th>
              {COLUMNS.map((column) => {
                const address = pageStart + offset + column;
                const { changed, read, written } = activity.activity(address);
                const classes = ["byte", changed && "changed", read && "read", written && "written"].filter(Boolean).join(" ");
                return (
                  <td key={column} className={classes} data-address={address}>
                    {hex2(host.peek(address))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
