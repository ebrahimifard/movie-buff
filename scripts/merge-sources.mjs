import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const masterPath = path.join(root, "data", "source", "master-data.json");
const wikidataPath = path.join(root, "data", "source", "wikidata-awards.json");
const mergedPath = path.join(root, "data", "source", "master-data.generated.json");

// Each optional Wikipedia source is merged after Wikidata, in this order.
// Adding a new festival's scraper output is a one-line addition here — no
// other change to run()'s merge sequence is needed. Order among these does
// not affect correctness (non-overlapping festivalIds), only matters for
// preserving existing merge-precedence/test expectations for the first 3.
export const WIKIPEDIA_SOURCES = [
  { sourceId: "cannesWikipedia", filePath: path.join(root, "data", "source", "cannes-wikipedia.json") },
  { sourceId: "goldenGlobesWikipedia", filePath: path.join(root, "data", "source", "golden-globes-wikipedia.json") },
  { sourceId: "baftaWikipedia", filePath: path.join(root, "data", "source", "bafta-wikipedia.json") },
  { sourceId: "berlinaleWikipedia", filePath: path.join(root, "data", "source", "berlinale-wikipedia.json") },
  { sourceId: "veniceWikipedia", filePath: path.join(root, "data", "source", "venice-wikipedia.json") }
];

export function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function mergeFilm(primary, secondary) {
  return {
    title: primary.title || secondary.title,
    releaseYear: primary.releaseYear || secondary.releaseYear,
    imdbId: primary.imdbId || secondary.imdbId || null,
    runtimeMinutes: primary.runtimeMinutes || secondary.runtimeMinutes || 0,
    countryCodes: primary.countryCodes?.length ? primary.countryCodes : secondary.countryCodes || [],
    languages: primary.languages?.length ? primary.languages : secondary.languages || [],
    genres: primary.genres?.length ? primary.genres : secondary.genres || [],
    synopsis: primary.synopsis || secondary.synopsis || "",
    posterUrl: primary.posterUrl || secondary.posterUrl || ""
  };
}

// Credits are {name, role} objects (not primitives), so a plain Set can't
// dedupe them — a composite name+role key is used instead. A person can
// legitimately hold more than one role across categories (e.g. an
// actor-director), so role is part of the identity, not dropped.
export function dedupeCredits(credits) {
  const seen = new Set();
  const result = [];
  for (const credit of credits ?? []) {
    if (!credit?.name || !credit?.role) {
      continue;
    }
    const key = `${credit.name}|${credit.role}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ name: credit.name, role: credit.role });
  }
  return result;
}

export function normalizeRecord(input) {
  return {
    year: input.year,
    festivalId: input.festivalId,
    category: input.category,
    result: input.result,
    film: {
      title: input.film.title,
      releaseYear: input.film.releaseYear,
      imdbId: input.film.imdbId,
      runtimeMinutes: input.film.runtimeMinutes ?? 0,
      countryCodes: input.film.countryCodes ?? [],
      languages: input.film.languages ?? [],
      genres: input.film.genres ?? [],
      synopsis: input.film.synopsis ?? "",
      posterUrl: input.film.posterUrl ?? ""
    },
    directors: [...new Set((input.directors ?? []).filter(Boolean))],
    credits: dedupeCredits(input.credits)
  };
}

export function chooseResult(left, right) {
  if (left === "winner" || right === "winner") {
    return "winner";
  }
  return left || right || "nominee";
}

export function buildRecordKey(record) {
  return [
    record.festivalId,
    record.year,
    record.category,
    record.film.imdbId ?? slugify(record.film.title)
  ].join("|");
}

// A record's primary key uses its imdbId when present, else falls back to a
// slugified title (see buildRecordKey). Wikipedia-sourced candidates never
// carry an imdbId, so their primary key is always the title-slug variant —
// which won't match an existing seed/Wikidata record for the same film that
// DOES have an imdbId. buildSlugKey ignores imdbId entirely so it can be used
// as a secondary lookup for exactly that cross-source case.
export function buildSlugKey(record) {
  return [record.festivalId, record.year, record.category, slugify(record.film.title)].join("|");
}

// Cannes/Golden Globes scrapers write a bare array; BAFTA's writes
// { generatedAt, records }. Accept either shape uniformly.
export function normalizeWikipediaPayload(raw) {
  return Array.isArray(raw) ? raw : raw?.records ?? [];
}

// Merges `candidates` into `outputRecords`, using `primaryIndex` (keyed by
// buildRecordKey) as the fast path and falling back to `titleIndex` (keyed by
// buildSlugKey) only for candidates that lack an imdbId. The imdbId gate on
// the fallback is deliberate: an imdbId-bearing candidate that misses the
// primary index must never be fuzzy-matched by title alone, since that could
// silently merge two distinct films that happen to share a title (remakes,
// same-title-different-year). imdbId identity always takes precedence when
// present. Mutates outputRecords/primaryIndex/titleIndex in place.
export function mergeCandidatesInto(outputRecords, primaryIndex, titleIndex, candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeRecord(candidate);
    const primaryKey = buildRecordKey(normalized);

    let existingIndex = primaryIndex.get(primaryKey);
    if (existingIndex === undefined && !normalized.film.imdbId) {
      existingIndex = titleIndex.get(buildSlugKey(normalized));
    }

    if (existingIndex === undefined) {
      existingIndex = outputRecords.length;
      outputRecords.push(normalized);
      primaryIndex.set(primaryKey, existingIndex);
      titleIndex.set(buildSlugKey(normalized), existingIndex);
      continue;
    }

    const existing = outputRecords[existingIndex];
    outputRecords[existingIndex] = {
      ...existing,
      result: chooseResult(existing.result, normalized.result),
      film: mergeFilm(existing.film, normalized.film),
      directors: [...new Set([...(existing.directors ?? []), ...(normalized.directors ?? [])])],
      credits: dedupeCredits([...(existing.credits ?? []), ...(normalized.credits ?? [])])
    };
  }

  return outputRecords;
}

async function readOptionalWikipediaSource(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  return normalizeWikipediaPayload(raw);
}

async function run() {
  const masterRaw = await readFile(masterPath, "utf8");
  const master = JSON.parse(masterRaw);

  let wikidataRecords = [];
  try {
    const wikidataRaw = await readFile(wikidataPath, "utf8");
    const wikidata = JSON.parse(wikidataRaw);
    wikidataRecords = wikidata.records ?? [];
  } catch {
    wikidataRecords = [];
  }

  const wikipediaSources = [];
  for (const { sourceId, filePath } of WIKIPEDIA_SOURCES) {
    wikipediaSources.push({ sourceId, records: await readOptionalWikipediaSource(filePath) });
  }

  const outputRecords = [];
  const primaryIndex = new Map();
  const titleIndex = new Map();

  for (const base of master.records ?? []) {
    const normalized = normalizeRecord(base);
    primaryIndex.set(buildRecordKey(normalized), outputRecords.length);
    titleIndex.set(buildSlugKey(normalized), outputRecords.length);
    outputRecords.push(normalized);
  }

  mergeCandidatesInto(outputRecords, primaryIndex, titleIndex, wikidataRecords);
  for (const { records } of wikipediaSources) {
    mergeCandidatesInto(outputRecords, primaryIndex, titleIndex, records);
  }

  outputRecords.sort((a, b) => {
    if (a.year !== b.year) {
      return b.year - a.year;
    }
    const left = `${a.festivalId}:${a.category}:${a.film.title}`;
    const right = `${b.festivalId}:${b.category}:${b.film.title}`;
    return left.localeCompare(right);
  });

  const sourceCounts = {
    seed: master.records?.length ?? 0,
    wikidata: wikidataRecords.length,
    ...Object.fromEntries(wikipediaSources.map(({ sourceId, records }) => [sourceId, records.length])),
    merged: outputRecords.length
  };

  const payload = {
    festivals: master.festivals,
    records: outputRecords,
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceCounts
    }
  };

  await writeFile(mergedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Merged sources. ${Object.entries(sourceCounts).map(([key, value]) => `${key}=${value}`).join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Failed to merge sources", error);
    process.exitCode = 1;
  });
}
