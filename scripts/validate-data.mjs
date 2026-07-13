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
  const entities = await loadEntities();
  const schemaIssues = validateEntities(entities);
  const referentialIssues = checkReferentialIntegrity(entities);
  const issues = [...schemaIssues, ...referentialIssues];

  // Warning-only, not a hard failure: an unclassified category defaults to
  // isAward: false (schema-valid), so it can't fail validateEntities or
  // checkReferentialIntegrity — this is purely visibility so it doesn't sit
  // unnoticed.
  if (existsSync(categoryClassificationsPath)) {
    const classificationsRaw = JSON.parse(await readFile(categoryClassificationsPath, "utf8"));
    const unclassified = checkCategoryClassificationCoverage(entities.categories, classificationsRaw.classifications);
    if (unclassified.length > 0) {
      console.warn(`${unclassified.length} categor${unclassified.length === 1 ? "y has" : "ies have"} no entry in category-classifications.json (defaulted to isAward: false):`);
      for (const entry of unclassified) {
        console.warn(`  - ${entry}`);
      }
    }
  }

  if (issues.length === 0) {
    console.log("Data validation passed: all normalized files conform to schema and pass referential integrity checks.");
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
