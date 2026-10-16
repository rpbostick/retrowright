// A library title from a ROM's file name. Dump names carry region and
// revision tags in brackets or parentheses ("Zelda (USA) (Rev 1) [!].nes");
// those move to a subtitle so the title itself reads as the game's name.

export interface GameTitle {
  title: string;
  /** The bracketed tags, in file-name order, without their brackets. */
  tags: string[];
}

const TAG = /\(([^()]*)\)|\[([^[\]]*)\]/g;
const EXTENSION = /\.[a-z0-9]{1,5}$/i;

export function titleFromFileName(fileName: string): GameTitle {
  const base = fileName.replace(EXTENSION, "");
  const tags = [...base.matchAll(TAG)].map((match) => (match[1] ?? match[2]).trim()).filter((tag) => tag.length > 0);
  const title = base.replace(TAG, " ").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  // A name made only of tags keeps them as its title rather than showing nothing.
  return { title: title.length > 0 ? title : base.trim(), tags };
}

/**
 * The file name a patched ROM is kept under: the original's and the patch's,
 * joined, so its title reads "Game + patch" and the original's tags stay.
 */
export function patchedFileName(romFileName: string, patchFileName: string): string {
  return `${romFileName.replace(EXTENSION, "")} + ${patchFileName.replace(EXTENSION, "")}.nes`;
}

/** The title of a patched ROM whose original has the player's own title: that title and the patch's name. */
export function patchedTitle(romTitle: string, patchFileName: string): string {
  return `${romTitle} + ${patchFileName.replace(EXTENSION, "")}`;
}

/** The title shown on a card: the player's own, or the one from the file name. */
export function displayTitle(game: { fileName: string; title: string | null }): GameTitle {
  if (game.title !== null) return { title: game.title, tags: [] };
  return titleFromFileName(game.fileName);
}
