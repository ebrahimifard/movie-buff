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
    .trim()
    .replace(/^(the|a|an) /, "");
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

// Whole-festival view: every selection section (not only the competition).
//   sections  — per year × section, scraped lineup count vs catalogue count
//   coverage  — per field, how many Cannes films have it (director is per
//               film: any of its Cannes nominations names one)
//   suspects  — films whose data contradicts the festival: dated after the
//               edition they screened at, or a restoration whose release
//               year is still just the festival year (never identified)
export const FILM_FIELDS = ["imdbId", "posterUrl", "runtimeMinutes", "genres", "synopsis", "director"];

export function buildCannesAudit({ sourceRecords, nominations, films }) {
  const filmsById = new Map(films.map((film) => [film.id, film]));
  const cannes = nominations.filter((nomination) => nomination.festivalId === "cannes");

  const sourceCounts = new Map(); // "year|section" -> count
  for (const record of sourceRecords) {
    if (record.festivalId !== "cannes" || record.result !== "nominee") continue;
    const key = `${record.year}|${record.category}`;
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  }
  const catalogueCounts = new Map();
  for (const nomination of cannes) {
    const key = `${nomination.year}|${nomination.category}`;
    if (!sourceCounts.has(key)) continue; // awards, not selection sections
    catalogueCounts.set(key, (catalogueCounts.get(key) ?? 0) + 1);
  }
  const sections = [...sourceCounts]
    .map(([key, expected]) => {
      const [year, section] = key.split(/\|(.*)/s);
      return { year: Number(year), section, expected, inCatalogue: catalogueCounts.get(key) ?? 0 };
    })
    .sort((a, b) => a.year - b.year || a.section.localeCompare(b.section));

  const directorByFilm = new Map();
  for (const nomination of cannes) {
    if (nomination.director) directorByFilm.set(nomination.filmId, nomination.director);
  }
  const filmIds = [...new Set(cannes.map((nomination) => nomination.filmId))];
  const coverage = Object.fromEntries(FILM_FIELDS.map((field) => [field, 0]));
  const gaps = [];
  for (const filmId of filmIds) {
    const film = filmsById.get(filmId);
    const missing = FILM_FIELDS.filter((field) => (field === "director" ? !directorByFilm.has(filmId) : !hasValue(film?.[field])));
    for (const field of FILM_FIELDS) if (!missing.includes(field)) coverage[field] += 1;
    if (missing.length) gaps.push({ filmId, title: film?.title ?? filmId, missing });
  }

  const suspects = [];
  const seen = new Set();
  for (const nomination of cannes) {
    const film = filmsById.get(nomination.filmId);
    if (!film || seen.has(`${film.id}|${nomination.year}`)) continue;
    seen.add(`${film.id}|${nomination.year}`);
    if (film.releaseYear > nomination.year + 1) {
      suspects.push({ year: nomination.year, title: film.title, filmId: film.id, section: nomination.category, reason: `released ${film.releaseYear}, after the festival` });
    } else if (nomination.category === "Cannes Classics" && film.releaseYear === nomination.year && !film.imdbId) {
      // A matched film dated its Classics year is a new documentary, which
      // is fine; an unmatched one may be a restoration with no known year.
      suspects.push({ year: nomination.year, title: film.title, filmId: film.id, section: nomination.category, reason: "unidentified (no IMDb match), year unknown" });
    }
  }

  return { films: filmIds.length, coverage, gaps, sections, suspects };
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

  const whole = buildCannesAudit({
    sourceRecords,
    nominations: await readJson("data/normalized/nominations.json"),
    films: await readJson("data/normalized/films.json")
  });
  const filmPct = (n) => (whole.films ? ((100 * n) / whole.films).toFixed(1) : "0.0");
  console.log(`\nAll Cannes films: ${whole.films}`);
  for (const [field, count] of Object.entries(whole.coverage)) {
    console.log(`  ${field.padEnd(15)} ${count} (${filmPct(count)}%)`);
  }
  const shortSections = whole.sections.filter((row) => row.inCatalogue < row.expected);
  console.log(`\nSelection sections (year × section): ${whole.sections.length}; below the scraped lineup: ${shortSections.length}`);
  for (const row of shortSections) console.log(`  ${row.year}  ${row.section}: ${row.inCatalogue}/${row.expected}`);
  console.log(`\nSuspect entries: ${whole.suspects.length}`);
  for (const suspect of whole.suspects) console.log(`  ${suspect.year}  ${suspect.section}  ${suspect.title} (${suspect.filmId}) — ${suspect.reason}`);
  if (args.includes("--list")) {
    console.log("\nCannes films missing metadata:");
    for (const gap of whole.gaps) console.log(`  ${gap.title} (${gap.filmId})  [${gap.missing.join(", ")}]`);
  }

  const jsonArg = args.find((arg) => arg.startsWith("--json="));
  if (jsonArg) {
    await writeFile(jsonArg.slice("--json=".length), `${JSON.stringify({ competition: audit, festival: whole }, null, 2)}\n`, "utf8");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Cannes competition audit failed", error);
    process.exitCode = 1;
  });
}
