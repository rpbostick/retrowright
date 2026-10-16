import { describe, expect, it } from "vitest";
import { consoleTableFor } from "../games/consoleTables";
import { finalFantasyConsole } from "../games/ff1/consoleTable";
import type { Tunables, TunedValues } from "../tune/tunables";
import { parseGameProfile, type GameProfile } from "./gameProfile";
import { commandNames, runLine, type CommandContext, type ConsoleHost } from "./commands";
import { ramValue, type ConsoleMemory, type GameConsoleTable } from "./gameTable";
import { completeLine, ConsoleSession } from "./session";
import { closestName } from "./suggest";
import { tunableValues } from "./tunableValues";

/** 64 KB of memory that refuses what the core refuses: peeks of registers, pokes outside RAM. */
function stubMemory(): ConsoleMemory & { bytes: Uint8Array } {
  const bytes = new Uint8Array(0x10000);
  return {
    bytes,
    peek(address) {
      if (address >= 0x2000 && address < 0x6000) throw new RangeError(`$${address.toString(16).toUpperCase()} is a register or open bus; peek reads RAM and cartridge space only.`);
      return bytes[address];
    },
    poke(address, value) {
      if (!(address < 0x2000 || (address >= 0x6000 && address < 0x8000))) throw new RangeError(`$${address.toString(16).toUpperCase()} is not RAM; poke writes $0000-$1FFF and $6000-$7FFF.`);
      bytes[address] = value;
    },
    palette: () => new Uint8Array(32),
  };
}

function stubHost() {
  const calls: string[] = [];
  let paused = false;
  let frames = 100;
  let rate = 1;
  const memory = stubMemory();
  const host: ConsoleHost = {
    memory,
    isPaused: () => paused,
    pause: () => {
      calls.push("pause");
      paused = true;
    },
    resume: () => {
      calls.push("resume");
      paused = false;
    },
    step: (count) => {
      calls.push(`step ${count}`);
      frames += count;
    },
    waitFrames: async (count) => {
      calls.push(`wait ${count}`);
      frames += count;
    },
    framesRun: () => frames,
    rate: () => rate,
    setRate: (next) => {
      rate = next;
    },
    reset: () => void calls.push("reset"),
    saveState: async (slot) => `Saved to slot ${slot}.`,
    loadState: async (slot) => `Loaded slot ${slot}.`,
    screenshot: async () => "Screenshot saved as game.png.",
    record: () => "Recording.",
    stop: () => "Recorded 10 frames; the movie file is downloading.",
    replay: () => "Saved the last 60 seconds.",
  };
  return { host, memory, calls };
}

const TUNABLES: Tunables = {
  format: "retrowright-tunables",
  version: 1,
  romSha256: "0".repeat(64),
  patch: "feel.bps",
  values: [
    { key: "jumpHeight", name: "Jump height", description: "How high the jump goes.", romOffset: 100, cpuAddress: 0xf2b0, min: 64, max: 96, default: 80 },
    { key: "pushStyle", name: "Push style", description: "How the rider pushes.", romOffset: 101, cpuAddress: 0xf2b1, min: 0, max: 1, default: 1, choices: ["Direction taps", "B taps"] },
  ],
};

const PROFILE: GameProfile = parseGameProfile(
  {
    format: "retrowright-game-profile",
    version: 1,
    title: "Profiled game",
    romSha256: ["0".repeat(64)],
    values: [],
    commands: [{ name: "blink", usage: "blink", help: "Writes 1 to $20 and waits 3 frames.", steps: [{ write: "$0020", value: 1 }, { wait: 3 }], reply: "Blinked." }],
  },
  "a test profile",
);

const GAME: GameConsoleTable = {
  title: "Test game",
  values: [ramValue({ name: "lives", description: "Lives.", address: 0x10, shownOffset: 1, max: 99 }), ramValue({ name: "mode", description: "Mode.", address: 0x11, readOnly: true })],
  commands: [{ name: "jump", usage: "jump <n>", help: "Writes n to $12.", run: (args, memory) => (memory.poke(0x12, Number(args[0])), `Jumped ${args[0]}.`) }],
};

function contextWith(game: GameConsoleTable | null = GAME) {
  const { host, memory, calls } = stubHost();
  const applied: TunedValues[] = [];
  const tuned = tunableValues(TUNABLES, { jumpHeight: 80, pushStyle: 1 }, (values) => {
    applied.push(values);
    memory.bytes[0xf2b0] = values.jumpHeight;
    memory.bytes[0xf2b1] = values.pushStyle;
  });
  memory.bytes[0xf2b0] = 80;
  memory.bytes[0xf2b1] = 1;
  let cleared = 0;
  const context: CommandContext = { host, game, values: [...(game?.values ?? []), ...tuned], watches: [], clearScrollback: () => void cleared++ };
  return { context, memory, calls, applied, cleared: () => cleared };
}

describe("the console's line runner", () => {
  it("ignores blank lines and extra spaces, and names an unknown command with the closest one", async () => {
    const { context } = contextWith();
    expect(await runLine("   ", context)).toBe("");
    expect(await runLine("  peek   10  ", context)).toBe("$0010 = $00 (0)");
    await expect(runLine("paws", context)).rejects.toThrow("No command named paws; did you mean pause? Type help for the list.");
    await expect(runLine("xyzzy", context)).rejects.toThrow("No command named xyzzy. Type help for the list.");
  });

  it("help lists every command, the game's after the console's, and says what one does", async () => {
    const { context } = contextWith();
    const all = await runLine("help", context);
    for (const name of ["help", "pause", "resume", "step", "speed", "reset", "peek", "poke", "watch", "unwatch", "save", "load", "screenshot", "record", "stop", "replay", "clear", "list", "get", "set"]) expect(all).toContain(`\n${name}`.slice(name === "help" ? 1 : 0));
    expect(all).toContain("For Test game:\njump <n>: Writes n to $12.");
    expect(await runLine("help peek", context)).toMatch(/^peek <addr> \[n\]: Shows n bytes/);
    expect(await runLine("help jump", context)).toBe("jump <n>: Writes n to $12.");
    await expect(runLine("help peak", context)).rejects.toThrow("No command named peak; did you mean peek?");
    expect(commandNames(context)).toContain("jump");
    expect(commandNames({ game: null })).not.toContain("jump");
  });

  it("pause, resume and step drive the host; step pauses first and takes 1 to 3600 frames", async () => {
    const { context, calls } = contextWith();
    expect(await runLine("resume", context)).toBe("The game is already running.");
    expect(await runLine("step", context)).toBe("Stepped 1 frame; paused at frame 101.");
    expect(calls).toEqual(["pause", "step 1"]);
    expect(await runLine("step 10", context)).toBe("Stepped 10 frames; paused at frame 111.");
    expect(await runLine("pause", context)).toBe("Already paused, at frame 111.");
    await expect(runLine("step 0", context)).rejects.toThrow("The frames to step must be 1 to 3600, not 0.");
    await expect(runLine("step many", context)).rejects.toThrow('The frames to step must be a whole number, not "many".');
    await expect(runLine("step 1 2", context)).rejects.toThrow("Usage: step [frames].");
    expect(await runLine("resume", context)).toBe("Running.");
    expect(calls).toEqual(["pause", "step 1", "step 10", "resume"]);
  });

  it("speed says the speed alone, and sets 0.25 to 4", async () => {
    const { context } = contextWith();
    expect(await runLine("speed", context)).toBe("Speed 1×.");
    expect(await runLine("speed 0.5", context)).toBe("Speed 0.5×.");
    expect(await runLine("speed", context)).toBe("Speed 0.5×.");
    expect(await runLine("speed 4", context)).toBe("Speed 4×.");
    await expect(runLine("speed 5", context)).rejects.toThrow('The speed must be a number from 0.25 to 4, not "5".');
    await expect(runLine("speed fast", context)).rejects.toThrow("not \"fast\"");
  });

  it("reset, save, load, screenshot, record, stop and replay answer with the host's sentence", async () => {
    const { context, calls } = contextWith();
    expect(await runLine("reset", context)).toBe("Reset.");
    expect(calls).toEqual(["reset"]);
    expect(await runLine("save 2", context)).toBe("Saved to slot 2.");
    expect(await runLine("load $3", context)).toBe("Loaded slot 3.");
    await expect(runLine("save 9", context)).rejects.toThrow("The slot must be 1 to 8, not 9.");
    await expect(runLine("load", context)).rejects.toThrow("Usage: load <slot>.");
    expect(await runLine("screenshot", context)).toBe("Screenshot saved as game.png.");
    expect(await runLine("record", context)).toBe("Recording.");
    expect(await runLine("stop", context)).toBe("Recorded 10 frames; the movie file is downloading.");
    expect(await runLine("replay", context)).toBe("Saved the last 60 seconds.");
  });

  it("peek reads hex addresses, one byte or rows of eight, and passes on the core's refusal", async () => {
    const { context, memory } = contextWith();
    memory.bytes.set([0x0f, 0x2a, 3, 4, 5, 6, 7, 8, 9, 10], 0x10);
    expect(await runLine("peek $11", context)).toBe("$0011 = $2A (42)");
    expect(await runLine("peek 0x10 10", context)).toBe("$0010: 0F 2A 03 04 05 06 07 08\n$0018: 09 0A");
    await expect(runLine("peek 10 257", context)).rejects.toThrow("The number of bytes must be 1 to 256, not 257.");
    await expect(runLine("peek FFFF 2", context)).rejects.toThrow("2 bytes from $FFFF run past $FFFF.");
    await expect(runLine("peek $2002", context)).rejects.toThrow("$2002 is a register");
    await expect(runLine("peek zz", context)).rejects.toThrow('"zz" is not an address; write it in hex, as $0010 or 10.');
  });

  it("poke writes a byte to RAM, refuses a value past 255 and an address the core refuses", async () => {
    const { context, memory } = contextWith();
    expect(await runLine("poke $00 $2A", context)).toBe("$0000 = $2A (42)");
    expect(memory.bytes[0]).toBe(0x2a);
    expect(await runLine("poke 7FFF 17", context)).toBe("$7FFF = $11 (17)");
    await expect(runLine("poke 0 256", context)).rejects.toThrow("The value must be 0 to 255, not 256.");
    await expect(runLine("poke 8000 1", context)).rejects.toThrow("$8000 is not RAM");
    await expect(runLine("poke 0", context)).rejects.toThrow("Usage: poke <addr> <value>.");
  });

  it("watch follows an address or a named value until unwatch", async () => {
    const { context, memory } = contextWith();
    memory.bytes[0x10] = 2;
    expect(await runLine("watch 10", context)).toBe("Watching $0010: $02 (2).");
    expect(await runLine("watch lives", context)).toBe("Watching lives: 3.");
    expect(await runLine("watch $0010", context)).toBe("Already watching $0010.");
    memory.bytes[0x10] = 5;
    expect(context.watches.map((watch) => `${watch.label} ${watch.read()}`)).toEqual(["$0010 $05 (5)", "lives 6"]);
    await expect(runLine("watch livez", context)).rejects.toThrow('"livez" is neither an address nor a value\'s name; did you mean lives?');
    await expect(runLine("watch 2002", context)).rejects.toThrow("$2002 is a register");
    expect(await runLine("unwatch $10", context)).toBe("Stopped watching $0010.");
    await expect(runLine("unwatch 20", context)).rejects.toThrow("$0020 is not watched.");
    expect(await runLine("unwatch", context)).toBe("Stopped 1 watch.");
    expect(await runLine("unwatch", context)).toBe("Nothing is watched.");
  });

  it("clear empties the scrollback with no answer", async () => {
    const { context, cleared } = contextWith();
    expect(await runLine("clear", context)).toBe("");
    expect(cleared()).toBe(1);
  });

  it("get, set and list reach the game's values and its tunables by name, with plain errors", async () => {
    const { context, memory, applied } = contextWith();
    memory.bytes[0x10] = 2;
    expect(await runLine("get lives", context)).toBe("lives = 3");
    expect(await runLine("set lives 9", context)).toBe("lives = 9 (was 3)");
    expect(memory.bytes[0x10]).toBe(8);
    expect(await runLine("get jumpHeight", context)).toBe("jumpHeight = 80");
    expect(await runLine("set jumpHeight 96", context)).toBe("jumpHeight = 96 (was 80)");
    expect(applied).toEqual([{ jumpHeight: 96, pushStyle: 1 }]);
    expect(await runLine("get pushStyle", context)).toBe("pushStyle = 1 (B taps)");
    await expect(runLine("get jump_height", context)).rejects.toThrow("No value named jump_height; did you mean jumpHeight?");
    await expect(runLine("set jumpHeight 200", context)).rejects.toThrow("jumpHeight must be 64 to 96, not 200.");
    await expect(runLine("set mode 1", context)).rejects.toThrow("mode can be read but not set.");
    await expect(runLine("get nothingLikeIt", context)).rejects.toThrow("No value named nothingLikeIt.");
    const list = await runLine("list", context);
    expect(list.split("\n")).toEqual(["lives = 9: Lives.", "mode = 0: Mode.", "jumpHeight = 96: How high the jump goes.", "pushStyle = 1 (B taps): How the rider pushes."]);
    const bare = { ...context, game: null, values: [] };
    expect(await runLine("list", bare)).toBe("This game has no named values.");
    await expect(runLine("get lives", bare)).rejects.toThrow("This game has no named values, so there is no lives.");
  });

  it("runs the game's own commands on its memory", async () => {
    const { context, memory } = contextWith();
    expect(await runLine("jump 7", context)).toBe("Jumped 7.");
    expect(memory.bytes[0x12]).toBe(7);
    await expect(runLine("jump 7", contextWith(null).context)).rejects.toThrow("No command named jump");
  });
});

describe("the console session", () => {
  it("keeps each line and its answer or error, history without repeats, and clear empties the scrollback", async () => {
    const { context } = contextWith();
    const session = new ConsoleSession();
    await session.submit("poke 0 1", context);
    await session.submit("poke 0 1", context);
    await session.submit("bogus", context);
    await session.submit("  ", context);
    expect(session.lines.map((line) => [line.kind, line.text])).toEqual([
      ["input", "poke 0 1"],
      ["answer", "$0000 = $01 (1)"],
      ["input", "poke 0 1"],
      ["answer", "$0000 = $01 (1)"],
      ["input", "bogus"],
      ["error", "No command named bogus. Type help for the list."],
    ]);
    expect(session.history).toEqual(["poke 0 1", "bogus"]);
    await session.submit("watch 0", context);
    expect(session.watches.map((watch) => watch.label)).toEqual(["$0000"]);
    await session.submit("clear", context);
    expect(session.lines).toEqual([]);
  });

  it("Tab completes command names, value names after get, set, watch and unwatch, and command names after help", () => {
    const { context } = contextWith();
    expect(completeLine("pa", context)).toEqual({ text: "pause ", options: [] });
    expect(completeLine("s", context)).toEqual({ text: "s", options: ["step", "speed", "save", "screenshot", "stop", "set"] });
    expect(completeLine("sc", context)).toEqual({ text: "screenshot ", options: [] });
    expect(completeLine("re", context)).toEqual({ text: "re", options: ["resume", "reset", "record", "replay"] });
    expect(completeLine("rep", context)).toEqual({ text: "replay ", options: [] });
    expect(completeLine("get jum", context)).toEqual({ text: "get jumpHeight ", options: [] });
    expect(completeLine("set ", context).options).toEqual(["lives", "mode", "jumpHeight", "pushStyle"]);
    expect(completeLine("help ju", context)).toEqual({ text: "help jump ", options: [] });
    expect(completeLine("peek 10", context)).toEqual({ text: "peek 10", options: [] });
    expect(completeLine("zz", context)).toEqual({ text: "zz", options: [] });
  });
});

describe("names close to a mistyped one", () => {
  it("matches case, underscores and hyphens aside, then the nearest within a third of the length", () => {
    expect(closestName("jump_height", ["jumpHeight", "wallJumpHeight"])).toBe("jumpHeight");
    expect(closestName("jumpHeigt", ["jumpHeight", "wallJumpHeight"])).toBe("jumpHeight");
    expect(closestName("speeed", ["speed", "step"])).toBe("speed");
    expect(closestName("teleport", ["speed", "step"])).toBeNull();
  });
});

describe("the console's game tables", () => {
  it("are found by memory map for Final Fantasy and from the game profile found for any other game", () => {
    expect(consoleTableFor("ff1", null)).toBe(finalFantasyConsole);
    expect(consoleTableFor("ff1", PROFILE)).toBe(finalFantasyConsole);
    expect(consoleTableFor(null, PROFILE)?.commands.map((command) => command.name)).toEqual(["blink"]);
    expect(consoleTableFor(null, null)).toBeNull();
  });

  it("Final Fantasy's values read and write the memory map's addresses", async () => {
    const { context, memory } = contextWith(finalFantasyConsole);
    memory.bytes.set([0x90, 0x01, 0x00], 0x601c);
    expect(await runLine("get gold", context)).toBe("gold = 400");
    expect(await runLine("set gold 123456", context)).toBe("gold = 123456 (was 400)");
    expect([...memory.bytes.slice(0x601c, 0x601f)]).toEqual([0x40, 0xe2, 0x01]);
    expect(await runLine("set hp2 35", context)).toBe("hp2 = 35 (was 0)");
    expect(memory.bytes[0x6100 + 0x40 + 0x0a]).toBe(35);
    expect(await runLine("set level4 5", context)).toBe("level4 = 5 (was 1)");
    expect(memory.bytes[0x6100 + 0xc0 + 0x26]).toBe(4);
    await expect(runLine("set map 1", context)).rejects.toThrow("map can be read but not set.");
  });

  it("a profile's command runs through the line runner, its waits on the host's frames", async () => {
    const { context, memory, calls } = contextWith(consoleTableFor(null, PROFILE));
    await runLine("pause", context);
    expect(await runLine("blink", context)).toBe("Blinked.");
    expect(memory.bytes[0x20]).toBe(1);
    expect(calls).toEqual(["pause", "wait 3"]);
  });
});
