import { describe, expect, it } from "vitest";
import { computeCatalogueStatsForFestival, computeCoverageForFestival, range } from "./coverage-report.mjs";

describe("range", () => {
  it("is inclusive of both bounds", () => {
    expect(range(2018, 2020)).toEqual([2018, 2019, 2020]);
  });

  it("returns a single value when start equals end", () => {
    expect(range(2020, 2020)).toEqual([2020]);
  });
});

describe("computeCoverageForFestival", () => {
  const festival = { id: "test-fest", name: "Test Festival", foundedYear: 2018, inactiveYears: [2019] };

  function grouped(entries) {
    return new Map(Object.entries(entries));
  }

  it("marks years with no data as missing, excluding inactive years", () => {
    const report = computeCoverageForFestival(festival, grouped({}), 2020);
    expect(report.missingYears).toEqual([2018, 2020]);
    expect(report.missingYears).not.toContain(2019);
  });

  it("marks a year weak when winners or nominees are absent", () => {
    const data = grouped({
      "test-fest|2018": { winnerCount: 1, nomineeCount: 0, categories: new Set(["Best Picture"]) },
      "test-fest|2020": { winnerCount: 1, nomineeCount: 2, categories: new Set(["Best Picture"]) }
    });
    const report = computeCoverageForFestival(festival, data, 2020);
    expect(report.weakYears).toEqual([2018]);
    expect(report.missingYears).toEqual([]);
  });

  it("does not flag inactive years as weak even with no data", () => {
    const report = computeCoverageForFestival(festival, grouped({}), 2020);
    const year2019 = report.coverageYears.find((entry) => entry.year === 2019);
    expect(year2019.isInactive).toBe(true);
    expect(report.weakYears).not.toContain(2019);
    expect(report.missingYears).not.toContain(2019);
  });
});

describe("computeCatalogueStatsForFestival", () => {
  const nominations = [
    { id: "n1", festivalId: "venice", result: "winner", country: "IT", filmId: "tt1" },
    { id: "n2", festivalId: "venice", result: "nominee", country: "XX", filmId: "tt2" },
    { id: "n3", festivalId: "venice", result: "nominee", country: "US", filmId: "missing" },
    { id: "n4", festivalId: "cannes", result: "winner", country: "FR", filmId: "tt3" }
  ];

  const filmsById = new Map([
    ["tt1", { id: "tt1", posterUrl: "/posters/tt1.jpg", runtimeMinutes: 120 }],
    ["tt2", { id: "tt2", posterUrl: "", runtimeMinutes: 0 }]
  ]);

  it("scopes stats to the given festival only", () => {
    const stats = computeCatalogueStatsForFestival("venice", nominations, filmsById);
    expect(stats.totalRecords).toBe(3);
    expect(stats.winners).toBe(1);
    expect(stats.nominees).toBe(2);
  });

  it("counts missing poster/runtime/country, including when the film doesn't resolve", () => {
    const stats = computeCatalogueStatsForFestival("venice", nominations, filmsById);
    expect(stats.missingPoster).toBe(2); // tt2 (empty) + missing film
    expect(stats.missingRuntime).toBe(2); // tt2 (0) + missing film
    expect(stats.missingCountry).toBe(1); // the "XX" fallback code
  });

  it("computes coverage percentages", () => {
    const stats = computeCatalogueStatsForFestival("venice", nominations, filmsById);
    expect(stats.posterCoveragePct).toBeCloseTo(33.3, 1);
  });

  it("returns zeroed stats for a festival with no records", () => {
    const stats = computeCatalogueStatsForFestival("locarno", nominations, filmsById);
    expect(stats.totalRecords).toBe(0);
    expect(stats.posterCoveragePct).toBe(0);
  });
});
