/** Copies core frames into a canvas of the core's frame size; drawn at most once per animation frame. */
export class ScreenRenderer {
  private readonly context: CanvasRenderingContext2D;
  private image: ImageData;
  private pixels: Uint32Array;
  private dirty = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot draw to a 2D canvas.");
    this.context = context;
    this.image = context.createImageData(canvas.width, canvas.height);
    this.pixels = new Uint32Array(this.image.data.buffer);
  }

  /** Resizes the canvas to the core's frame, blank until the next frame. */
  setSize = (width: number, height: number): void => {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.image = this.context.createImageData(width, height);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.pixels.fill(0xff000000);
    this.context.putImageData(this.image, 0, 0);
  };

  setFrame = (frame: Uint32Array): void => {
    if (frame.length !== this.pixels.length) throw new Error(`A frame of ${frame.length} pixels does not fit the ${this.canvas.width}x${this.canvas.height} screen.`);
    opaquePixels(frame, this.pixels);
    this.dirty = true;
  };

  present(): void {
    if (!this.dirty) return;
    this.context.putImageData(this.image, 0, 0);
    this.dirty = false;
  }

  /**
   * The picture now at half size, as a WebP data: URL (a browser that cannot
   * encode WebP gives PNG instead), for a save slot's card.
   */
  thumbnail(): string {
    const small = document.createElement("canvas");
    small.width = Math.round(this.canvas.width / 2);
    small.height = Math.round(this.canvas.height / 2);
    const context = small.getContext("2d");
    if (!context) throw new Error("This browser cannot draw to a 2D canvas.");
    context.drawImage(this.canvas, 0, 0, small.width, small.height);
    return small.toDataURL("image/webp", 0.85);
  }
}

/** Core pixels are 0x00BBGGRR; canvas bytes are RGBA, so each gets full alpha. */
export function opaquePixels(frame: Uint32Array, into: Uint32Array = new Uint32Array(frame.length)): Uint32Array {
  for (let index = 0; index < frame.length; index++) into[index] = 0xff000000 | frame[index];
  return into;
}
