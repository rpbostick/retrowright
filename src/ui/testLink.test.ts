import { describe, expect, it } from "vitest";
import { listedGameLink, missingTestFile, parseTestLink } from "./testLink";

describe("parseTestLink", () => {
  it("is null without play=", () => {
    expect(parseTestLink("?movie=local-movies/a.rwmovie.json")).toBeNull();
  });

  it("reads the ROM, label and controls, with no movie unless given", () => {
    expect(parseTestLink("?play=local-roms/Zelda%20Redux.nes&label=%20Redux%20&controls=1")).toEqual({
      ok: true,
      fileName: "Zelda Redux.nes",
      url: "/local-roms/Zelda%20Redux.nes",
      label: "Redux",
      controls: true,
      movie: null,
      title: null,
    });
  });

  it("reads game= as an id for the folder's games.json, which names no game in the page's code", () => {
    expect(parseTestLink("?game=homebrew-racer")).toEqual({ ok: true, gameId: "homebrew-racer" });
    expect(parseTestLink("?game=../a")).toEqual({ ok: false, problem: "Test link: game=../a is not a game id (lower-case letters, digits and -)." });
  });

  it("opens a listed game by its ROM in local-roms/, its label as the banner and library name, with the controls", () => {
    expect(listedGameLink({ label: "Homebrew Racer", rom: "Homebrew Racer.nes" })).toEqual({
      ok: true,
      fileName: "Homebrew Racer.nes",
      url: "/local-roms/Homebrew%20Racer.nes",
      label: "Homebrew Racer",
      controls: true,
      movie: null,
      title: "Homebrew Racer",
    });
  });

  it("reads movie= as a file in local-movies/", () => {
    const link = parseTestLink("?play=local-roms/racer.nes&movie=local-movies/racer%20lap.rwmovie.json&label=racer");
    expect(link).toMatchObject({ ok: true, fileName: "racer.nes", movie: { fileName: "racer lap.rwmovie.json", url: "/local-movies/racer%20lap.rwmovie.json" } });
  });

  it("refuses a movie= outside local-movies/ or with a folder part", () => {
    for (const movie of ["movies/bot/a.rwmovie.json", "local-movies/", "local-movies/sub/a.rwmovie.json", "local-movies/..\\a.rwmovie.json", "https://example.com/a.rwmovie.json"]) {
      expect(parseTestLink(`?play=local-roms/a.nes&movie=${encodeURIComponent(movie)}`), movie).toEqual({
        ok: false,
        problem: `Test link: movie=${movie} is not a file in local-movies/; use movie=local-movies/<file name>.`,
      });
    }
  });

  it("refuses a play= outside local-roms/", () => {
    expect(parseTestLink("?play=local-movies/a.nes")).toEqual({ ok: false, problem: "Test link: play=local-movies/a.nes is not a file in local-roms/; use play=local-roms/<file name>." });
  });
});

describe("missingTestFile", () => {
  it("tells a missing file from another failure, with the server's reason", () => {
    expect(missingTestFile("a.rwmovie.json", 404, "No a.rwmovie.json in the test ROM folder.\n")).toBe("Test link: “a.rwmovie.json” was not found. No a.rwmovie.json in the test ROM folder.");
    expect(missingTestFile("a.nes", 500, "")).toBe("Test link: “a.nes” could not be fetched (HTTP 500). HTTP 500");
  });
});
