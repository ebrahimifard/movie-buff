import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fetchWithRetry } from "./lib/http.mjs";
import { loadLocalEnv } from "./lib/env.mjs";
import { logStep } from "./lib/log.mjs";
import { IMDB_ID_PATTERN } from "../lib/schemas.mjs";

const root = process.cwd();
const generatedPath = path.join(root, "data", "source", "master-data.generated.json");
const cachePath = path.join(root, "data", "source", "tmdb-cache.json");

// TMDB enrichment lives in a standalone, additive cache keyed by imdbId (and,
// for records with no imdbId, by titleYearFallbackKey) — never inside
// master-data.generated.json. merge-sources.mjs rebuilds that generated file
// from scratch from raw sources on every run, which would otherwise wipe any
// enrichment written directly into it. Keeping the cache separate means a
// re-run of merge can never lose previously fetched TMDB data: run() always
// re-applies the full cache onto the freshly merged records (see below).
export async function loadTmdbCache(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      byImdbId: new Map(Object.entries(parsed.byImdbId ?? {})),
      byTitleYear: new Map(Object.entries(parsed.byTitleYear ?? {}))
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { byImdbId: new Map(), byTitleYear: new Map() };
    }
    throw error;
  }
}

export function serializeTmdbCache(byImdbId, byTitleYear) {
  return {
    updatedAt: new Date().toISOString(),
    byImdbId: Object.fromEntries(byImdbId),
    byTitleYear: Object.fromEntries(byTitleYear)
  };
}

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

function normalizeTitleForMatch(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Wikipedia-sourced records (the majority of Cannes/BAFTA/Golden Globes/
// Berlinale/Venice) never carry an imdbId, so the primary /find/{imdbId}
// enrichment path (enrichRecord) always skips them — see enrichmentTargets
// in run(). This provides a fallback: search TMDB by title/year instead.
// Only accepted when the top matching result's title is a near-exact match
// AND its release year is within 1 of the expected year — a looser match is
// rejected outright rather than guessed, per the requirement to never
// silently attach the wrong film to a record. Returns null (no match) far
// more often than a fuzzy "best effort" matcher would, by design.
export function findConfidentMatch(results, title, year) {
  const targetTitle = normalizeTitleForMatch(title);
  if (!targetTitle) {
    return null;
  }
  for (const result of results ?? []) {
    const titleMatches = normalizeTitleForMatch(result?.title) === targetTitle;
    const originalTitleMatches = normalizeTitleForMatch(result?.original_title) === targetTitle;
    if (!titleMatches && !originalTitleMatches) {
      continue;
    }
    const resultYear = Number(String(result?.release_date ?? "").slice(0, 4));
    if (!year || !resultYear || Math.abs(resultYear - year) <= 1) {
      return result;
    }
  }
  return null;
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

// Title-year fallback records have no imdbId to key a lookup by, so they're
// matched via a synthetic composite key instead — see run()'s second pass.
export function titleYearFallbackKey(record) {
  return `${record?.festivalId}|${record?.year}|${normalizeTitleForMatch(record?.film?.title)}`;
}

async function enrichRecordByTitleYear(record, apiKey) {
  const title = record?.film?.title;
  if (!title) {
    return null;
  }
  const year = record.film.releaseYear || record.year;

  const searchUrl = new URL("https://api.themoviedb.org/3/search/movie");
  searchUrl.searchParams.set("api_key", apiKey);
  searchUrl.searchParams.set("query", title);
  if (year) {
    // primary_release_year (rather than year) matches only the film's
    // primary theatrical release, not any re-release/alternate regional
    // release TMDB also has on file — tighter for festival-year matching.
    searchUrl.searchParams.set("primary_release_year", String(year));
  }

  const searchPayload = await fetchJson(searchUrl, `TMDB search "${title}" (${year ?? "?"})`);
  const match = findConfidentMatch(searchPayload?.results, title, year);
  if (!match?.id) {
    return null;
  }

  const detailsUrl = new URL(`https://api.themoviedb.org/3/movie/${match.id}`);
  detailsUrl.searchParams.set("api_key", apiKey);
  detailsUrl.searchParams.set("append_to_response", "external_ids");

  const details = await fetchJson(detailsUrl, `TMDB movie ${match.id}`);
  const imdbId = details?.external_ids?.imdb_id;
  if (!imdbId || !IMDB_ID_PATTERN.test(imdbId)) {
    // Refuse to backfill a film record with no valid IMDb id — every
    // downstream feature (film detail page, poster download, "Details"
    // link) is keyed by imdbId, so a match without one isn't useful and
    // isn't confident enough to invent an id for.
    return null;
  }

  const posterPath = details?.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : "";

  return {
    ...record.film,
    imdbId,
    posterUrl: record.film.posterUrl || posterPath,
    runtimeMinutes: record.film.runtimeMinutes || details.runtime || 0,
    countryCodes: record.film.countryCodes?.length ? record.film.countryCodes : toIsoCountryCodes(details.production_countries),
    languages: record.film.languages?.length ? record.film.languages : toLanguages(details.spoken_languages),
    genres: record.film.genres?.length ? record.film.genres : toGenres(details.genres),
    synopsis: record.film.synopsis || details.overview || ""
  };
}

// Pure re-assembly of the output payload from the current enrichment state,
// so it can be called after every chunk (incremental persistence) as well as
// once at the end, without duplicating the overlay/metadata logic.
// `fallbackLookup` (keyed by titleYearFallbackKey) covers records that never
// had an imdbId to begin with — see run()'s second pass.
export function buildEnrichedPayload(payload, records, imdbLookup, failures, fallbackLookup = new Map()) {
  const enrichedRecords = records.map((record) => {
    const imdbId = record?.film?.imdbId;
    if (imdbId && imdbLookup.has(imdbId)) {
      return { ...record, film: imdbLookup.get(imdbId) };
    }
    if (!imdbId) {
      const fallbackKey = titleYearFallbackKey(record);
      if (fallbackLookup.has(fallbackKey)) {
        return { ...record, film: fallbackLookup.get(fallbackKey) };
      }
    }
    return record;
  });

  return {
    ...payload,
    records: enrichedRecords,
    metadata: {
      ...(payload.metadata ?? {}),
      tmdbEnrichedAt: new Date().toISOString(),
      tmdbEnrichedFilms: imdbLookup.size,
      tmdbFailures: failures.length,
      tmdbTitleYearMatched: fallbackLookup.size
    }
  };
}

async function run() {
  loadLocalEnv();
  const apiKey = process.env.TMDB_API_KEY;

  logStep("Starting TMDB enrichment");
  const raw = await readFile(generatedPath, "utf8");
  const payload = JSON.parse(raw);
  const records = payload.records ?? [];
  logStep(`Loaded ${records.length} records from ${path.relative(root, generatedPath)}`);

  const cache = await loadTmdbCache(cachePath);
  logStep(`Loaded TMDB cache: ${cache.byImdbId.size} by imdbId, ${cache.byTitleYear.size} by title/year`);
  // Seed the lookup maps from the cache so every run re-applies previously
  // fetched enrichment onto the (possibly just rebuilt) generated file, then
  // only fetch what isn't already cached.
  const imdbLookup = new Map(cache.byImdbId);
  const fallbackLookup = new Map(cache.byTitleYear);
  const failures = [];
  const titleYearFailures = [];

  // Apply whatever is already cached before doing any fetching — merge-
  // sources.mjs rebuilds this file from scratch on every run, so this is the
  // only thing that guarantees previously fetched enrichment survives even
  // when nothing new needs fetching this run (the loops below would
  // otherwise never write if imdbUnique/uniqueFallbackTargets end up empty).
  await writeFile(
    generatedPath,
    `${JSON.stringify(buildEnrichedPayload(payload, records, imdbLookup, failures, fallbackLookup), null, 2)}\n`,
    "utf8"
  );
  logStep("Re-applied cached enrichment onto the generated file");

  if (!apiKey) {
    console.log("TMDB_API_KEY is not set; re-applied cached TMDB enrichment only, skipped new lookups.");
    return;
  }

  // Built once up front (O(n)) rather than records.find() per lookup inside
  // the chunk loop (which was O(n) per call, O(n*m) overall across every
  // uncached imdbId) — cheaper on both CPU and the memory churn from
  // repeatedly scanning the full records array under memory pressure.
  const recordByImdbId = new Map();
  for (const record of records) {
    if (record?.film?.imdbId && !recordByImdbId.has(record.film.imdbId)) {
      recordByImdbId.set(record.film.imdbId, record);
    }
  }

  const imdbUnique = [...new Set(records.map((record) => record?.film?.imdbId).filter((imdbId) => imdbId && !imdbLookup.has(imdbId)))];
  const imdbChunks = chunk(imdbUnique, 5);
  logStep(`imdbId pass: ${imdbUnique.length} uncached film(s) to fetch across ${imdbChunks.length} chunk(s)`);

  let imdbChunkIndex = 0;
  for (const group of imdbChunks) {
    imdbChunkIndex += 1;
    await Promise.all(
      group.map(async (imdbId) => {
        const matching = recordByImdbId.get(imdbId);
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
    const enrichedPayload = buildEnrichedPayload(payload, records, imdbLookup, failures, fallbackLookup);
    await writeFile(generatedPath, `${JSON.stringify(enrichedPayload, null, 2)}\n`, "utf8");
    await writeFile(cachePath, `${JSON.stringify(serializeTmdbCache(imdbLookup, fallbackLookup), null, 2)}\n`, "utf8");
    logStep(`imdbId pass: chunk ${imdbChunkIndex}/${imdbChunks.length} done — enriched=${imdbLookup.size}, failures=${failures.length}`);
  }

  // Second pass: records with no imdbId at all (the majority of Cannes/
  // BAFTA/Golden Globes/Berlinale/Venice's Wikipedia-sourced records) never
  // reach enrichRecord above, since it requires an imdbId to call TMDB's
  // /find endpoint. Deduped by title+year+festival first — many nomination
  // records point at the same film across different categories, and this
  // avoids searching TMDB once per nomination instead of once per film.
  const noImdbRecords = records.filter((record) => !record?.film?.imdbId);
  const uniqueFallbackTargets = new Map();
  for (const record of noImdbRecords) {
    const key = titleYearFallbackKey(record);
    if (!fallbackLookup.has(key)) {
      uniqueFallbackTargets.set(key, record);
    }
  }

  const fallbackChunks = chunk([...uniqueFallbackTargets.values()], 5);
  logStep(`title/year pass: ${uniqueFallbackTargets.size} uncached film(s) to search across ${fallbackChunks.length} chunk(s)`);

  let fallbackChunkIndex = 0;
  for (const group of fallbackChunks) {
    fallbackChunkIndex += 1;
    await Promise.all(
      group.map(async (record) => {
        const key = titleYearFallbackKey(record);
        try {
          const enrichedFilm = await enrichRecordByTitleYear(record, apiKey);
          if (enrichedFilm) {
            fallbackLookup.set(key, enrichedFilm);
          } else {
            titleYearFailures.push({ title: record.film.title, year: record.year, reason: "no_confident_match" });
          }
        } catch (error) {
          titleYearFailures.push({ title: record.film.title, year: record.year, message: error instanceof Error ? error.message : String(error) });
          console.warn(`[WARN] TMDB title/year enrichment failed for "${record.film.title}" (${record.year}):`, error);
        }
      })
    );

    const enrichedPayload = buildEnrichedPayload(payload, records, imdbLookup, failures, fallbackLookup);
    await writeFile(generatedPath, `${JSON.stringify(enrichedPayload, null, 2)}\n`, "utf8");
    await writeFile(cachePath, `${JSON.stringify(serializeTmdbCache(imdbLookup, fallbackLookup), null, 2)}\n`, "utf8");
    logStep(`title/year pass: chunk ${fallbackChunkIndex}/${fallbackChunks.length} done — matched=${fallbackLookup.size}, unmatched=${titleYearFailures.length}`);
  }

  logStep(
    `TMDB enrichment complete for ${imdbLookup.size} films by imdbId, ${fallbackLookup.size} more by title/year match. ` +
      `failures=${failures.length}, title/year unmatched=${titleYearFailures.length} (left as-is, not guessed)`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("TMDB enrichment failed", error);
    process.exitCode = 1;
  });
}
