import { describe, expect, it } from "vitest";
import { buildMissingInfoIssueUrl, getMissingFields } from "./missing-info";

describe("buildMissingInfoIssueUrl", () => {
  it("links to the structured data-correction Issue Form, pre-filled with the film's details", () => {
    const url = buildMissingInfoIssueUrl({
      title: "Some Film",
      year: 2019,
      festivalName: "Cannes Film Festival",
      missingFields: ["poster", "IMDb link"],
      internalId: "film:some-film-2019",
      pageUrl: "/festival/cannes"
    });

    expect(url.startsWith("https://github.com/ebrahimifard/movie-buff/issues/new?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("template")).toBe("data-correction.yml");
    expect(params.get("title")).toBe("[Data correction] Some Film (2019)");
    expect(params.get("film_title")).toBe("Some Film");
    expect(params.get("festival")).toBe("Cannes Film Festival");
    expect(params.get("year")).toBe("2019");
    expect(params.get("internal_id")).toBe("film:some-film-2019");
    expect(params.get("page_url")).toBe("/festival/cannes");
  });

  it("omits optional query params entirely when not provided, rather than sending empty values", () => {
    const url = buildMissingInfoIssueUrl({
      title: "Some Film",
      year: 2019,
      festivalName: "Cannes Film Festival",
      missingFields: []
    });

    const params = new URL(url).searchParams;
    expect(params.has("internal_id")).toBe(false);
    expect(params.has("page_url")).toBe(false);
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
