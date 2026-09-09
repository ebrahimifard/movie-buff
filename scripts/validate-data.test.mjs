import { describe, expect, it } from "vitest";
import {
  checkCategoryClassificationCoverage,
  checkQualityThresholds,
  checkReferentialIntegrity,
  computeOverallQualityStats,
  validateEntities
} from "./validate-data.mjs";

function baseEntities() {
  return {
    festivals: [{ id: "cannes", name: "Cannes", country: "FR", city: "Cannes", foundedYear: 1946, type: "festival", website: null }],
    ceremonies: [{ id: "cannes-2020", festivalId: "cannes", year: 2020, edition: null, startDate: null, endDate: null }],
    categories: [{ id: "cannes:palme-dor", festivalId: "cannes", name: "Palme d'Or", normalizedName: "palme-dor", scope: "film", isAward: true, isHonoraryAward: false }],
    films: [{ id: "tt1", title: "T", releaseYear: 2020, imdbId: "tt1", posterUrl: "", runtimeMinutes: 0, countryCodes: [], languages: [], genres: [], synopsis: "" }],
    people: [{ id: "person:jane-doe", name: "Jane Doe", roles: ["director"], imdbId: null, tmdbId: null }],
    nominations: [
      {
        id: "n1",
        year: 2020,
        festivalId: "cannes",
        festivalName: "Cannes",
        category: "Palme d'Or",
        ceremonyId: "cannes-2020",
        categoryId: "cannes:palme-dor",
        title: "T",
        director: "Jane Doe",
        directorIds: ["person:jane-doe"],
        country: "FR",
        result: "winner",
        imdbId: "tt1",
        filmId: "tt1"
      }
    ]
  };
}

describe("validateEntities", () => {
  it("reports no issues for well-formed entities", () => {
    expect(validateEntities(baseEntities())).toEqual([]);
  });

  it("reports a schema issue for an invalid result value", () => {
    const entities = baseEntities();
    entities.nominations[0].result = "maybe";
    const issues = validateEntities(entities);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("result");
  });

  it("reports a schema issue for a malformed imdbId", () => {
    const entities = baseEntities();
    entities.films[0].imdbId = "not-an-id";
    const issues = validateEntities(entities);
    expect(issues.some((issue) => issue.includes("imdbId"))).toBe(true);
  });
});

describe("checkReferentialIntegrity", () => {
  it("passes for well-formed entities", () => {
    expect(checkReferentialIntegrity(baseEntities())).toEqual([]);
  });

  it("flags a dangling categoryId", () => {
    const entities = baseEntities();
    entities.nominations[0].categoryId = "cannes:does-not-exist";
    const issues = checkReferentialIntegrity(entities);
    expect(issues.some((issue) => issue.includes("categoryId"))).toBe(true);
  });

  it("flags a dangling directorIds entry", () => {
    const entities = baseEntities();
    entities.nominations[0].directorIds = ["person:nobody"];
    const issues = checkReferentialIntegrity(entities);
    expect(issues.some((issue) => issue.includes("directorIds"))).toBe(true);
  });

  it("flags a Ceremony.festivalId that doesn't resolve to a Festival", () => {
    const entities = baseEntities();
    entities.ceremonies[0].festivalId = "unknown-festival";
    const issues = checkReferentialIntegrity(entities);
    expect(issues.some((issue) => issue.includes("[ceremonies]"))).toBe(true);
  });
});

describe("computeOverallQualityStats", () => {
  it("computes coverage percentages across all films", () => {
    const films = [
      { imdbId: "tt1", posterUrl: "/posters/tt1.jpg", runtimeMinutes: 100, genres: ["Drama"], synopsis: "A story." },
      { imdbId: null, posterUrl: "", runtimeMinutes: 0, genres: [], synopsis: "" }
    ];
    const stats = computeOverallQualityStats(films);
    expect(stats.total).toBe(2);
    expect(stats.imdbCoveragePct).toBe(50);
    expect(stats.posterCoveragePct).toBe(50);
    expect(stats.runtimeCoveragePct).toBe(50);
    expect(stats.genresCoveragePct).toBe(50);
    expect(stats.synopsisCoveragePct).toBe(50);
  });

  it("returns zeroed stats for an empty catalogue rather than dividing by zero", () => {
    const stats = computeOverallQualityStats([]);
    expect(stats.total).toBe(0);
    expect(stats.imdbCoveragePct).toBe(0);
  });
});

describe("checkQualityThresholds", () => {
  it("flags a metric below its threshold", () => {
    const issues = checkQualityThresholds({ imdbCoveragePct: 5 }, { imdbCoveragePct: 20 });
    expect(issues.some((issue) => issue.includes("imdbCoveragePct"))).toBe(true);
  });

  it("does not flag a metric at or above its threshold", () => {
    expect(checkQualityThresholds({ imdbCoveragePct: 20 }, { imdbCoveragePct: 20 })).toEqual([]);
    expect(checkQualityThresholds({ imdbCoveragePct: 50 }, { imdbCoveragePct: 20 })).toEqual([]);
  });

  it("checks every provided threshold independently", () => {
    const stats = { imdbCoveragePct: 50, posterCoveragePct: 5 };
    const issues = checkQualityThresholds(stats, { imdbCoveragePct: 20, posterCoveragePct: 20 });
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("posterCoveragePct");
  });
});

describe("checkCategoryClassificationCoverage", () => {
  const categories = [
    { festivalId: "cannes", name: "Palme d'Or" },
    { festivalId: "berlinale", name: "Golden Bear" }
  ];

  it("reports no gaps when every category has a classification entry", () => {
    const classifications = [
      { festivalId: "cannes", category: "Palme d'Or", isAward: true },
      { festivalId: "berlinale", category: "Golden Bear", isAward: true }
    ];
    expect(checkCategoryClassificationCoverage(categories, classifications)).toEqual([]);
  });

  it("flags a category with no classification entry at all, regardless of what isAward would default to", () => {
    const classifications = [{ festivalId: "cannes", category: "Palme d'Or", isAward: true }];
    const unclassified = checkCategoryClassificationCoverage(categories, classifications);
    expect(unclassified).toEqual(['[berlinale] "Golden Bear"']);
  });

  it("scopes matching by festivalId — the same category name at a different festival is still unclassified", () => {
    const classifications = [{ festivalId: "venice", category: "Golden Bear", isAward: true }];
    const unclassified = checkCategoryClassificationCoverage(categories, classifications);
    expect(unclassified).toContain('[berlinale] "Golden Bear"');
  });

  it("returns an empty array when there are no categories", () => {
    expect(checkCategoryClassificationCoverage([], [])).toEqual([]);
  });
});
