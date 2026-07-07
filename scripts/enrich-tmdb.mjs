import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fetchWithRetry } from "./lib/http.mjs";
import { loadLocalEnv } from "./lib/env.mjs";

const root = process.cwd();
const generatedPath = path.join(root, "data", "source", "master-data.generated.json");

export function chunk(items, size) {
  const list = [];
  for (let index = 0; index < items.length; index += size) {
    list.push(items.slice(index, index + size));
  }
  return list;
}

async function fetchJson(url, label) {
  const response = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, label);
  return response.json();
}

export function toIsoCountryCodes(productionCountries) {
  if (!Array.isArray(productionCountries)) {
    return [];
  }
  return [...new Set(productionCountries.map((item) => item?.iso_3166_1).filter(Boolean))];
}

export function toLanguages(spokenLanguages) {
  if (!Array.isArray(spokenLanguages)) {
    return [];
  }
  return [...new Set(spokenLanguages.map((item) => item?.english_name || item?.name).filter(Boolean))];
}

export function toGenres(genres) {
  if (!Array.isArray(genres)) {
    return [];
  }
  return [...new Set(genres.map((item) => item?.name).filter(Boolean))];
}

async function enrichRecord(record, apiKey) {
  const imdbId = record?.film?.imdbId;
  if (!imdbId) {
    return record;
  }

  const findUrl = new URL(`https://api.themoviedb.org/3/find/${imdbId}`);
  findUrl.searchParams.set("api_key", apiKey);
  findUrl.searchParams.set("external_source", "imdb_id");

  const findPayload = await fetchJson(findUrl, `TMDB find ${imdbId}`);
  const movie = findPayload?.movie_results?.[0];
  if (!movie?.id) {
    return record;
  }

  const detailsUrl = new URL(`https://api.themoviedb.org/3/movie/${movie.id}`);
  detailsUrl.searchParams.set("api_key", apiKey);

  const details = await fetchJson(detailsUrl, `TMDB movie ${movie.id}`);
  const posterPath = details?.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : "";

  return {
    ...record,
    film: {
      ...record.film,
      posterUrl: record.film.posterUrl || posterPath,
      runtimeMinutes: record.film.runtimeMinutes || details.runtime || 0,
      releaseYear: record.film.releaseYear || Number(String(details.release_date || "").slice(0, 4)) || record.year,
      countryCodes: record.film.countryCodes?.length ? record.film.countryCodes : toIsoCountryCodes(details.production_countries),
      languages: record.film.languages?.length ? record.film.languages : toLanguages(details.spoken_languages),
      genres: record.film.genres?.length ? record.film.genres : toGenres(details.genres),
      synopsis: record.film.synopsis || details.overview || ""
    }
  };
}

// Pure re-assembly of the output payload from the current enrichment state,
// so it can be called after every chunk (incremental persistence) as well as
// once at the end, without duplicating the overlay/metadata logic.
export function buildEnrichedPayload(payload, records, imdbLookup, failures) {
  const enrichedRecords = records.map((record) => {
    const imdbId = record?.film?.imdbId;
    if (!imdbId || !imdbLookup.has(imdbId)) {
      return record;
    }
    return {
      ...record,
      film: imdbLookup.get(imdbId)
    };
  });

  return {
    ...payload,
    records: enrichedRecords,
    metadata: {
      ...(payload.metadata ?? {}),
      tmdbEnrichedAt: new Date().toISOString(),
      tmdbEnrichedFilms: imdbLookup.size,
      tmdbFailures: failures.length
    }
  };
}

async function run() {
  loadLocalEnv();
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    console.log("TMDB_API_KEY is not set; skipping TMDB enrichment.");
    return;
  }

  const raw = await readFile(generatedPath, "utf8");
  const payload = JSON.parse(raw);
  const records = payload.records ?? [];

  const imdbUnique = [...new Set(records.map((record) => record?.film?.imdbId).filter(Boolean))];
  const imdbLookup = new Map();
  const failures = [];

  for (const group of chunk(imdbUnique, 5)) {
    await Promise.all(
      group.map(async (imdbId) => {
        const matching = records.find((record) => record?.film?.imdbId === imdbId);
        if (!matching) {
          return;
        }
        try {
          const enriched = await enrichRecord(matching, apiKey);
          imdbLookup.set(imdbId, enriched.film);
        } catch (error) {
          failures.push({ imdbId, message: error instanceof Error ? error.message : String(error) });
          console.warn(`[WARN] TMDB enrichment failed for ${imdbId}:`, error);
        }
      })
    );

    // Persist after every chunk so a later failure only risks the current
    // chunk's progress (at most 5 records), not the entire run's.
    const enrichedPayload = buildEnrichedPayload(payload, records, imdbLookup, failures);
    await writeFile(generatedPath, `${JSON.stringify(enrichedPayload, null, 2)}\n`, "utf8");
  }

  console.log(`TMDB enrichment complete for ${imdbLookup.size} films. failures=${failures.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("TMDB enrichment failed", error);
    process.exitCode = 1;
  });
}
