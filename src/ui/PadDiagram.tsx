import { Button, type Player } from "../core/types";
import { ACTION_LABELS } from "../input/keyBindings";

const DPAD: ReadonlyArray<[Button, string]> = [
  [Button.Up, "M44 22h16v18H44z"],
  [Button.Down, "M44 56h16v18H44z"],
  [Button.Left, "M24 40h20v16H24z"],
  [Button.Right, "M60 40h20v16H60z"],
];

const PILLS: ReadonlyArray<[Button, number, string]> = [
  [Button.Select, 98, "SELECT"],
  [Button.Start, 132, "START"],
];

const FACE: ReadonlyArray<[Button, number]> = [
  [Button.B, 186],
  [Button.A, 222],
];

/** An NES pad drawn with the button being remapped lit, so mapping is done against a picture. */
export function PadDiagram({ lit, player = 1 }: { lit: Button | null; player?: Player }) {
  const className = (button: Button) => (lit === button ? "pad-part lit" : "pad-part");
  const pad = player === 2 ? "Player 2's NES pad" : "NES pad";
  const label = lit ? `${pad}, ${ACTION_LABELS[lit]} highlighted` : pad;
  return (
    <svg className="pad-diagram" viewBox="0 0 250 100" role="img" aria-label={label}>
      <rect className="pad-body" x="2" y="2" width="246" height="96" rx="10" />
      <rect className="pad-center" x="88" y="26" width="76" height="48" rx="6" />
      {DPAD.map(([button, path]) => (
        <path key={button} className={className(button)} data-button={button} d={path} />
      ))}
      <rect className="pad-hub" x="44" y="40" width="16" height="16" />
      {PILLS.map(([button, x, text]) => (
        <g key={button}>
          <rect className={className(button)} data-button={button} x={x} y="50" width="24" height="9" rx="4.5" />
          <text className="pad-text" x={x + 12} y="45" textAnchor="middle">
            {text}
          </text>
        </g>
      ))}
      {FACE.map(([button, x]) => (
        <g key={button}>
          <circle className={className(button)} data-button={button} cx={x} cy="54" r="13" />
          <text className="pad-text" x={x} y="82" textAnchor="middle">
            {button}
          </text>
        </g>
      ))}
    </svg>
  );
}
