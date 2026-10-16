import { describe, expect, it } from "vitest";
import type { ConsoleMemory } from "./gameTable";
import { parseGameProfile, profileConsoleTable, type GameProfile } from "./gameProfile";

function memoryStub(): ConsoleMemory & { bytes: Uint8Array } {
  const bytes = new Uint8Array(0x10000);
  const palette = new Uint8Array(32);
  palette[16] = 0x22;
  return {
    bytes,
    peek: (address) => bytes[address],
    poke(address, value) {
      if (address >= 0x2000) throw new RangeError(`$${address.toString(16)} is not RAM.`);
      bytes[address] = value;
    },
    palette: () => palette,
  };
}

const SHA = "a".repeat(64);

/** A made-up game: a stage picked by name, a mode byte, a timer kept as three digits and a queue of bytes. */
const PROFILE = {
  format: "retrowright-game-profile",
  version: 1,
  title: "Test racer",
  romSha256: [SHA],
  values: [
    { name: "laps", description: "Laps, as shown.", address: "$0010", shownOffset: 1, max: 9 },
    { name: "mode", description: "0 menu, 1 race.", address: "$0011", readOnly: true },
    { name: "speed", description: "Signed speed.", address: "$0012", format: "signed", readOnly: true },
    { name: "flags", description: "Flag bits.", address: "$0013", format: "hex" },
    { name: "clock", description: "The clock's three digits.", address: "$0020", bytes: 3, format: "digits" },
    { name: "score", description: "Two bytes.", address: "$0030", bytes: 2 },
  ],
  commands: [
    {
      name: "stage",
      usage: "stage <cup>-<race>",
      help: "On the menu, picks the race.",
      args: [{ name: "pick", choices: { "1-1": { cup: 0, race: 0 }, "2-3": { cup: 1, race: 2 } } }],
      steps: [
        { require: [{ read: "mode", equals: 0 }], message: "stage works on the menu; type reset, then stage {pick}." },
        { write: "$0040", value: "{pick.cup}" },
        { write: "$0041", value: "{pick.race}" },
      ],
      reply: "The next race is {pick}.",
    },
    {
      name: "clock",
      usage: "clock <n>",
      help: "Sets the clock.",
      args: [{ name: "n", min: 0, max: 999 }],
      steps: [{ set: "clock", value: "{n}" }],
      reply: "Clock: {n}.",
    },
    {
      name: "boost",
      usage: "boost",
      help: "Boosts once, in a race.",
      steps: [
        { require: [{ read: "mode", equals: 1 }, { read: "$0050", notEquals: 0 }], message: "boost works in a race." },
        { stopWhen: [{ read: "$0051", equals: 1 }], reply: "Already boosting." },
        { when: [{ read: "flags", equals: 0 }], steps: [{ write: "$0013", value: 128 }] },
        { write: "$0061", offsetBy: "$0060", bytes: [63, 16, { palette: 16 }, 0] },
        { increase: "$0060", by: 3 },
        { write: "$0051", value: 1 },
        { wait: 2 },
        { write: "$0051", value: 0 },
      ],
      reply: "Boosted.",
    },
  ],
};

function table() {
  const memory = memoryStub();
  const waits: number[] = [];
  const { values, commands } = profileConsoleTable(parseGameProfile(PROFILE, "test.profile.json"));
  const run = (line: string) => {
    const [name, ...args] = line.split(" ");
    return Promise.resolve(commands.find((command) => command.name === name)!.run(args, memory, async (frames) => void waits.push(frames)));
  };
  const value = (name: string) => values.find((candidate) => candidate.name === name)!;
  return { memory, waits, run, value };
}

describe("a game profile's values", () => {
  it("read and write RAM in their formats: shown offset, read only, signed, hex, digits and two bytes", () => {
    const { memory, value } = table();
    memory.bytes.set([2, 1, 0xfe, 0x0f], 0x10);
    memory.bytes.set([3, 0, 7], 0x20);
    memory.bytes.set([0x34, 0x12], 0x30);
    expect(value("laps").read(memory)).toBe(3);
    expect(value("mode").write).toBeUndefined();
    expect(value("speed").read(memory)).toBe(-2);
    expect(value("flags").show!(15)).toBe("$0F");
    expect(value("clock").read(memory)).toBe(307);
    value("clock").write!(memory, 42);
    expect([...memory.bytes.slice(0x20, 0x23)]).toEqual([0, 4, 2]);
    expect(value("clock").max).toBe(999);
    expect(value("score").read(memory)).toBe(0x1234);
  });
});

describe("a game profile's commands", () => {
  it("take a choice and put its numbers into writes and its word into the reply, or refuse with the message", async () => {
    const { memory, run } = table();
    expect(await run("stage 2-3")).toBe("The next race is 2-3.");
    expect([memory.bytes[0x40], memory.bytes[0x41]]).toEqual([1, 2]);
    await expect(run("stage 9-9")).rejects.toThrow("Usage: stage <cup>-<race>.");
    memory.bytes[0x11] = 1;
    await expect(run("stage 1-1")).rejects.toThrow("stage works on the menu; type reset, then stage 1-1.");
  });

  it("take a number in its range and set a named value with it", async () => {
    const { memory, run } = table();
    expect(await run("clock 905")).toBe("Clock: 905.");
    expect([...memory.bytes.slice(0x20, 0x23)]).toEqual([9, 0, 5]);
    await expect(run("clock 1000")).rejects.toThrow("Usage: clock <n>, with n from 0 to 999.");
    await expect(run("clock")).rejects.toThrow("Usage: clock <n>.");
  });

  it("check every condition, stop early with a reply, write when a condition holds, queue bytes at an offset with a palette entry, and wait", async () => {
    const { memory, run, waits } = table();
    await expect(run("boost")).rejects.toThrow("boost works in a race.");
    memory.bytes[0x11] = 1;
    memory.bytes[0x50] = 1;
    memory.bytes[0x60] = 4;
    expect(await run("boost")).toBe("Boosted.");
    expect(memory.bytes[0x13]).toBe(128);
    expect([...memory.bytes.slice(0x65, 0x69)]).toEqual([63, 16, 0x22, 0]);
    expect(memory.bytes[0x60]).toBe(7);
    expect(waits).toEqual([2]);
    expect(memory.bytes[0x51]).toBe(0);
    memory.bytes[0x13] = 1;
    memory.bytes[0x51] = 1;
    expect(await run("boost")).toBe("Already boosting.");
    expect(memory.bytes[0x60]).toBe(7);
  });
});

describe("parseGameProfile", () => {
  const broken = (change: (profile: Record<string, unknown>) => void) => {
    const copy = structuredClone(PROFILE) as unknown as Record<string, unknown>;
    change(copy);
    return () => parseGameProfile(copy, "x.profile.json");
  };
  const commands = (profile: Record<string, unknown>) => profile.commands as Record<string, unknown>[];

  it("reads the test profile", () => {
    const profile: GameProfile = parseGameProfile(PROFILE, "x.profile.json");
    expect(profile.commands.map((command) => command.name)).toEqual(["stage", "clock", "boost"]);
  });

  it("refuses a file of another format, a value with no RAM address, an unknown step, a set of an unknown value and a long wait", () => {
    expect(broken((profile) => (profile.format = "retrowright-tunables"))).toThrow('x.profile.json is not a game profile this page reads: its format is "retrowright-tunables"');
    expect(broken((profile) => ((profile.values as Record<string, unknown>[])[0].address = "16"))).toThrow('value laps has no RAM address written as "$hex"');
    expect(broken((profile) => (commands(profile)[1].steps = [{ jump: 1 }]))).toThrow("command clock, step 1, is not one of require");
    expect(broken((profile) => (commands(profile)[1].steps = [{ set: "lives", value: 1 }]))).toThrow('sets "lives", which is not a value of the profile');
    expect(broken((profile) => (commands(profile)[2].steps = [{ wait: 99999 }]))).toThrow("waits 99999 frames, not 1 to 3600");
    expect(broken((profile) => (profile.romSha256 = ["ABC"]))).toThrow("romSha256 is not a list of SHA-256s");
  });

  it("refuses a command that sets a read-only value, inside a when too", () => {
    const profile = structuredClone(PROFILE) as unknown as Record<string, unknown>;
    commands(profile)[1].steps = [{ when: [{ read: "mode", equals: 0 }], steps: [{ set: "mode", value: 1 }] }];
    expect(() => profileConsoleTable(parseGameProfile(profile, "x.profile.json"))).toThrow("Test racer: a command sets mode, which is read only.");
  });
});
