// Category display names are stored verbatim from their source (Wikidata
// award labels, Wikipedia category headings) and often repeat the festival's
// own institutional name as a prefix or parenthetical suffix — redundant
// once the category is already shown on that festival's own page. This
// strips ONLY those festival-name variants, never a trophy/tier name (Golden
// Bear, Palme d'Or, Golden Leopard, ...), since those carry real
// distinguishing information the festival-name prefix doesn't.
//
// Display-layer only: Nomination.category / Category.name in the underlying
// data are never mutated, so the full name is always still there if needed
// (e.g. for cross-referencing scraped source records).
const FESTIVAL_NAME_VARIANTS: Record<string, string[]> = {
  oscars: ["Academy Awards", "Academy Award"],
  bafta: ["BAFTA Awards", "BAFTA Award"],
  "golden-globes": ["Golden Globe Awards", "Golden Globe Award", "Golden Globes"],
  cannes: ["Cannes International Film Festival", "Cannes Film Festival"],
  venice: ["Venice International Film Festival", "Venice Film Festival"],
  berlinale: ["Berlin International Film Festival", "Berlinale International Film Festival"],
  locarno: ["Locarno International Film Festival", "Locarno Film Festival"],
  sundance: ["Sundance Film Festival"],
  tiff: ["Toronto International Film Festival"]
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function simplifyCategoryLabel(categoryName: string, festivalId: string): string {
  const variants = FESTIVAL_NAME_VARIANTS[festivalId];
  if (!variants || !categoryName) {
    return categoryName;
  }

  let result = categoryName;
  for (const variant of variants) {
    const escaped = escapeRegExp(variant);
    // Prefix form: "{variant} for X" or "{variant} X" (Locarno concatenates
    // with no connector word at all).
    result = result.replace(new RegExp(`^${escaped}\\s*(?:for)?\\s*`, "i"), "");
    // Suffix form: "X ({variant})".
    result = result.replace(new RegExp(`\\s*\\(${escaped}\\)\\s*$`, "i"), "");
  }

  const trimmed = result.trim();
  return trimmed || categoryName;
}
