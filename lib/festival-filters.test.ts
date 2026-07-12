import { describe, expect, it } from "vitest";
import {
  buildFestivalFilterRows,
  filterNominations,
  getCategoryOptions,
  getFacetOptions,
  groupNominationsByFestival,
  groupRowsByFilm,
  getRuntimeBucket
} from "./festival-filters";
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

describe("filterNominations category filter", () => {
  const rows = buildFestivalFilterRows(
    [
      nomination({ id: "n1", category: "Best Picture", filmId: "tt1" }),
      nomination({ id: "n2", category: "Best Director", filmId: "tt2" }),
      nomination({ id: "n3", category: "Best Actor", filmId: "tt3" })
    ],
    new Map([
      ["tt1", film({ id: "tt1" })],
      ["tt2", film({ id: "tt2" })],
      ["tt3", film({ id: "tt3" })]
    ])
  );

  it("returns everything when categories is undefined or empty", () => {
    expect(filterNominations(rows, {})).toHaveLength(3);
    expect(filterNominations(rows, { categories: [] })).toHaveLength(3);
  });

  it("matches any row whose category is in the selected set (OR within the dimension)", () => {
    const result = filterNominations(rows, { categories: ["Best Picture", "Best Actor"] });
    expect(result.map((row) => row.nominationId).sort()).toEqual(["n1", "n3"]);
  });

  it("combines with other filters using AND", () => {
    const result = filterNominations(rows, { categories: ["Best Picture"], result: "nominee" });
    expect(result).toEqual([]);
  });
});

describe("getCategoryOptions", () => {
  const rows = buildFestivalFilterRows(
    [
      nomination({ id: "n1", year: 2019, category: "Best Picture", filmId: "tt1" }),
      nomination({ id: "n2", year: 2020, category: "Best Director", filmId: "tt2" }),
      nomination({ id: "n3", year: 2020, category: "Best Actor", filmId: "tt3" })
    ],
    new Map([
      ["tt1", film({ id: "tt1" })],
      ["tt2", film({ id: "tt2" })],
      ["tt3", film({ id: "tt3" })]
    ])
  );

  it("returns all categories sorted when no other filters are active", () => {
    expect(getCategoryOptions(rows, {})).toEqual(["Best Actor", "Best Director", "Best Picture"]);
  });

  it("narrows to categories present within the other active filters (e.g. year), ignoring its own categories filter", () => {
    expect(getCategoryOptions(rows, { year: 2020 })).toEqual(["Best Actor", "Best Director"]);
    expect(getCategoryOptions(rows, { year: 2020, categories: ["Best Actor"] })).toEqual(["Best Actor", "Best Director"]);
  });
});

describe("groupRowsByFilm", () => {
  it("collapses multiple nominations for the same film into one group", () => {
    const rows = buildFestivalFilterRows(
      [
        nomination({ id: "n1", filmId: "tt1", category: "Best Picture", result: "winner" }),
        nomination({ id: "n2", filmId: "tt1", category: "Best Director", result: "nominee" }),
        nomination({ id: "n3", filmId: "tt2", category: "Best Actor", result: "nominee" })
      ],
      new Map([
        ["tt1", film({ id: "tt1" })],
        ["tt2", film({ id: "tt2" })]
      ])
    );

    const groups = groupRowsByFilm(rows);
    expect(groups).toHaveLength(2);
    const tt1 = groups.find((group) => group.filmId === "tt1")!;
    expect(tt1.winCount).toBe(1);
    expect(tt1.nomineeCount).toBe(1);
    expect(tt1.categories).toEqual([
      { category: "Best Picture", result: "winner" },
      { category: "Best Director", result: "nominee" }
    ]);
  });

  it("groups films with no imdbId by filmId (never fails to collapse Wikipedia-sourced records)", () => {
    const rows = buildFestivalFilterRows(
      [
        nomination({ id: "n1", filmId: "film:untitled-2019", imdbId: null, category: "Palme d'Or", result: "nominee" }),
        nomination({ id: "n2", filmId: "film:untitled-2019", imdbId: null, category: "Jury Prize", result: "nominee" })
      ],
      new Map([["film:untitled-2019", film({ id: "film:untitled-2019", imdbId: null })]])
    );

    const groups = groupRowsByFilm(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].nomineeCount).toBe(2);
    expect(groups[0].imdbId).toBeNull();
  });

  it("tracks distinct years sorted descending and uses the latest as the primary year", () => {
    const rows = buildFestivalFilterRows(
      [
        nomination({ id: "n1", filmId: "tt1", year: 2018 }),
        nomination({ id: "n2", filmId: "tt1", year: 2020 })
      ],
      new Map([["tt1", film({ id: "tt1" })]])
    );

    const groups = groupRowsByFilm(rows);
    expect(groups[0].year).toBe(2020);
    expect(groups[0].years).toEqual([2020, 2018]);
  });

  it("dedupes identical (category, result) pairs but not distinct ones", () => {
    const rows = buildFestivalFilterRows(
      [
        nomination({ id: "n1", filmId: "tt1", year: 2018, category: "Best Picture", result: "nominee" }),
        nomination({ id: "n2", filmId: "tt1", year: 2019, category: "Best Picture", result: "nominee" })
      ],
      new Map([["tt1", film({ id: "tt1" })]])
    );

    const groups = groupRowsByFilm(rows);
    expect(groups[0].categories).toEqual([{ category: "Best Picture", result: "nominee" }]);
    expect(groups[0].nomineeCount).toBe(2);
  });

  it("returns an empty array for an empty row set", () => {
    expect(groupRowsByFilm([])).toEqual([]);
  });
});

describe("groupNominationsByFestival", () => {
  it("groups a film's nominations by festivalId, preserving first-occurrence order", () => {
    const entries = [
      nomination({ id: "n1", festivalId: "oscars", festivalName: "Academy Awards", year: 2020 }),
      nomination({ id: "n2", festivalId: "cannes", festivalName: "Cannes", year: 2019 }),
      nomination({ id: "n3", festivalId: "oscars", festivalName: "Academy Awards", year: 2018 })
    ];

    const groups = groupNominationsByFestival(entries);
    expect(groups.map((group) => group.festivalId)).toEqual(["oscars", "cannes"]);
    expect(groups[0].entries.map((entry) => entry.id)).toEqual(["n1", "n3"]);
    expect(groups[1].entries.map((entry) => entry.id)).toEqual(["n2"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupNominationsByFestival([])).toEqual([]);
  });
});
