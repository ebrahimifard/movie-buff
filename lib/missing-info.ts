// This is a fully static site with no database and no backend — there is no
// server-side mechanism to accept and persist a user-submitted correction.
// The most honest, architecture-consistent "simple way for the user to
// supply the missing information" is a pre-filled GitHub issue against this
// repo's own structured Issue Form (.github/ISSUE_TEMPLATE/data-correction.yml):
// it requires no new infrastructure, and the resulting issue is exactly the
// kind of input the data pipeline is already built to consume (a
// human-reviewed correction, not an unverified guess). See CONTRIBUTING.md
// for how these are triaged and applied.
const REPO = "ebrahimifard/movie-buff";
const ISSUE_TEMPLATE = "data-correction.yml";

export type MissingInfoContext = {
  title: string;
  year: number;
  festivalName: string;
  missingFields: string[];
  /** Nomination.filmId / Film.id — an imdbId, or the synthetic "film:{slug}"
   * id for films with no IMDb match. Lets a maintainer find the exact
   * record without guessing from the title alone. */
  internalId?: string;
  /** The relative archive page the user found this on (e.g. "/festival/cannes"
   * or "/film/tt6751668"), so a reviewer can jump straight to it. */
  pageUrl?: string;
  category?: string;
};

export function buildMissingInfoIssueUrl(context: MissingInfoContext): string {
  const params = new URLSearchParams({
    template: ISSUE_TEMPLATE,
    title: `[Data correction] ${context.title} (${context.year})`,
    film_title: context.title,
    festival: context.festivalName,
    year: String(context.year)
  });

  if (context.category) {
    params.set("category", context.category);
  }
  if (context.internalId) {
    params.set("internal_id", context.internalId);
  }
  if (context.pageUrl) {
    params.set("page_url", context.pageUrl);
  }
  if (context.missingFields.length > 0) {
    params.set("correction", `Currently missing: ${context.missingFields.join(", ")}.\n\n`);
  }

  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}

// Field-presence checks a UI can use to decide both what's missing (for
// display) and whether to show the "suggest a correction" affordance at
// all — never guesses a value, only reports absence.
export function getMissingFields(film: {
  posterUrl?: string | null;
  imdbId?: string | null;
  runtimeMinutes?: number | null;
  genres?: string[] | null;
  synopsis?: string | null;
}): string[] {
  const missing: string[] = [];
  if (!film.imdbId) missing.push("IMDb link");
  if (!film.posterUrl || !film.posterUrl.startsWith("/posters/")) missing.push("poster");
  if (!film.runtimeMinutes) missing.push("runtime");
  if (!film.genres || film.genres.length === 0) missing.push("genres");
  if (!film.synopsis) missing.push("synopsis");
  return missing;
}
