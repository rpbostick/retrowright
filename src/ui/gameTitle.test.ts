import { describe, expect, it } from "vitest";
import { displayTitle, patchedFileName, patchedTitle, titleFromFileName } from "./gameTitle";

describe("titleFromFileName", () => {
  it("drops the extension and turns underscores into spaces", () => {
    expect(titleFromFileName("Final_Fantasy_USA.nes")).toEqual({ title: "Final Fantasy USA", tags: [] });
  });

  it("moves region and revision tags into the subtitle", () => {
    expect(titleFromFileName("Legend of Zelda, The (USA) (Rev 1) [!].nes")).toEqual({ title: "Legend of Zelda, The", tags: ["USA", "Rev 1", "!"] });
    expect(titleFromFileName("Kid Icarus (World).NES")).toEqual({ title: "Kid Icarus", tags: ["World"] });
  });

  it("keeps a name made only of tags", () => {
    expect(titleFromFileName("(Prototype).nes")).toEqual({ title: "(Prototype)", tags: ["Prototype"] });
  });
});

describe("patched names", () => {
  it("join the original's and the patch's names, keeping the original's tags", () => {
    const fileName = patchedFileName("Legend of Zelda, The (USA).nes", "Redux_v2.bps");
    expect(fileName).toBe("Legend of Zelda, The (USA) + Redux_v2.nes");
    expect(titleFromFileName(fileName)).toEqual({ title: "Legend of Zelda, The + Redux v2", tags: ["USA"] });
    expect(patchedTitle("My Zelda", "Redux.ips")).toBe("My Zelda + Redux");
  });
});

describe("displayTitle", () => {
  it("prefers the player's own title, without tags", () => {
    expect(displayTitle({ fileName: "ff (USA).nes", title: "My Final Fantasy" })).toEqual({ title: "My Final Fantasy", tags: [] });
    expect(displayTitle({ fileName: "ff (USA).nes", title: null })).toEqual({ title: "ff", tags: ["USA"] });
  });
});
