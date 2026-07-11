import { describe, expect, it } from "vitest";
import { buildFestivalFilterRows, filterNominations, getFacetOptions, getRuntimeBucket } from "./festival-filters";
import type { Film, Nomination } from "./types";

describe("getRuntimeBucket", () => {
  it("treats 0 or missing runtime as unknown", () => {
    expect(getRuntimeBucket(0)).toBe("unknown");
  });

  it("buckets under 90", () => {
    expect(getRuntimeBucket(89)).toBe("under-90");
  });

  it("buckets 90-120 inclusive at both ends", () => {
    expect(getRuntimeBucket(90)).toBe("90-120");
    expect(getRuntimeBucket(120)).toBe("90-120");
  });

  it("buckets over 120", () => {
    expect(getRuntimeBucket(121)).toBe("over-120");
  });
});

function film(overrides: Partial<Film>): Film {
  return {
    id: "tt1",
    title: "T",
    releaseYear: 2020,
    imdbId: "tt1",
    posterUrl: "",
    runtimeMinutes: 0,
    countryCodes: [],
    languages: [],
    genres: [],
    synopsis: "",
    ...overrides
  };
}

function nomination(overrides: Partial<Nomination>): Nomination {
  return {
    id: "n1",
    year: 2020,
    festivalId: "cannes",
    festivalName: "Cannes",
    category: "Palme d'Or",
    ceremonyId: "cannes-2020",
    categoryId: "cannes:palme-dor",
    title: "T",
    director: "Jane Doe",
    directorIds: [],
    country: "FR",
    result: "winner",
    imdbId: "tt1",
    filmId: "tt1",
    ...overrides
  };
}

describe("buildFestivalFilterRows", () => {
  it("joins runtime from the film map", () => {
    const filmsById = new Map([["tt1", film({ runtimeMinutes: 133 })]]);
    const rows = buildFestivalFilterRows([nomination({})], filmsById);
    expect(rows[0].runtimeMinutes).toBe(133);
    expect(rows[0].countryCode).toBe("FR");
  });

  it("defaults runtime to 0 when the film doesn't resolve, without throwing", () => {
    const filmsById = new Map<string, Film>();
    const rows = buildFestivalFilterRows([nomination({ filmId: "unknown" })], filmsById);
    expect(rows[0].runtimeMinutes).toBe(0);
  });
});

describe("filterNominations", () => {
  const rows = buildFestivalFilterRows(
    [
      nomination({ id: "n1", year: 2020, result: "winner", country: "FR", filmId: "tt1" }),
      nomination({ id: "n2", year: 2021, result: "nominee", country: "US", filmId: "tt2" })
    ],
    new Map([
      ["tt1", film({ id: "tt1", runtimeMinutes: 80 })],
      ["tt2", film({ id: "tt2", runtimeMinutes: 150 })]
    ])
  );

  it("returns everything when no filters are set", () => {
    expect(filterNominations(rows, {})).toHaveLength(2);
  });

  it("filters by result", () => {
    expect(filterNominations(rows, { result: "winner" })).toHaveLength(1);
  });

  it("filters by runtime bucket", () => {
    expect(filterNominations(rows, { runtime: "under-90" })).toHaveLength(1);
    expect(filterNominations(rows, { runtime: "over-120" })).toHaveLength(1);
  });

  it("filters by year", () => {
    expect(filterNominations(rows, { year: 2020 })).toHaveLength(1);
  });

  it("filters by country", () => {
    expect(filterNominations(rows, { country: "US" })).toHaveLength(1);
  });

  it("combines filters with AND logic", () => {
    expect(filterNominations(rows, { result: "winner", country: "US" })).toHaveLength(0);
    expect(filterNominations(rows, { result: "nominee", country: "US" })).toHaveLength(1);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterNominations(rows, { year: 1999 })).toEqual([]);
  });
});

describe("getFacetOptions", () => {
  it("returns unique years sorted descending and unique countries sorted ascending", () => {
    const rows = buildFestivalFilterRows(
      [nomination({ id: "n1", year: 2019, country: "US" }), nomination({ id: "n2", year: 2020, country: "FR" }), nomination({ id: "n3", year: 2019, country: "US" })],
      new Map([["tt1", film({})]])
    );
    expect(getFacetOptions(rows)).toEqual({ years: [2020, 2019], countries: ["FR", "US"] });
  });
});
