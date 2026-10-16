import { Button, BUTTONS, type EmulatorCore, type Player } from "../core/types";

// One pad's buttons as a bit mask, in the order the NES controller's shift
// register reports them (A first). FCEUX's .fm2 and BizHawk's .bk2 use the
// same eight buttons, so converting either is a per-bit mapping.
export const PAD_BITS: Readonly<Record<Button, number>> = {
  [Button.A]: 0x01,
  [Button.B]: 0x02,
  [Button.Select]: 0x04,
  [Button.Start]: 0x08,
  [Button.Up]: 0x10,
  [Button.Down]: 0x20,
  [Button.Left]: 0x40,
  [Button.Right]: 0x80,
};

export type PadMask = number;

export function maskOf(buttons: Iterable<Button>): PadMask {
  let mask = 0;
  for (const button of buttons) mask |= PAD_BITS[button];
  return mask;
}

export function buttonsOf(mask: PadMask): Button[] {
  return BUTTONS.filter((button) => (mask & PAD_BITS[button]) !== 0);
}

/** "Start+A" style text for reports; "none" for an empty pad. */
export function describeMask(mask: PadMask): string {
  const names = buttonsOf(mask);
  return names.length ? names.join("+") : "none";
}

/**
 * Sets every button of the pad, pressed or not. Setting all of them, rather
 * than the ones that changed, also undoes whatever a loaded save state left
 * in the core's controllers.
 */
export function applyPad(core: EmulatorCore, player: Player, mask: PadMask): void {
  for (const button of BUTTONS) {
    if (mask & PAD_BITS[button]) core.buttonDown(player, button);
    else core.buttonUp(player, button);
  }
}
