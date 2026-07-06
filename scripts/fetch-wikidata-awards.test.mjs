import { describe, expect, it } from "vitest";
import {
  createBaftaCeremonyNomineesQuery,
  createBaftaCeremonyWinnersQuery,
  createEventNomineesQuery,
  createEventWinnersQuery,
  createNomineesByAwardQuery,
  createNomineesByFestivalQuery,
  createOscarsCeremonyNomineesQuery,
  createOscarsCeremonyWinnersQuery,
  createWinnersByAwardQuery,
  createWinnersByFestivalQuery,
  dedupeRecords,
  extractImdb,
  mapBindingToRecord,
  normalizeNames
} from "./fetch-wikidata-awards.mjs";

function selectLine(query) {
  return query.split("\n")[0];
}

function groupByLine(query) {
  return query.split("\n").find((line) => line.trim().startsWith("GROUP BY"));
}

const builders = [
  { name: "createWinnersByFestivalQuery", fn: () => createWinnersByFestivalQuery("Q123") },
  { name: "createWinnersByAwardQuery", fn: () => createWinnersByAwardQuery("Q123") },
  { name: "createNomineesByFestivalQuery", fn: () => createNomineesByFestivalQuery("Q123") },
  { name: "createNomineesByAwardQuery", fn: () => createNomineesByAwardQuery("Q123") },
  { name: "createEventWinnersQuery", fn: () => createEventWinnersQuery("cannes") },
  { name: "createEventNomineesQuery", fn: () => createEventNomineesQuery("cannes") },
  { name: "createOscarsCeremonyWinnersQuery", fn: () => createOscarsCeremonyWinnersQuery("Q123", "Q456") },
  { name: "createOscarsCeremonyNomineesQuery", fn: () => createOscarsCeremonyNomineesQuery("Q123", "Q456") },
  { name: "createBaftaCeremonyWinnersQuery", fn: () => createBaftaCeremonyWinnersQuery("Q123", "Q456") },
  { name: "createBaftaCeremonyNomineesQuery", fn: () => createBaftaCeremonyNomineesQuery("Q123", "Q456") }
];

describe.each(builders)("$name", ({ fn }) => {
  it("projects ?directorLabel as a bare SELECT column", () => {
    expect(selectLine(fn())).toMatch(/\?directorLabel\b/);
  });

  it("includes ?directorLabel in GROUP BY", () => {
    expect(groupByLine(fn())).toMatch(/\?directorLabel\b/);
  });

  it("still aggregates directors via GROUP_CONCAT", () => {
    expect(fn()).toMatch(/GROUP_CONCAT\(DISTINCT \?directorLabel; separator="\|"\) AS \?directors/);
  });
});

describe("dedupeRecords", () => {
  function record(overrides) {
    return {
      festivalId: "cannes",
      year: 2020,
      category: "Palme d'Or",
      result: "nominee",
      directors: [],
      film: { title: "Parasite", imdbId: "tt6751668", countryCodes: [] },
      ...overrides
    };
  }

  it("unions directors from multiple director-fragments of the same film", () => {
    const rows = [
      record({ directors: ["Alice"], result: "nominee" }),
      record({ directors: ["Bob"], result: "winner" })
    ];
    const [merged] = dedupeRecords(rows);
    expect(merged.directors).toContain("Alice");
    expect(merged.directors).toContain("Bob");
    expect(merged.result).toBe("winner");
  });

  it("unions directors even when neither fragment is a winner", () => {
    const rows = [
      record({ directors: ["Alice"], result: "nominee" }),
      record({ directors: ["Bob"], result: "nominee" })
    ];
    const [merged] = dedupeRecords(rows);
    expect(merged.directors.sort()).toEqual(["Alice", "Bob"]);
  });

  it("unions countryCodes across fragments", () => {
    const rows = [
      record({ film: { title: "Parasite", imdbId: "tt6751668", countryCodes: ["KR"] } }),
      record({ film: { title: "Parasite", imdbId: "tt6751668", countryCodes: ["US"] } })
    ];
    const [merged] = dedupeRecords(rows);
    expect(merged.film.countryCodes.sort()).toEqual(["KR", "US"]);
  });

  it("keeps distinct keys as separate records", () => {
    const rows = [record({ year: 2020 }), record({ year: 2021 })];
    expect(dedupeRecords(rows)).toHaveLength(2);
  });
});

describe("normalizeNames", () => {
  it("splits a pipe-separated string into an array", () => {
    expect(normalizeNames("Alice|Bob")).toEqual(["Alice", "Bob"]);
  });

  it("returns an empty array for missing input", () => {
    expect(normalizeNames("")).toEqual([]);
    expect(normalizeNames(undefined)).toEqual([]);
  });
});

describe("extractImdb", () => {
  it("normalizes a bare numeric id to tt-prefixed form", () => {
    expect(extractImdb({ imdbId: { value: "1234567" } })).toBe("tt1234567");
  });

  it("returns null when missing", () => {
    expect(extractImdb({})).toBeNull();
  });
});

describe("mapBindingToRecord", () => {
  it("returns null when no year can be derived", () => {
    const result = mapBindingToRecord({
      binding: { filmLabel: { value: "Some Film" } },
      inferredResult: "winner",
      festivalId: "cannes",
      festivalName: "Cannes",
      category: "Palme d'Or"
    });
    expect(result).toBeNull();
  });

  it("maps a well-formed binding into a record with directors", () => {
    const result = mapBindingToRecord({
      binding: {
        filmLabel: { value: "Parasite" },
        awardDate: { value: "2019-05-25T00:00:00Z" },
        imdbId: { value: "tt6751668" },
        directors: { value: "Bong Joon-ho" },
        countryCodes: { value: "KR" }
      },
      inferredResult: "winner",
      festivalId: "cannes",
      festivalName: "Cannes"
    });
    expect(result.directors).toEqual(["Bong Joon-ho"]);
    expect(result.film.imdbId).toBe("tt6751668");
    expect(result.year).toBe(2019);
  });
});
