import { describe, expect, it } from "vitest";
import { checkReferentialIntegrity, validateEntities } from "./validate-data.mjs";

function baseEntities() {
  return {
    festivals: [{ id: "cannes", name: "Cannes", country: "FR", city: "Cannes", foundedYear: 1946, type: "festival", website: null }],
    ceremonies: [{ id: "cannes-2020", festivalId: "cannes", year: 2020, edition: null, startDate: null, endDate: null }],
    categories: [{ id: "cannes:palme-dor", festivalId: "cannes", name: "Palme d'Or", normalizedName: "palme-dor", scope: "film" }],
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
