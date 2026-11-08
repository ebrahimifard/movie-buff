// Script: audit-cannes-competition.mjs
// Purpose: Read-only check that every film in Cannes' main competition
// (per the scraped Wikipedia lineup, data/source/cannes-wikipedia.json) is
// in the catalogue (data/normalized) as a Palme d'Or nominee/winner, and
// which of those films still lack an imdbId, poster, runtime, genres or
// synopsis.
// Usage: node scripts/audit-cannes-competition.mjs [--json=path] [--list]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const COMPETITION_CATEGORY = "Palme d'Or";
// No festival was held in these years (see fetch-cannes-wikipedia.mjs).
export const YEARS_WITHOUT_FESTIVAL = [1948, 1950];
export const METADATA_FIELDS = ["imdbId", "posterUrl", "runtimeMinutes", "genres", "synopsis"];

function titleKey(title) {
  return String(title ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

export function missingMetadata(film) {
  if (!film) return [...METADATA_FIELDS];
  return METADATA_FIELDS.filter((field) => !hasValue(film[field]));
}

// Pure: compares the scraped lineup against the normalized catalogue.
//   sourceRecords — cannes-wikipedia.json records
//   nominations/films — data/normalized arrays
export function buildCompetitionAudit({ sourceRecords, nominations, films }) {
  const filmsById = new Map(films.map((film) => [film.id, film]));

  const lineup = new Map(); // year -> [{title, originalTitle}]
  for (const record of sourceRecords) {
    if (record.festivalId !== "cannes" || record.category !== COMPETITION_CATEGORY || record.result !== "nominee") continue;
    if (!lineup.has(record.year)) lineup.set(record.year, []);
    lineup.get(record.year).push({ title: record.film.title, originalTitle: record.film.originalTitle });
  }

  const catalogue = new Map(); // year -> Map(filmId -> nomination)
  for (const nomination of nominations) {
    if (nomination.festivalId !== "cannes" || nomination.category !== COMPETITION_CATEGORY) continue;
    if (!catalogue.has(nomination.year)) catalogue.set(nomination.year, new Map());
    catalogue.get(nomination.year).set(nomination.filmId, nomination);
  }

  const years = [...new Set([...lineup.keys(), ...catalogue.keys()])].sort((a, b) => a - b);
  const rows = [];
  const missingFromCatalogue = [];
  const metadataGaps = [];

  for (const year of years) {
    const expected = lineup.get(year) ?? [];
    const present = catalogue.get(year) ?? new Map();
    const presentKeys = new Set();
    for (const nomination of present.values()) {
      presentKeys.add(titleKey(nomination.title));
      presentKeys.add(titleKey(filmsById.get(nomination.filmId)?.title));
    }

    const missing = expected.filter((entry) => !presentKeys.has(titleKey(entry.title)) && !presentKeys.has(titleKey(entry.originalTitle)));
    for (const entry of missing) missingFromCatalogue.push({ year, title: entry.title });

    let complete = 0;
    for (const nomination of present.values()) {
      const film = filmsById.get(nomination.filmId);
      const missingFields = missingMetadata(film);
      if (missingFields.length === 0) {
        complete += 1;
      } else {
        metadataGaps.push({ year, title: nomination.title, filmId: nomination.filmId, result: nomination.result, missing: missingFields });
      }
    }

    rows.push({
      year,
      expected: expected.length,
      inCatalogue: present.size,
      missing: missing.length,
      fullMetadata: complete,
      phantom: YEARS_WITHOUT_FESTIVAL.includes(year)
    });
  }

  const totalInCatalogue = rows.reduce((sum, row) => sum + row.inCatalogue, 0);
  const fieldCoverage = Object.fromEntries(
    METADATA_FIELDS.map((field) => [field, totalInCatalogue - metadataGaps.filter((gap) => gap.missing.includes(field)).length])
  );

  return {
    years: rows,
    totals: {
      expected: rows.reduce((sum, row) => sum + row.expected, 0),
      inCatalogue: totalInCatalogue,
      missing: missingFromCatalogue.length,
      fullMetadata: rows.reduce((sum, row) => sum + row.fullMetadata, 0),
      fieldCoverage
    },
    missingFromCatalogue,
    metadataGaps
  };
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(process.cwd(), relativePath), "utf8"));
}

async function run() {
  const args = process.argv.slice(2);
  const raw = await readJson("data/source/cannes-wikipedia.json");
  const sourceRecords = Array.isArray(raw) ? raw : raw.records ?? [];
  const audit = buildCompetitionAudit({
    sourceRecords,
    nominations: await readJson("data/normalized/nominations.json"),
    films: await readJson("data/normalized/films.json")
  });

  console.log("year  expected  catalogue  missing  full-metadata");
  for (const row of audit.years) {
    const flag = row.phantom ? "  <- no festival this year" : row.missing ? "  <- missing films" : "";
    console.log(
      `${row.year}  ${String(row.expected).padStart(8)}  ${String(row.inCatalogue).padStart(9)}  ${String(row.missing).padStart(7)}  ${String(row.fullMetadata).padStart(13)}${flag}`
    );
  }
  const { totals } = audit;
  const pct = (n) => (totals.inCatalogue ? ((100 * n) / totals.inCatalogue).toFixed(1) : "0.0");
  console.log(`\nLineup films: ${totals.expected}; competition films in catalogue: ${totals.inCatalogue}; lineup films missing: ${totals.missing}`);
  console.log(`Full metadata: ${totals.fullMetadata} (${pct(totals.fullMetadata)}%)`);
  for (const [field, count] of Object.entries(totals.fieldCoverage)) {
    console.log(`  ${field.padEnd(15)} ${count} (${pct(count)}%)`);
  }

  if (args.includes("--list")) {
    console.log("\nMissing from catalogue:");
    for (const entry of audit.missingFromCatalogue) console.log(`  ${entry.year}  ${entry.title}`);
    console.log("\nMetadata gaps:");
    for (const gap of audit.metadataGaps) console.log(`  ${gap.year}  ${gap.title}  [${gap.missing.join(", ")}]`);
  }

  const jsonArg = args.find((arg) => arg.startsWith("--json="));
  if (jsonArg) {
    await writeFile(jsonArg.slice("--json=".length), `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Cannes competition audit failed", error);
    process.exitCode = 1;
  });
}
