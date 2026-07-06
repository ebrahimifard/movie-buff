import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const generatedPath = path.join(root, "data", "source", "master-data.generated.json");

function chunk(items, size) {
  const list = [];
  for (let index = 0; index < items.length; index += size) {
    list.push(items.slice(index, index + size));
  }
  return list;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`TMDB request failed: ${response.status} ${url}`);
  }

  return response.json();
}

function toIsoCountryCodes(productionCountries) {
  if (!Array.isArray(productionCountries)) {
    return [];
  }
  return [...new Set(productionCountries.map((item) => item?.iso_3166_1).filter(Boolean))];
}

function toLanguages(spokenLanguages) {
  if (!Array.isArray(spokenLanguages)) {
    return [];
  }
  return [...new Set(spokenLanguages.map((item) => item?.english_name || item?.name).filter(Boolean))];
}

function toGenres(genres) {
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

  const findPayload = await fetchJson(findUrl);
  const movie = findPayload?.movie_results?.[0];
  if (!movie?.id) {
    return record;
  }

  const detailsUrl = new URL(`https://api.themoviedb.org/3/movie/${movie.id}`);
  detailsUrl.searchParams.set("api_key", apiKey);

  const details = await fetchJson(detailsUrl);
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

// KNOWN LIMITATION: unlike fetch-wikidata-awards.mjs, this script has no
// retry/backoff, and a single failed lookup inside enrichRecord() throws and
// aborts the entire Promise.all chunk before any output is written (output is
// only persisted once, at the very end of run()). collect-data.mjs treats this
// script as "optional" and continues the pipeline on failure, but a partial
// run's enrichment progress is discarded rather than saved incrementally.
// Deferred: fixing this is data-completeness/pipeline-resilience work, out of
// scope for this hardening pass.
async function run() {
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

  for (const group of chunk(imdbUnique, 5)) {
    await Promise.all(
      group.map(async (imdbId) => {
        const matching = records.find((record) => record?.film?.imdbId === imdbId);
        if (!matching) {
          return;
        }
        const enriched = await enrichRecord(matching, apiKey);
        imdbLookup.set(imdbId, enriched.film);
      })
    );
  }

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

  const enrichedPayload = {
    ...payload,
    records: enrichedRecords,
    metadata: {
      ...(payload.metadata ?? {}),
      tmdbEnrichedAt: new Date().toISOString(),
      tmdbEnrichedFilms: imdbLookup.size
    }
  };

  await writeFile(generatedPath, `${JSON.stringify(enrichedPayload, null, 2)}\n`, "utf8");
  console.log(`TMDB enrichment complete for ${imdbLookup.size} films.`);
}

run().catch((error) => {
  console.error("TMDB enrichment failed", error);
  process.exitCode = 1;
});
