import { describe, expect, it } from "vitest";
import {
  buildEnrichedPayload,
  chunk,
  directorsMatch,
  hasUnknownReleaseYear,
  isSuspectMatch,
  knownImdbIdFor,
  pickFromFilmography,
  tmdbDirectorNames,
  parseFestivalFilter,
  rankTitleMatches,
  serializeTmdbCache,
  titleCandidates,
  titlesMatch,
  titleYearFallbackKey, toGenres, toIsoCountryCodes, toLanguages } from "./enrich-tmdb.mjs";

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

describe("rankTitleMatches", () => {
  const first = (results, title, year, gap) => rankTitleMatches(results, [title], year, gap)[0] ?? null;

  it("accepts a near-exact title match with a release year within 1 of the expected year", () => {
    const results = [{ title: "The Father", release_date: "2020-12-01" }];
    expect(first(results, "The Father", 2021)?.title).toBe("The Father");
  });

  it("is case- and punctuation-insensitive", () => {
    const results = [{ title: "Kill Bill: Vol. 2", release_date: "2004-04-16" }];
    expect(first(results, "kill bill vol 2", 2004)).not.toBeNull();
  });

  it("rejects a title match whose year is more than the allowed gap off", () => {
    const results = [{ title: "The Father", release_date: "2015-01-01" }];
    expect(first(results, "The Father", 2021)).toBeNull();
    expect(first(results, "The Father", 2019, 3)).toBeNull();
    expect(first(results, "The Father", 2017, 2)?.title).toBe("The Father");
  });

  it("rejects when no result's title matches at all", () => {
    const results = [{ title: "A Completely Different Film", release_date: "2021-01-01" }];
    expect(first(results, "The Father", 2021)).toBeNull();
  });

  it("returns null for empty results", () => {
    expect(first([], "The Father", 2021)).toBeNull();
  });

  it("falls back to original_title when title doesn't match", () => {
    const results = [{ title: "Foreign Release Title", original_title: "The Father", release_date: "2020-01-01" }];
    expect(first(results, "The Father", 2021)).not.toBeNull();
  });

  it("matches a non-Latin original title against any candidate title", () => {
    const results = [{ title: "Asako I & II", original_title: "寝ても覚めても", release_date: "2018-09-01" }];
    expect(rankTitleMatches(results, ["Asako 1 and 2", "寝ても覚めても"], 2018)).toHaveLength(1);
  });

  it("orders matches by closeness of release year (same-title remakes)", () => {
    const results = [
      { id: 1, title: "The Browning Version", release_date: "1951-03-01" },
      { id: 2, title: "The Browning Version", release_date: "1994-10-12" }
    ];
    expect(rankTitleMatches(results, ["The Browning Version"], 1994, 3).map((r) => r.id)).toEqual([2]);
  });
});

describe("titlesMatch", () => {
  it("folds diacritics and ignores a leading English article", () => {
    expect(titlesMatch("Amélie", "Amelie")).toBe(true);
    expect(titlesMatch("The Red Meadows", "Red Meadows")).toBe(true);
    expect(titlesMatch("Red Meadows", "Blue Meadows")).toBe(false);
  });
});

describe("titleCandidates", () => {
  it("adds the original title and each of its parts after the English title, de-duplicated", () => {
    expect(titleCandidates({ title: "Shoplifters", originalTitle: "万引き家族 / Manbiki kazoku" })).toEqual([
      "Shoplifters",
      "万引き家族 / Manbiki kazoku",
      "万引き家族",
      "Manbiki kazoku"
    ]);
    expect(titleCandidates({ title: "Amour", originalTitle: "Amour" })).toEqual(["Amour"]);
  });
});

describe("directorsMatch", () => {
  const crew = [{ job: "Director", name: "Andrey Konchalovskiy" }, { job: "Writer", name: "Someone Else" }];

  it("returns null when either side is unknown", () => {
    expect(directorsMatch([], crew)).toBeNull();
    expect(directorsMatch(["Andrei Konchalovsky"], [])).toBeNull();
  });

  it("agrees on a shared name token despite transliteration differences", () => {
    expect(directorsMatch(["Konchalovskiy"], crew)).toBe(true);
  });

  it("disagrees when no director shares a name token", () => {
    expect(directorsMatch(["Mike Figgis"], [{ job: "Director", name: "Anthony Asquith" }])).toBe(false);
  });

  it("only considers crew whose job is Director", () => {
    expect(directorsMatch(["Someone Else"], crew)).toBe(false);
  });
});

describe("parseFestivalFilter", () => {
  it("collects --festival= values (comma-separated or repeated), or null when absent", () => {
    expect(parseFestivalFilter(["--festival=cannes,venice", "--festival=tiff"])).toEqual(new Set(["cannes", "venice", "tiff"]));
    expect(parseFestivalFilter(["--other"])).toBeNull();
  });
});

describe("serializeTmdbCache", () => {
  it("converts the imdbId and title/year lookup maps into a plain JSON-serializable object", () => {
    const byImdbId = new Map([["tt1", { imdbId: "tt1", posterUrl: "https://example.com/p.jpg" }]]);
    const byTitleYear = new Map([["cannes|2020|some film", { imdbId: "tt2" }]]);

    const result = serializeTmdbCache(byImdbId, byTitleYear);

    expect(result.byImdbId).toEqual({ tt1: { imdbId: "tt1", posterUrl: "https://example.com/p.jpg" } });
    expect(result.byTitleYear).toEqual({ "cannes|2020|some film": { imdbId: "tt2" } });
    expect(typeof result.updatedAt).toBe("string");
  });

  it("serializes empty maps to empty objects", () => {
    const result = serializeTmdbCache(new Map(), new Map());
    expect(result.byImdbId).toEqual({});
    expect(result.byTitleYear).toEqual({});
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

describe("tmdbDirectorNames", () => {
  it("keeps only crew credited as Director, deduped", () => {
    const crew = [
      { job: "Director", name: "Orson Welles" },
      { job: "Writer", name: "Anthony Veiller" },
      { job: "Director", name: "Orson Welles" }
    ];
    expect(tmdbDirectorNames(crew)).toEqual(["Orson Welles"]);
    expect(tmdbDirectorNames(undefined)).toEqual([]);
  });
});

describe("hasUnknownReleaseYear", () => {
  const record = (category, releaseYear) => ({ category, year: 2026, film: { title: "x", releaseYear } });
  it("is true only for a retrospective section whose release year is just the festival year", () => {
    expect(hasUnknownReleaseYear(record("Cannes Classics", 2026))).toBe(true);
    expect(hasUnknownReleaseYear(record("Cinéma de la Plage", 2026))).toBe(true);
    expect(hasUnknownReleaseYear(record("Cannes Classics", 1946))).toBe(false);
    expect(hasUnknownReleaseYear(record("Cannes Classics – Documentaries about Cinema", 2026))).toBe(false);
    expect(hasUnknownReleaseYear(record("Palme d'Or", 2026))).toBe(false);
  });
});

describe("isSuspectMatch", () => {
  const record = { year: 2026, category: "Cannes Classics", directors: ["Vittorio De Sica"], film: { title: "Two Women", releaseYear: 1960 } };
  it("flags a match whose TMDB director disagrees with the source", () => {
    expect(isSuspectMatch(record, { tmdbDirectors: ["Someone Else"], tmdbReleaseYear: 1960 })).toBe("director");
  });
  it("flags a match far from the source's own (YYYY) release year", () => {
    expect(isSuspectMatch({ ...record, directors: [] }, { tmdbDirectors: [], tmdbReleaseYear: 2024 })).toBe("release-year");
  });
  it("flags a match TMDB dates after the festival edition", () => {
    expect(isSuspectMatch({ year: 2010, directors: [], film: { releaseYear: 2010 } }, { tmdbReleaseYear: 2015 })).toBe("after-festival");
  });
  it("accepts a consistent match and never flags on missing evidence", () => {
    expect(isSuspectMatch(record, { tmdbDirectors: ["Vittorio De Sica"], tmdbReleaseYear: 1960 })).toBeNull();
    expect(isSuspectMatch(record, {})).toBeNull();
  });
});

describe("pickFromFilmography", () => {
  const crew = [
    { id: 1, job: "Director", title: "Torino Shadow", original_title: "都灵之影", release_date: "2026-05-01" },
    { id: 2, job: "Director", title: "Still Life", original_title: "三峡好人", release_date: "2006-09-05" },
    { id: 3, job: "Producer", title: "Torino Shadow", release_date: "2026-05-01" },
    { id: 4, job: "Director", title: "Maverick", release_date: "2026-01-01" }
  ];
  it("matches a directing credit by title or original title within the year gap", () => {
    expect(pickFromFilmography(crew, ["都灵之影"], 2026).map((c) => c.id)).toEqual([1]);
    expect(pickFromFilmography(crew, ["Still Life"], 2006).map((c) => c.id)).toEqual([2]);
    expect(pickFromFilmography(crew, ["Still Life"], 2015)).toEqual([]);
  });
  it("matches any year when the year is unknown (0)", () => {
    expect(pickFromFilmography(crew, ["Still Life"], 0).map((c) => c.id)).toEqual([2]);
  });
  it("accepts a title that extends the credit's title only within one year", () => {
    expect(pickFromFilmography(crew, ["Maverick: The Epic Adventures of David Lean"], 2026).map((c) => c.id)).toEqual([4]);
    expect(pickFromFilmography(crew, ["Maverick: The Epic Adventures of David Lean"], 2020)).toEqual([]);
  });
});

describe("knownImdbIdFor", () => {
  const record = { festivalId: "cannes", year: 2026, film: { title: "The Stranger", wikipediaTitle: "The Stranger (1946 film)" } };
  it("prefers a manual match, then the film's own Wikipedia article id, else null", () => {
    const wikidata = new Map([["The Stranger (1946 film)", "tt0038991"]]);
    expect(knownImdbIdFor(record, new Map(), wikidata)).toBe("tt0038991");
    expect(knownImdbIdFor(record, new Map([["cannes|2026|the stranger", "tt9999999"]]), wikidata)).toBe("tt9999999");
    expect(knownImdbIdFor({ ...record, film: { title: "The Stranger" } }, new Map(), wikidata)).toBeNull();
  });
});
