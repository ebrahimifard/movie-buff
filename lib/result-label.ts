import type { Nomination } from "./types";

export type ResultLabel = "Winner" | "Nominee" | "Selected";

// How a nomination's result reads on the site. A "nominee" row in a
// non-competitive section (Category.isAward false — e.g. Cannes Classics,
// Out of Competition, Directors' Fortnight) was selected to screen, not
// nominated for anything, so it reads "Selected". An unknown category keeps
// the old "Nominee" wording rather than guessing.
export function resultLabel(result: Nomination["result"], isAward: boolean | undefined): ResultLabel {
  if (result === "winner") return "Winner";
  return isAward === false ? "Selected" : "Nominee";
}
