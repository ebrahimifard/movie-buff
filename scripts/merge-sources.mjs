import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const masterPath = path.join(root, "data", "source", "master-data.json");
const wikidataPath = path.join(root, "data", "source", "wikidata-awards.json");
const cannesWikipediaPath = path.join(root, "data", "source", "cannes-wikipedia.json");
const goldenGlobesWikipediaPath = path.join(root, "data", "source", "golden-globes-wikipedia.json");
const baftaWikipediaPath = path.join(root, "data", "source", "bafta-wikipedia.json");
const mergedPath = path.join(root, "data", "source", "master-data.generated.json");

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
    directors: [...new Set((input.directors ?? []).filter(Boolean))]
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
      directors: [...new Set([...(existing.directors ?? []), ...(normalized.directors ?? [])])]
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

  const cannesWikipediaRecords = await readOptionalWikipediaSource(cannesWikipediaPath);
  const goldenGlobesWikipediaRecords = await readOptionalWikipediaSource(goldenGlobesWikipediaPath);
  const baftaWikipediaRecords = await readOptionalWikipediaSource(baftaWikipediaPath);

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
  mergeCandidatesInto(outputRecords, primaryIndex, titleIndex, cannesWikipediaRecords);
  mergeCandidatesInto(outputRecords, primaryIndex, titleIndex, goldenGlobesWikipediaRecords);
  mergeCandidatesInto(outputRecords, primaryIndex, titleIndex, baftaWikipediaRecords);

  outputRecords.sort((a, b) => {
    if (a.year !== b.year) {
      return b.year - a.year;
    }
    const left = `${a.festivalId}:${a.category}:${a.film.title}`;
    const right = `${b.festivalId}:${b.category}:${b.film.title}`;
    return left.localeCompare(right);
  });

  const payload = {
    festivals: master.festivals,
    records: outputRecords,
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceCounts: {
        seed: master.records?.length ?? 0,
        wikidata: wikidataRecords.length,
        cannesWikipedia: cannesWikipediaRecords.length,
        goldenGlobesWikipedia: goldenGlobesWikipediaRecords.length,
        baftaWikipedia: baftaWikipediaRecords.length,
        merged: outputRecords.length
      }
    }
  };

  await writeFile(mergedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `Merged sources. seed=${payload.metadata.sourceCounts.seed}, wikidata=${payload.metadata.sourceCounts.wikidata}, ` +
      `cannesWikipedia=${payload.metadata.sourceCounts.cannesWikipedia}, goldenGlobesWikipedia=${payload.metadata.sourceCounts.goldenGlobesWikipedia}, ` +
      `baftaWikipedia=${payload.metadata.sourceCounts.baftaWikipedia}, merged=${payload.metadata.sourceCounts.merged}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Failed to merge sources", error);
    process.exitCode = 1;
  });
}
