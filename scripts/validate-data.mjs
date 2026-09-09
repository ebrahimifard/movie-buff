import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  FestivalSchema,
  CeremonySchema,
  CategorySchema,
  PersonSchema,
  FilmSchema,
  NominationSchema
} from "../lib/schemas.mjs";
import { logStep } from "./lib/log.mjs";

const root = process.cwd();
const normalizedDir = path.join(root, "data", "normalized");
const categoryClassificationsPath = path.join(root, "data", "source", "category-classifications.json");

const ENTITY_FILES = [
  { key: "festivals", file: "festivals.json", schema: FestivalSchema },
  { key: "ceremonies", file: "ceremonies.json", schema: CeremonySchema },
  { key: "categories", file: "categories.json", schema: CategorySchema },
  { key: "films", file: "films.json", schema: FilmSchema },
  { key: "people", file: "people.json", schema: PersonSchema },
  { key: "nominations", file: "nominations.json", schema: NominationSchema }
];

export function validateEntities(entities) {
  const issues = [];

  for (const { key, schema } of ENTITY_FILES) {
    const records = entities[key] ?? [];
    records.forEach((record, index) => {
      const result = schema.safeParse(record);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push(
            `[${key}][index ${index}, id=${record?.id ?? "?"}] ${issue.path.join(".")}: ${issue.message}`
          );
        }
      }
    });
  }

  return issues;
}

export function checkReferentialIntegrity(entities) {
  const issues = [];

  const festivalIds = new Set((entities.festivals ?? []).map((item) => item.id));
  const ceremonyIds = new Set((entities.ceremonies ?? []).map((item) => item.id));
  const categoryIds = new Set((entities.categories ?? []).map((item) => item.id));
  const filmIds = new Set((entities.films ?? []).map((item) => item.id));
  const personIds = new Set((entities.people ?? []).map((item) => item.id));

  for (const ceremony of entities.ceremonies ?? []) {
    if (!festivalIds.has(ceremony.festivalId)) {
      issues.push(`[ceremonies][id=${ceremony.id}] festivalId "${ceremony.festivalId}" does not resolve to a Festival`);
    }
  }

  for (const category of entities.categories ?? []) {
    if (!festivalIds.has(category.festivalId)) {
      issues.push(`[categories][id=${category.id}] festivalId "${category.festivalId}" does not resolve to a Festival`);
    }
  }

  for (const nomination of entities.nominations ?? []) {
    if (!festivalIds.has(nomination.festivalId)) {
      issues.push(`[nominations][id=${nomination.id}] festivalId "${nomination.festivalId}" does not resolve to a Festival`);
    }
    if (!ceremonyIds.has(nomination.ceremonyId)) {
      issues.push(`[nominations][id=${nomination.id}] ceremonyId "${nomination.ceremonyId}" does not resolve to a Ceremony`);
    }
    if (!categoryIds.has(nomination.categoryId)) {
      issues.push(`[nominations][id=${nomination.id}] categoryId "${nomination.categoryId}" does not resolve to a Category`);
    }
    if (!filmIds.has(nomination.filmId)) {
      issues.push(`[nominations][id=${nomination.id}] filmId "${nomination.filmId}" does not resolve to a Film`);
    }
    for (const directorId of nomination.directorIds ?? []) {
      if (!personIds.has(directorId)) {
        issues.push(`[nominations][id=${nomination.id}] directorIds entry "${directorId}" does not resolve to a Person`);
      }
    }
  }

  return issues;
}

// A separate, opt-in quality gate — never part of schema validity. FilmSchema
// deliberately allows empty posterUrl/synopsis/genres and runtimeMinutes: 0
// (see ARCHITECTURE.md's Extensibility section on historical data holes), so
// validateEntities can never fail on a metadata-hollow catalogue. --strict
// gives CI/local runs an opt-in way to catch a completeness regression
// without tightening the schema for every consumer.
// Thresholds are intentionally modest starting points, not a target — the
// point is catching a regression (e.g. a merge that wipes enrichment, see
// scripts/enrich-tmdb.mjs's cache), not enforcing a finished catalogue.
// Raise them over time as real coverage improves.
export const DEFAULT_QUALITY_THRESHOLDS = {
  imdbCoveragePct: 20,
  posterCoveragePct: 15,
  runtimeCoveragePct: 15,
  genresCoveragePct: 10,
  synopsisCoveragePct: 10
};

export function computeOverallQualityStats(films) {
  const total = films?.length ?? 0;
  const pct = (count) => (total ? Math.round((count / total) * 1000) / 10 : 0);

  let withImdb = 0;
  let withPoster = 0;
  let withRuntime = 0;
  let withGenres = 0;
  let withSynopsis = 0;

  for (const film of films ?? []) {
    if (film.imdbId) withImdb += 1;
    if (film.posterUrl) withPoster += 1;
    if (film.runtimeMinutes) withRuntime += 1;
    if (film.genres?.length) withGenres += 1;
    if (film.synopsis) withSynopsis += 1;
  }

  return {
    total,
    imdbCoveragePct: pct(withImdb),
    posterCoveragePct: pct(withPoster),
    runtimeCoveragePct: pct(withRuntime),
    genresCoveragePct: pct(withGenres),
    synopsisCoveragePct: pct(withSynopsis)
  };
}

export function checkQualityThresholds(stats, thresholds = DEFAULT_QUALITY_THRESHOLDS) {
  const issues = [];
  for (const [metric, minPct] of Object.entries(thresholds)) {
    const actual = stats[metric];
    if (typeof actual === "number" && actual < minPct) {
      issues.push(`[quality] ${metric} is ${actual}%, below the required ${minPct}%`);
    }
  }
  return issues;
}

// Every Category record's isAward is set from data/source/category-
// classifications.json — a curated record of a real semantic review (see
// scripts/lib/generate-category-classifications.mjs), never a keyword
// guess. A category with no entry there conservatively defaults to
// isAward: false (see build-comprehensive-data.mjs), which is schema-valid
// and therefore invisible to validateEntities/checkReferentialIntegrity —
// this check is what actually surfaces it, so an unreviewed category never
// silently sits at "excluded" (or, if the default ever changed, "included")
// forever without anyone noticing there was a decision to make.
export function checkCategoryClassificationCoverage(categories, classifications) {
  const classified = new Set((classifications ?? []).map((entry) => `${entry.festivalId}|${entry.category}`));
  const unclassified = [];
  for (const category of categories ?? []) {
    const key = `${category.festivalId}|${category.name}`;
    if (!classified.has(key)) {
      unclassified.push(`[${category.festivalId}] "${category.name}"`);
    }
  }
  return unclassified;
}

async function loadEntities() {
  const entities = {};
  for (const { key, file } of ENTITY_FILES) {
    const raw = await readFile(path.join(normalizedDir, file), "utf8");
    entities[key] = JSON.parse(raw);
  }
  return entities;
}

async function run() {
  logStep("Starting validate-data");
  const strict = process.argv.includes("--strict");

  const entities = await loadEntities();
  const schemaIssues = validateEntities(entities);
  const referentialIssues = checkReferentialIntegrity(entities);
  const issues = [...schemaIssues, ...referentialIssues];

  if (strict) {
    const qualityStats = computeOverallQualityStats(entities.films);
    const qualityIssues = checkQualityThresholds(qualityStats);
    issues.push(...qualityIssues);
    console.log(`[--strict] catalogue quality: ${JSON.stringify(qualityStats)}`);
  }

  // Warning-only, not a hard failure: an unclassified category defaults to
  // isAward: false (schema-valid), so it can't fail validateEntities or
  // checkReferentialIntegrity — this is purely visibility so it doesn't sit
  // unnoticed.
  if (existsSync(categoryClassificationsPath)) {
    const classificationsRaw = JSON.parse(await readFile(categoryClassificationsPath, "utf8"));
    const unclassified = checkCategoryClassificationCoverage(entities.categories, classificationsRaw.classifications);
    if (unclassified.length > 0) {
      console.warn(`${unclassified.length} categor${unclassified.length === 1 ? "y has" : "ies have"} no entry in category-classifications.json (defaulted to isAward: false, isHonoraryAward: false):`);
      for (const entry of unclassified) {
        console.warn(`  - ${entry}`);
      }
    }
  }

  if (issues.length === 0) {
    logStep("Data validation passed: all normalized files conform to schema and pass referential integrity checks.");
    return;
  }

  console.error(`Data validation failed with ${issues.length} issue(s):`);
  for (const issue of issues) {
    console.error(`  - ${issue}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Data validation crashed", error);
    process.exitCode = 1;
  });
}
