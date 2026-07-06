import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const masterPath = path.join(root, "data", "source", "master-data.json");
const wikidataPath = path.join(root, "data", "source", "wikidata-awards.json");
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

  const outputRecords = [];
  const index = new Map();

  for (const base of master.records ?? []) {
    const normalized = normalizeRecord(base);
    const key = buildRecordKey(normalized);
    index.set(key, outputRecords.length);
    outputRecords.push(normalized);
  }

  for (const candidate of wikidataRecords) {
    const normalized = normalizeRecord(candidate);
    const key = buildRecordKey(normalized);

    const existingIndex = index.get(key);
    if (existingIndex === undefined) {
      index.set(key, outputRecords.length);
      outputRecords.push(normalized);
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
        merged: outputRecords.length
      }
    }
  };

  await writeFile(mergedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Merged sources. seed=${payload.metadata.sourceCounts.seed}, wikidata=${payload.metadata.sourceCounts.wikidata}, merged=${payload.metadata.sourceCounts.merged}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error("Failed to merge sources", error);
    process.exitCode = 1;
  });
}
