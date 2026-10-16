import type { Player } from "./types";

/** The parts of jsnes 2.1.0's mapper the latch reads or wraps; its typings leave them out. */
interface JsnesPadPort {
  /** $4016 bit 0 as the pads see it: 1 while the strobe is high. */
  joypadOutputBit0: number;
  regWrite(address: number, value: number): void;
  _syncJoypadOutput(): void;
  joy1Read(): number;
  joy2Read(): number;
}

export interface JsnesPadMachine {
  mmap: JsnesPadPort | null;
  controllers: Record<Player, { state: number[] }>;
}

const BUTTONS = 8;
const RELEASED = 0x40;
const PRESSED = 0x41;

/**
 * A NES pad's shift register takes all eight buttons at once while the game
 * holds the strobe ($4016 bit 0) high, keeps them when it falls, and shifts
 * one out per read. jsnes 2.1.0 reads each button live instead (mapper0.js
 * joy1Read), so a read pass that spans the end of a frame, where the next
 * frame's buttons are set, reads some buttons from one frame and the rest
 * from the next: Left from one and Right from the other, which no pad can
 * press together. The latch keeps the buttons set from outside apart, and
 * copies them into jsnes's controller state only where the register loads:
 * while the strobe is high and as it falls. jsnes's save state then holds
 * the latched buttons, as the register would.
 */
export class PadLatch {
  private readonly held: Record<Player, number[]> = { 1: new Array<number>(BUTTONS).fill(RELEASED), 2: new Array<number>(BUTTONS).fill(RELEASED) };

  set(player: Player, button: number, pressed: boolean): void {
    this.held[player][button] = pressed ? PRESSED : RELEASED;
  }

  /** jsnes makes a new mapper on each load, reset and loadState, so each one is wrapped afresh. */
  attach(machine: JsnesPadMachine): void {
    const port = machine.mmap;
    if (!port) throw new Error("jsnes has no mapper; load a ROM first.");
    const load = (player: Player) => {
      const state = machine.controllers[player].state;
      for (let button = 0; button < BUTTONS; button++) state[button] = this.held[player][button];
    };
    const loadOnFall = <Args extends unknown[], Result>(method: (this: JsnesPadPort, ...args: Args) => Result) =>
      function (this: JsnesPadPort, ...args: Args): Result {
        const high = this.joypadOutputBit0;
        const result = method.apply(this, args);
        if (high && !this.joypadOutputBit0) {
          load(1);
          load(2);
        }
        return result;
      };
    const loadWhileHigh = (player: Player, read: (this: JsnesPadPort) => number) =>
      function (this: JsnesPadPort): number {
        this._syncJoypadOutput();
        if (this.joypadOutputBit0) load(player);
        return read.call(this);
      };
    // The strobe falls in regWrite($4016), or later in _syncJoypadOutput when the write landed between APU ticks.
    port.regWrite = loadOnFall(port.regWrite);
    port._syncJoypadOutput = loadOnFall(port._syncJoypadOutput);
    port.joy1Read = loadWhileHigh(1, port.joy1Read);
    port.joy2Read = loadWhileHigh(2, port.joy2Read);
  }
}
