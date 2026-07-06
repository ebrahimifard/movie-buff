import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const generatedSourcePath = path.join(root, "data", "source", "master-data.generated.json");
const seedSourcePath = path.join(root, "data", "source", "master-data.json");
const normalizedDir = path.join(root, "data", "normalized");

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

async function writeJson(relativePath, value) {
  const filePath = path.join(normalizedDir, relativePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function run() {
  const selectedSourcePath = existsSync(generatedSourcePath) ? generatedSourcePath : seedSourcePath;
  const sourceRaw = await readFile(selectedSourcePath, "utf8");
  const source = JSON.parse(sourceRaw);

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
      categoryMap.set(categoryId, {
        id: categoryId,
        festivalId: entry.festivalId,
        name: entry.category,
        normalizedName: slugify(entry.category),
        scope: "film"
      });
    }

    const directorNames = uniqueSorted(entry.directors);
    const directorIds = directorNames.map((name) => {
      const personId = `person:${slugify(name)}`;
      if (!personMap.has(personId)) {
        personMap.set(personId, {
          id: personId,
          name,
          roles: ["director"],
          imdbId: null,
          tmdbId: null
        });
      }
      return personId;
    });

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
      filmId
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Failed to build comprehensive data", error);
    process.exitCode = 1;
  });
}
