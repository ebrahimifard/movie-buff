import { describe, expect, it } from "vitest";
import { buildEnrichedPayload, chunk, toGenres, toIsoCountryCodes, toLanguages } from "./enrich-tmdb.mjs";

describe("chunk", () => {
  it("splits an array into groups of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunk([], 5)).toEqual([]);
  });
});

describe("toIsoCountryCodes", () => {
  it("extracts unique iso_3166_1 codes", () => {
    expect(toIsoCountryCodes([{ iso_3166_1: "US" }, { iso_3166_1: "US" }, { iso_3166_1: "FR" }])).toEqual(["US", "FR"]);
  });

  it("returns an empty array for non-array input", () => {
    expect(toIsoCountryCodes(undefined)).toEqual([]);
  });
});

describe("toLanguages", () => {
  it("prefers english_name, falls back to name", () => {
    expect(toLanguages([{ english_name: "English" }, { name: "Français" }])).toEqual(["English", "Français"]);
  });

  it("dedupes", () => {
    expect(toLanguages([{ english_name: "English" }, { english_name: "English" }])).toEqual(["English"]);
  });
});

describe("toGenres", () => {
  it("extracts unique genre names", () => {
    expect(toGenres([{ name: "Drama" }, { name: "Drama" }, { name: "War" }])).toEqual(["Drama", "War"]);
  });
});

describe("buildEnrichedPayload", () => {
  const payload = { festivals: [], records: [], metadata: { generatedAt: "2020-01-01" } };
  const records = [
    { id: "n1", film: { imdbId: "tt1", posterUrl: "" } },
    { id: "n2", film: { imdbId: "tt2", posterUrl: "" } },
    { id: "n3", film: { imdbId: null, posterUrl: "" } }
  ];

  it("overlays enriched film data only for records present in imdbLookup", () => {
    const imdbLookup = new Map([["tt1", { imdbId: "tt1", posterUrl: "https://example.com/p.jpg" }]]);
    const result = buildEnrichedPayload(payload, records, imdbLookup, []);

    expect(result.records[0].film.posterUrl).toBe("https://example.com/p.jpg");
    expect(result.records[1].film.posterUrl).toBe("");
    expect(result.records[2].film.posterUrl).toBe("");
  });

  it("stamps tmdbEnrichedFilms and tmdbFailures counts into metadata", () => {
    const imdbLookup = new Map([["tt1", { imdbId: "tt1" }]]);
    const failures = [{ imdbId: "tt2", message: "boom" }];
    const result = buildEnrichedPayload(payload, records, imdbLookup, failures);

    expect(result.metadata.tmdbEnrichedFilms).toBe(1);
    expect(result.metadata.tmdbFailures).toBe(1);
  });

  it("preserves existing metadata fields", () => {
    const result = buildEnrichedPayload(payload, records, new Map(), []);
    expect(result.metadata.generatedAt).toBe("2020-01-01");
  });
});
