/** A stand-in for navigator.getGamepads() with standard-mapping pads. */
export class FakeGamepadApi {
  pads: Array<{ connected: boolean; buttons: { pressed: boolean }[]; axes: number[] } | null> = [];

  connect(slot: number) {
    this.pads[slot] = { connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] };
    return this.pads[slot]!;
  }

  getGamepads = () => this.pads as unknown as ReadonlyArray<Gamepad | null>;
}
