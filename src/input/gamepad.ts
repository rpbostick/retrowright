import { Button, type Player } from "../core/types";

// Polls the Gamepad API once per animation frame and reports button edges.
// Assumes the browser's "standard" mapping (https://w3c.github.io/gamepad/#remapping),
// which USB and Bluetooth pads report in Firefox and Chrome.

/** Standard-mapping button index to NES button, by position on the pad. */
const STANDARD_BUTTONS: ReadonlyArray<[number, Button]> = [
  [0, Button.B], // bottom face button
  [1, Button.A], // right face button
  [2, Button.B], // left face button
  [3, Button.A], // top face button
  [8, Button.Select],
  [9, Button.Start],
  [12, Button.Up],
  [13, Button.Down],
  [14, Button.Left],
  [15, Button.Right],
];

/** Where each NES button is on a standard-mapping pad, as STANDARD_BUTTONS and the left stick place it. */
export const GAMEPAD_BUTTON_LABELS: Record<Button, string> = {
  [Button.Up]: "D-pad ↑ or left stick",
  [Button.Down]: "D-pad ↓ or left stick",
  [Button.Left]: "D-pad ← or left stick",
  [Button.Right]: "D-pad → or left stick",
  [Button.B]: "Bottom or left face button",
  [Button.A]: "Right or top face button",
  [Button.Select]: "Back / Select",
  [Button.Start]: "Start",
};

/** The Home / Guide button; browsers report it on some pads only. */
const HOME_BUTTON = 16;
/** The right trigger: held, the game fast-forwards. The NES pad has nothing there. */
const FAST_FORWARD_BUTTON = 7;

const AXIS_THRESHOLD = 0.5;

type PadLike = Pick<Gamepad, "buttons" | "axes" | "connected">;
export type GetGamepads = () => ReadonlyArray<PadLike | null>;
export type ButtonChange = (player: Player, button: Button, pressed: boolean) => void;

function pressedButtons(pad: PadLike): Set<Button> {
  const pressed = new Set<Button>();
  for (const [index, button] of STANDARD_BUTTONS) {
    if (pad.buttons[index]?.pressed) pressed.add(button);
  }
  const [x = 0, y = 0] = pad.axes;
  if (x <= -AXIS_THRESHOLD) pressed.add(Button.Left);
  if (x >= AXIS_THRESHOLD) pressed.add(Button.Right);
  if (y <= -AXIS_THRESHOLD) pressed.add(Button.Up);
  if (y >= AXIS_THRESHOLD) pressed.add(Button.Down);
  return pressed;
}

export class GamepadPoller {
  private previous: [Set<Button>, Set<Button>] = [new Set(), new Set()];
  private homeHeld = false;
  private fastForwardHeld = false;

  constructor(
    private readonly getGamepads: GetGamepads,
    private readonly onChange: ButtonChange,
    /** Called when the Home button of any pad goes down. */
    private readonly onHome: () => void = () => {},
    /** Called when the right trigger of any pad goes down (true) or the last one is let go (false). */
    private readonly onFastForward: (held: boolean) => void = () => {},
  ) {}

  /** The first connected pad is player 1, the second player 2. */
  poll(): void {
    const pads = this.getGamepads().filter((pad): pad is PadLike => pad !== null && pad.connected);
    const home = pads.some((pad) => pad.buttons[HOME_BUTTON]?.pressed);
    if (home && !this.homeHeld) this.onHome();
    this.homeHeld = home;
    const fastForward = pads.some((pad) => pad.buttons[FAST_FORWARD_BUTTON]?.pressed);
    if (fastForward !== this.fastForwardHeld) this.onFastForward(fastForward);
    this.fastForwardHeld = fastForward;
    for (const index of [0, 1] as const) {
      const player: Player = index === 0 ? 1 : 2;
      const now = pads[index] ? pressedButtons(pads[index]) : new Set<Button>();
      const before = this.previous[index];
      for (const button of now) if (!before.has(button)) this.onChange(player, button, true);
      for (const button of before) if (!now.has(button)) this.onChange(player, button, false);
      this.previous[index] = now;
    }
  }

  /** Reports every held button as released, e.g. when the game pauses. */
  releaseAll(): void {
    this.previous.forEach((held, index) => {
      for (const button of held) this.onChange(index === 0 ? 1 : 2, button, false);
    });
    this.previous = [new Set(), new Set()];
  }
}
