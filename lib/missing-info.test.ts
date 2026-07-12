import { describe, expect, it } from "vitest";
import { buildMissingInfoIssueUrl, getMissingFields } from "./missing-info";

describe("buildMissingInfoIssueUrl", () => {
  it("builds a GitHub issue URL against this repo with the film's details in the body", () => {
    const url = buildMissingInfoIssueUrl({
      title: "Some Film",
      year: 2019,
      festivalName: "Cannes Film Festival",
      missingFields: ["poster", "IMDb link"]
    });

    expect(url.startsWith("https://github.com/ebrahimifard/movie-buff/issues/new?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("title")).toBe("Missing data: Some Film (2019)");
    expect(params.get("body")).toContain("Cannes Film Festival");
    expect(params.get("body")).toContain("poster, IMDb link");
    expect(params.get("labels")).toBe("data-correction");
  });
});

describe("getMissingFields", () => {
  it("reports every missing field for a bare-minimum film", () => {
    const fields = getMissingFields({ posterUrl: "", imdbId: null, runtimeMinutes: 0, genres: [], synopsis: "" });
    expect(fields).toEqual(["IMDb link", "poster", "runtime", "genres", "synopsis"]);
  });

  it("reports nothing missing for a fully enriched film", () => {
    const fields = getMissingFields({
      posterUrl: "/posters/tt1.jpg",
      imdbId: "tt1",
      runtimeMinutes: 120,
      genres: ["Drama"],
      synopsis: "A story."
    });
    expect(fields).toEqual([]);
  });

  it("treats a remote (non-local) posterUrl as still missing, since only local paths ever render", () => {
    const fields = getMissingFields({
      posterUrl: "https://image.tmdb.org/t/p/w500/x.jpg",
      imdbId: "tt1",
      runtimeMinutes: 120,
      genres: ["Drama"],
      synopsis: "A story."
    });
    expect(fields).toEqual(["poster"]);
  });
});
