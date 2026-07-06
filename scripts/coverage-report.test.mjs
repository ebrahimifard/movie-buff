import { describe, expect, it } from "vitest";
import { computeCoverageForFestival, range } from "./coverage-report.mjs";

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
