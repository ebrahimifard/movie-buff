// One-off authoring script for data/source/category-classifications.json.
// Not part of the regular pipeline — run manually after reviewing a fresh
// category list, then commit the resulting JSON. Encodes a real semantic
// review (every value read and judged on its own meaning/context, not a
// keyword scan) as an explicit EXCLUSION list per festival; everything in
// the current corpus that isn't explicitly excluded is a genuine award.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

// Universal: literal system placeholders our own scrapers emit when
// category extraction fails — never real category text, regardless of
// festival.
const UNIVERSAL_NON_AWARD = new Set(["Unknown category", "Statistics", "Winners and nominees"]);

// Per-festival: genuinely reviewed as non-award — a section/programming
// strand name, a bare format/genre tag with no competitive framing, a
// retrospective/tribute/homage leak the structural fix's fixed-word prefix
// list didn't happen to cover, a malformed/garbled parser artifact, or a
// pure statistics/administrative fragment. Everything else in the current
// corpus is treated as a genuine award, prize, nomination, or recognition —
// including many with no "award"/"prize"/"best" in the name at all (Teddy
// Award, Volpi Cup, Golden Osella, Palm Dog, sponsor/org-named prizes).
const NON_AWARD_BY_FESTIVAL = {
  cannes: [
    "Awards",
    "Independent awards",
    "Official awards",
    "Official sections",
    "Out of Competition",
    "Out of competition",
    "Cannes Classics",
    "Cannes Premiere",
    "Cinéma de la Plage",
    "Cinéma de la plage",
    "Critics' Week (Semaine de la critique)",
    "Directors' Fortnight (Quinzaine des Réalizateurs)",
    "Directors' Fortnight (Quinzaine des cinéastes)",
    "International Critics' Week",
    "Short and medium-length films",
    "Short films",
    "Homage",
    "Hommage",
    "Tribute",
    "The Faithful (or at least selected once before)",
    "The Newcomers",
    "Three films for Ukraine",
    "Special Screenings",
    "Omnibus Film"
  ],
  venice: [
    "Awards",
    "Official Awards",
    "Out of Competition",
    "Out of competition",
    "Restored Films",
    "Restored Films - Main Competition",
    "Restored Films - Out of Competition",
    "Restored Prints",
    "Restored classic films",
    "Restored films",
    "Special Events",
    "Special Event",
    "Special events",
    "Special event",
    "Special Events - Ipotesi Cinema: Bologna",
    "Special Events 1 - Centro Sperimentale di Cinematografia: Scuola Nazionale di Cinema",
    "Special Events 2 - Centro Sperimentale di Cinematografia: Scuola Nazionale di Cinema",
    "Special Events 3 - Corto d'autore: Italia",
    "Special Events - Out of competition",
    "Special events – Out of competition",
    "Special events: Between Europe and Middle East",
    "Special events: Crossings (Incroci)",
    "Special Screening",
    "Special Screenings",
    "Special screenings",
    "Special Screening Event – Out of competition",
    "Special Projects (Cinema Corsaro)",
    "Special projects",
    "Documentaries",
    "Documentaries About Cinema",
    "Documentaries about Cinema",
    "Documentaries about cinema",
    "Documentaries and shorts",
    "Documentaries on cinema",
    "Documentary",
    "Documents",
    "Docufiction",
    "Non Fiction",
    "Non-Fiction",
    "Non-fiction",
    "Feature Films",
    "Feature films",
    "Feature films - Fiction",
    "Feature films - Non Fiction",
    "Feature documentaries",
    "Fiction",
    "Fiction Films",
    "Fiction films",
    "Medium-length Films",
    "Medium-length films",
    "Short Films",
    "Short films",
    "Short Documentaries Films",
    "Short Experimental Films",
    "Portraits (documentaries)",
    "Series",
    "Alternatives",
    "Digital Africa",
    "Vanguard",
    "Window on Images",
    "Overtaking Lane",
    "Officina Veneziana",
    "Officina veneziana",
    "Mattinate del Cinema Italiano",
    "Sconfini",
    "Controcorrente",
    "Upstream (Controcorrente)",
    "Cortocampo Italiano",
    "Il Cinema nel Giardino",
    "Il cinema ritrovato",
    "Italian Cinema Week",
    "Italian Film Panorama",
    "Italian Panorama",
    "Italian panorama",
    "Venetian Nights",
    "Venetian workshop",
    "Programma Speciale",
    "Prospectives (Prospettive)",
    "Free Space for Authors",
    "Open Space",
    "Villa degli Autori – Open Space",
    "Venezia Giorno",
    "Venezia Notte",
    "Venezia Notte (Midnight)",
    "Midday (mezzogiorno)",
    "Midnight (mezzanotte)",
    "Mezzogiorno-Mezzanotte",
    "Venezia Giovani",
    "Venezia Maestri",
    "Venezia De Sica",
    "Venezia TV",
    "Venice Classics",
    "Venice Digital Cinema",
    "Venice Nights",
    "Venice Nights (Notti Veneziane)",
    "Venice Nights - Dialogues With Auteurs",
    "Venice Nights - Special Screening",
    "Venice Nights - Tribute to Jean-Marc Vallée in collaboration with SODEC and the Delegation of Quebec in Rome",
    "Venice Spotlight",
    "Nights and Stars (Notti e Stelle)",
    "Events",
    "Events of the Retrospective",
    "Informativa",
    "Tacoma",
    "The City (1961)",
    "Bis (1966)",
    "Febbre da cavallo (1976)",
    "LSD (1970)",
    "Vacanze di Natale (1983)",
    "Vietnam (1967)",
    "The numbers and the nations of the 63rd Show",
    "Titanus's one hundredth year",
    "Sessantotto e dintorni",
    "Risguardi - Evgenij Francevic Bauer",
    "Risguardi - Michal Waszynski",
    "Schools of cinema: Centro Sperimentale di Cinematografia - Scuola Nazionale di Cinema:",
    "Schools of cinema: London Film School",
    "Italian Retrospective",
    "Italian Retrospective: These Phantoms 2",
    "Italian avant-garde retrospective",
    "Biennale College Cinema Immersive",
    "Biennale College Cinema VR - Out of Competition",
    "Biennale College Cinema VR – Out of competition"
  ],
  berlinale: ["Official Awards", "International Short Film", "Literature", "Thrillers and adventures"],
  bafta: [],
  "golden-globes": [
    "\"Arthur's Theme (Best That You Can Do)\" (Carole Bayer Sager, Burt Bacharach, Peter Allen, Christopher Cross) – Arthur \"Endless Love\" (Lionel Richie) – Endless Love \"For Your Eyes Only\" (Bill Conti, Mick Leeson) – For Your Eyes Only \"It's Wrong for Me to Love You\" (Ennio Morricone, Carol Connors) – Butterfly \"One More Hour\" (Randy Newman, Jennifer Warnes) – Ragtime",
    "Gandhi (United Kingdom/India) Fitzcarraldo (West Germany) La Traviata (Italy) The Man from Snowy River (Australia) Quest for Fire (Canada/France) Yol (Switzerland/Turkey)",
    "Acting",
    "Cinematography",
    "Film",
    "Other",
    "Promoting International Understanding"
  ],
  oscars: [],
  locarno: [],
  sundance: [],
  tiff: []
};

async function run() {
  const freshCategoriesPath = process.argv[2];
  if (!freshCategoriesPath) {
    console.error("Usage: node scripts/lib/generate-category-classifications.mjs <fresh-categories.json>");
    process.exitCode = 1;
    return;
  }

  const byFestival = JSON.parse(await readFile(freshCategoriesPath, "utf8"));
  const classifications = [];

  for (const [festivalId, categories] of Object.entries(byFestival)) {
    const nonAward = new Set(NON_AWARD_BY_FESTIVAL[festivalId] ?? []);
    for (const category of categories) {
      const isAward = !UNIVERSAL_NON_AWARD.has(category) && !nonAward.has(category);
      classifications.push({ festivalId, category, isAward });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    note:
      "Every entry here reflects a real read of that category's meaning and festival context, not a keyword/regex match. A (festivalId, category) pair with no entry here is unclassified — scripts/validate-data.mjs flags it rather than guessing.",
    classifications
  };

  const outputPath = path.join(root, "data", "source", "category-classifications.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${classifications.length} classifications (${classifications.filter((c) => !c.isAward).length} non-award) to ${outputPath}`);
}

run().catch((error) => {
  console.error("Failed to generate category classifications", error);
  process.exitCode = 1;
});
