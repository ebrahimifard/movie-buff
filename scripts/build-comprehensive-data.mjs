import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const generatedSourcePath = path.join(root, "data", "source", "master-data.generated.json");
const seedSourcePath = path.join(root, "data", "source", "master-data.json");
const categoryClassificationsPath = path.join(root, "data", "source", "category-classifications.json");
const normalizedDir = path.join(root, "data", "normalized");

// Builds a `${festivalId}|${category}` -> isAward lookup from
// data/source/category-classifications.json — a curated record of a real
// semantic review of every category value (see
// scripts/lib/generate-category-classifications.mjs), not a keyword/regex
// classifier. A pair with no entry (a brand-new category from a future
// re-scrape nobody has reviewed yet) is intentionally NOT defaulted to true
// here — resolveCategoryIsAward returns undefined for it, and the caller
// treats that as "unclassified", conservatively excluding it from the
// Category filter until a human/AI reviews it. See
// scripts/validate-data.mjs's classification-coverage check, which is what
// actually surfaces an unclassified pair instead of it staying silently
// hidden forever.
export function buildCategoryClassificationLookup(classifications) {
  const map = new Map();
  for (const entry of classifications ?? []) {
    map.set(`${entry.festivalId}|${entry.category}`, entry.isAward);
  }
  return map;
}

export function resolveCategoryIsAward(lookup, festivalId, category) {
  return lookup.get(`${festivalId}|${category}`);
}

export function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function uniqueSorted(items) {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}

// Films without an imdbId would otherwise all collide on a `null` key in
// `filmMap`, silently overwriting one another (e.g. "Grand Bouquet", Cannes
// 2019). Fall back to a deterministic synthetic id derived from title+year.
// Two distinct films sharing both an identical title and release year would
// still collide under this fallback; resolving that fully requires a real
// external id.
export function resolveFilmId(film) {
  if (film.imdbId) {
    return film.imdbId;
  }
  return `film:${slugify(`${film.title}-${film.releaseYear}`)}`;
}

// Gets-or-creates a Person record, merging `role` into an existing person's
// roles rather than skipping the update — a person can legitimately be
// credited under different roles across different records (e.g. an
// actor-director), and re-adding them as director-only must not clobber a
// previously-recorded cast credit, or vice versa.
export function resolvePersonId(personMap, name, role) {
  const personId = `person:${slugify(name)}`;
  const existing = personMap.get(personId);
  if (existing) {
    if (!existing.roles.includes(role)) {
      existing.roles = [...existing.roles, role].sort();
    }
    return personId;
  }
  personMap.set(personId, { id: personId, name, roles: [role], imdbId: null, tmdbId: null });
  return personId;
}

async function writeJson(relativePath, value) {
  const filePath = path.join(normalizedDir, relativePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function run() {
  const selectedSourcePath = existsSync(generatedSourcePath) ? generatedSourcePath : seedSourcePath;
  const sourceRaw = await readFile(selectedSourcePath, "utf8");
  const source = JSON.parse(sourceRaw);

  const classificationsRaw = existsSync(categoryClassificationsPath) ? await readFile(categoryClassificationsPath, "utf8") : null;
  const categoryLookup = buildCategoryClassificationLookup(classificationsRaw ? JSON.parse(classificationsRaw).classifications : []);
  const unclassifiedCategories = new Set();

  const festivals = source.festivals
    .map((festival) => ({
      ...festival,
      website: null
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const filmMap = new Map();
  const personMap = new Map();
  const categoryMap = new Map();
  const ceremonyMap = new Map();
  const nominations = [];

  for (const entry of source.records) {
    const filmId = resolveFilmId(entry.film);
    if (!filmMap.has(filmId)) {
      filmMap.set(filmId, {
        id: filmId,
        title: entry.film.title,
        releaseYear: entry.film.releaseYear,
        imdbId: entry.film.imdbId,
        posterUrl: entry.film.posterUrl,
        runtimeMinutes: entry.film.runtimeMinutes,
        countryCodes: entry.film.countryCodes,
        languages: entry.film.languages,
        genres: entry.film.genres,
        synopsis: entry.film.synopsis
      });
    }

    const ceremonyId = `${entry.festivalId}-${entry.year}`;
    if (!ceremonyMap.has(ceremonyId)) {
      ceremonyMap.set(ceremonyId, {
        id: ceremonyId,
        festivalId: entry.festivalId,
        year: entry.year,
        edition: null,
        startDate: null,
        endDate: null
      });
    }

    const categoryId = `${entry.festivalId}:${slugify(entry.category)}`;
    if (!categoryMap.has(categoryId)) {
      const isAward = resolveCategoryIsAward(categoryLookup, entry.festivalId, entry.category);
      if (isAward === undefined) {
        unclassifiedCategories.add(`${entry.festivalId}|${entry.category}`);
      }
      categoryMap.set(categoryId, {
        id: categoryId,
        festivalId: entry.festivalId,
        name: entry.category,
        normalizedName: slugify(entry.category),
        scope: "film",
        // Conservative default for an unclassified pair — see
        // buildCategoryClassificationLookup's comment above. Never true by
        // accident: an unreviewed category simply doesn't show up as a
        // Category filter option until someone classifies it.
        isAward: isAward ?? false
      });
    }

    const directorNames = uniqueSorted(entry.directors);
    const directorIds = directorNames.map((name) => resolvePersonId(personMap, name, "director"));

    // entry.credits (populated by the Wikipedia scrapers for individual-award
    // categories like Best Actor/Screenplay — see classifyPersonRole in
    // scripts/lib/wikipedia-scrape.mjs) carries the credited person as
    // metadata on the FILM's nomination record, never as the nomination's
    // own title/identity — see Nomination.credits in lib/schemas.mjs.
    const credits = (entry.credits ?? [])
      .filter((credit) => credit?.name && credit?.role)
      .map(({ name, role }) => ({ personId: resolvePersonId(personMap, name, role), role }));

    nominations.push({
      id: `${entry.year}-${entry.festivalId}-${slugify(entry.category)}-${filmId}`,
      year: entry.year,
      festivalId: entry.festivalId,
      festivalName: festivals.find((festival) => festival.id === entry.festivalId)?.name ?? entry.festivalId,
      ceremonyId,
      categoryId,
      category: entry.category,
      title: entry.film.title,
      director: directorNames.join(", "),
      directorIds,
      country: entry.film.countryCodes[0] ?? "XX",
      result: entry.result,
      imdbId: entry.film.imdbId,
      filmId,
      ...(credits.length > 0 ? { credits } : {})
    });
  }

  const films = [...filmMap.values()].sort((a, b) => b.releaseYear - a.releaseYear || a.title.localeCompare(b.title));
  const people = [...personMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const categories = [...categoryMap.values()].sort((a, b) => a.festivalId.localeCompare(b.festivalId) || a.name.localeCompare(b.name));
  const ceremonies = [...ceremonyMap.values()].sort((a, b) => b.year - a.year || a.festivalId.localeCompare(b.festivalId));
  const sortedNominations = nominations.sort((a, b) => b.year - a.year || a.festivalId.localeCompare(b.festivalId) || a.id.localeCompare(b.id));

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourcePath: path.relative(root, selectedSourcePath),
    stats: {
      festivals: festivals.length,
      ceremonies: ceremonies.length,
      categories: categories.length,
      films: films.length,
      people: people.length,
      nominations: sortedNominations.length
    }
  };

  await Promise.all([
    writeJson("festivals.json", festivals),
    writeJson("films.json", films),
    writeJson("people.json", people),
    writeJson("categories.json", categories),
    writeJson("ceremonies.json", ceremonies),
    writeJson("nominations.json", sortedNominations),
    writeJson("manifest.json", manifest)
  ]);

  console.log("Comprehensive normalized dataset generated.");
  console.log(JSON.stringify(manifest.stats, null, 2));

  if (unclassifiedCategories.size > 0) {
    console.warn(
      `${unclassifiedCategories.size} category value(s) have no entry in data/source/category-classifications.json and were conservatively excluded from the Category filter (isAward: false). Run scripts/validate-data.mjs for the full list, then classify each one by its actual meaning — never by keyword.`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Failed to build comprehensive data", error);
    process.exitCode = 1;
  });
}
