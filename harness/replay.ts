import type { CoreCallbacks, EmulatorCore } from "../src/core/types";
import type { GameMemoryMap } from "../src/games/gameMap";
import type { Movie } from "../src/movie/format";
import { bootMovie, evaluateCheckpoint, MovieRunner, requireMovieRom, type CheckpointResult } from "../src/movie/runner";
import { screenHash } from "../src/movie/screenHash";
import { sha256Hex } from "../src/storage/gameStore";

// Replays a movie headless, as fast as the core runs: no audio output and no
// drawing, only a hash of the picture where one is needed. It drives an
// EmulatorCore, never jsnes directly, so another core can be swapped in and
// its run compared with this one.

export interface ReplayOptions {
  createCore(callbacks: CoreCallbacks): EmulatorCore;
  rom: Uint8Array;
  movie: Movie;
  /** The game's memory map, for checkpoints written against its state. */
  gameMap: GameMemoryMap | null;
  /** Stops after this many frames instead of at the movie's end. */
  until?: number;
  /** Keeps screenHash() of every frame, for comparing two runs. */
  frameHashes?: boolean;
  /** Called at each checkpoint with its result and the picture at that point. */
  onCheckpoint?(result: CheckpointResult, pixels: Uint32Array): void;
}

export interface ReplayReport {
  rom: string;
  core: string;
  movieCore: string;
  framesRun: number;
  movieFrames: number;
  seconds: number;
  framesPerSecond: number;
  checkpoints: CheckpointResult[];
  /** Checkpoints after --until, not reached. */
  skippedCheckpoints: string[];
  passed: boolean;
  finalScreenHash: string | null;
  frameHashes?: string[];
}

export async function replay(options: ReplayOptions): Promise<ReplayReport> {
  const { movie, gameMap } = options;
  requireMovieRom(movie, await sha256Hex(options.rom));
  let pixels: Uint32Array | null = null;
  const core = options.createCore({
    onFrame: (frame) => {
      pixels = frame;
    },
    onAudioSample: () => {},
    onBatteryRamWrite: () => {},
  });
  bootMovie(core, options.rom, movie.start);
  const runner = new MovieRunner(core, movie);
  const lastFrame = Math.min(options.until ?? movie.frames, movie.frames);
  const frameHashes: string[] | undefined = options.frameHashes ? [] : undefined;
  const checkpoints: CheckpointResult[] = [];
  const peek = (address: number) => core.peek(address);

  const checkDue = () => {
    for (const checkpoint of runner.takeDueCheckpoints()) {
      const shown = pixels;
      const result = evaluateCheckpoint(checkpoint, { peek, view: gameMap ? gameMap.read(peek) : null, screenHash: shown ? screenHash(shown) : null });
      checkpoints.push(result);
      if (shown) options.onCheckpoint?.(result, shown);
    }
  };

  const started = performance.now();
  checkDue();
  while (runner.frame < lastFrame) {
    runner.step();
    if (frameHashes && pixels) frameHashes.push(screenHash(pixels));
    checkDue();
  }
  const seconds = (performance.now() - started) / 1000;
  const skippedCheckpoints = movie.checkpoints.filter((checkpoint) => checkpoint.frame > runner.frame).map((checkpoint) => checkpoint.name);
  const finalPixels: Uint32Array | null = pixels;
  return {
    rom: movie.rom.name,
    core: `${core.name} ${core.version}`,
    movieCore: `${movie.core.name} ${movie.core.version}`,
    framesRun: runner.frame,
    movieFrames: movie.frames,
    seconds,
    framesPerSecond: seconds > 0 ? runner.frame / seconds : Infinity,
    checkpoints,
    skippedCheckpoints,
    passed: checkpoints.every((result) => result.passed),
    finalScreenHash: finalPixels ? screenHash(finalPixels) : null,
    frameHashes,
  };
}

export function formatReport(report: ReplayReport): string {
  const lines = [
    `ROM: ${report.rom}`,
    `Core: ${report.core}${report.core === report.movieCore ? "" : ` (movie recorded on ${report.movieCore})`}`,
    `Frames run: ${report.framesRun} of ${report.movieFrames}`,
    `Speed: ${report.framesPerSecond.toFixed(0)} frames per second (${(report.framesPerSecond / 60.0988).toFixed(1)}x real time), ${report.seconds.toFixed(2)} s`,
    `Final screen: ${report.finalScreenHash ?? "(no frame)"}`,
  ];
  for (const result of report.checkpoints) {
    lines.push(`${result.passed ? "PASS" : "FAIL"} checkpoint "${result.name}" at frame ${result.frame} (${result.checked} checks)`);
    if (!result.passed) lines.push(`     first difference: ${result.failures[0]}`, ...result.failures.slice(1).map((failure) => `     also: ${failure}`));
  }
  for (const name of report.skippedCheckpoints) lines.push(`SKIP checkpoint "${name}": after the last frame run`);
  const failed = report.checkpoints.filter((result) => !result.passed).length;
  lines.push(`${report.checkpoints.length - failed} passed, ${failed} failed${report.skippedCheckpoints.length ? `, ${report.skippedCheckpoints.length} not reached` : ""}.`);
  return lines.join("\n");
}
