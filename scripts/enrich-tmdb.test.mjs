import { describe, expect, it } from "vitest";
import { buildEnrichedPayload, chunk, findConfidentMatch, titleYearFallbackKey, toGenres, toIsoCountryCodes, toLanguages } from "./enrich-tmdb.mjs";

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

  it("overlays a title/year fallback match onto a record with no imdbId, without touching imdbId-keyed records", () => {
    const noImdbRecord = { id: "n3", festivalId: "cannes", year: 2019, film: { title: "Some Film", imdbId: null, posterUrl: "" } };
    const fallbackLookup = new Map([
      [titleYearFallbackKey(noImdbRecord), { title: "Some Film", imdbId: "tt9999999", posterUrl: "https://example.com/p.jpg" }]
    ]);
    const result = buildEnrichedPayload(payload, [noImdbRecord], new Map(), [], fallbackLookup);

    expect(result.records[0].film.imdbId).toBe("tt9999999");
    expect(result.records[0].film.posterUrl).toBe("https://example.com/p.jpg");
  });

  it("does not apply a fallback match to a record that already has an imdbId", () => {
    const withImdbRecord = { id: "n1", festivalId: "cannes", year: 2019, film: { title: "Some Film", imdbId: "tt1", posterUrl: "" } };
    const fallbackLookup = new Map([[titleYearFallbackKey(withImdbRecord), { title: "Wrong Film", imdbId: "tt9999999" }]]);
    const result = buildEnrichedPayload(payload, [withImdbRecord], new Map(), [], fallbackLookup);

    expect(result.records[0].film.imdbId).toBe("tt1");
  });

  it("remains backward compatible when fallbackLookup is omitted", () => {
    const result = buildEnrichedPayload(payload, records, new Map(), []);
    expect(result.metadata.tmdbTitleYearMatched).toBe(0);
  });
});

describe("findConfidentMatch", () => {
  it("accepts a near-exact title match with a release year within 1 of the expected year", () => {
    const results = [{ title: "The Father", release_date: "2020-12-01" }];
    expect(findConfidentMatch(results, "The Father", 2021)?.title).toBe("The Father");
  });

  it("is case- and punctuation-insensitive", () => {
    const results = [{ title: "Kill Bill: Vol. 2", release_date: "2004-04-16" }];
    expect(findConfidentMatch(results, "kill bill vol 2", 2004)).not.toBeNull();
  });

  it("rejects a title match whose year is more than 1 off", () => {
    const results = [{ title: "The Father", release_date: "2015-01-01" }];
    expect(findConfidentMatch(results, "The Father", 2021)).toBeNull();
  });

  it("rejects when no result's title matches at all", () => {
    const results = [{ title: "A Completely Different Film", release_date: "2021-01-01" }];
    expect(findConfidentMatch(results, "The Father", 2021)).toBeNull();
  });

  it("returns null for empty results", () => {
    expect(findConfidentMatch([], "The Father", 2021)).toBeNull();
  });

  it("falls back to original_title when title doesn't match", () => {
    const results = [{ title: "Foreign Release Title", original_title: "The Father", release_date: "2020-01-01" }];
    expect(findConfidentMatch(results, "The Father", 2021)).not.toBeNull();
  });
});

describe("titleYearFallbackKey", () => {
  it("builds a stable composite key from festivalId, year, and normalized title", () => {
    const a = { festivalId: "cannes", year: 2020, film: { title: "Some Film!" } };
    const b = { festivalId: "cannes", year: 2020, film: { title: "some film" } };
    expect(titleYearFallbackKey(a)).toBe(titleYearFallbackKey(b));
  });

  it("produces different keys for different films", () => {
    const a = { festivalId: "cannes", year: 2020, film: { title: "Film A" } };
    const b = { festivalId: "cannes", year: 2020, film: { title: "Film B" } };
    expect(titleYearFallbackKey(a)).not.toBe(titleYearFallbackKey(b));
  });
});
