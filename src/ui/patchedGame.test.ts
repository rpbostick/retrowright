import { describe, expect, it } from "vitest";
import { createBps, crc32, crc32Hex } from "../patch/patch";
import { MemoryGameStore, romId } from "../storage/gameStore";
import { buildInes, PAINT_BACKDROP_PROGRAM, READ_PAD_PROGRAM } from "../test/syntheticRom";
import { addPatchedGame } from "./patchedGame";

const source = buildInes({ program: READ_PAD_PROGRAM });
const target = buildInes({ program: PAINT_BACKDROP_PROGRAM });

async function libraryWithSource() {
  let time = 1000;
  const store = new MemoryGameStore(() => ++time);
  const { game } = await store.addRom("Pad Test (World).nes", source);
  return { store, original: game };
}

describe("addPatchedGame", () => {
  it("adds the patched ROM as a new game keyed by its SHA-256, named after both, and leaves the original as it was", async () => {
    const { store, original } = await libraryWithSource();
    const before = await store.listGames();
    const result = await addPatchedGame(store, original.id, "red.bps", createBps(source, target));
    expect(result.duplicate).toBe(false);
    expect(result.game).toMatchObject({
      id: await romId(target),
      fileName: "Pad Test (World) + red.nes",
      title: null,
      patchedFrom: { romId: original.id, romTitle: "Pad Test", patchName: "red.bps" },
    });
    expect((await store.getRom(result.game.id))?.data).toEqual(target);
    expect((await store.getRom(original.id))?.data).toEqual(source);
    expect((await store.listGames()).find((game) => game.id === original.id)).toEqual(before[0]);
  });

  it("carries the player's own title over, with the patch's name", async () => {
    const { store, original } = await libraryWithSource();
    await store.renameGame(original.id, "Mine");
    const result = await addPatchedGame(store, original.id, "red.bps", createBps(source, target));
    expect(result.game.title).toBe("Mine + red");
    expect((await store.listGames()).find((game) => game.id === result.game.id)?.title).toBe("Mine + red");
  });

  it("refuses a BPS made for another ROM, naming the CRC32 it expects, and adds nothing", async () => {
    const { store, original } = await libraryWithSource();
    const other = buildInes({ program: [0xea, 0x4c, 0x00, 0x80] });
    await expect(addPatchedGame(store, original.id, "red.bps", createBps(other, target))).rejects.toThrow(`This patch is for a ROM with CRC32 ${crc32Hex(crc32(other))}`);
    expect(await store.listGames()).toHaveLength(1);
  });

  it("refuses a patch whose result is not an NES ROM", async () => {
    const { store, original } = await libraryWithSource();
    await expect(addPatchedGame(store, original.id, "broken.bps", createBps(source, new Uint8Array(64)))).rejects.toThrow("The patched ROM is not one this player can run");
    expect(await store.listGames()).toHaveLength(1);
  });

  it("refuses a game that is no longer in the library", async () => {
    const { store } = await libraryWithSource();
    await expect(addPatchedGame(store, "gone", "red.bps", createBps(source, target))).rejects.toThrow("That game is no longer stored in this browser.");
  });
});
