// This is a fully static site with no database and no backend — there is no
// server-side mechanism to accept and persist a user-submitted correction.
// The most honest, architecture-consistent "simple way for the user to
// supply the missing information" is a pre-filled GitHub issue against this
// repo's own tracker: it requires no new infrastructure, and the resulting
// issue is exactly the kind of input the data pipeline is already built to
// consume (a human-reviewed correction, not an unverified guess).
const REPO = "ebrahimifard/movie-buff";

export type MissingInfoContext = {
  title: string;
  year: number;
  festivalName: string;
  missingFields: string[];
};

export function buildMissingInfoIssueUrl(context: MissingInfoContext): string {
  const issueTitle = `Missing data: ${context.title} (${context.year})`;
  const body = [
    `Festival: ${context.festivalName}`,
    `Film: ${context.title} (${context.year})`,
    `Missing fields: ${context.missingFields.join(", ")}`,
    "",
    "Suggested correction (IMDb link, poster URL, director, release year, etc.):",
    ""
  ].join("\n");

  const params = new URLSearchParams({
    title: issueTitle,
    body,
    labels: "data-correction"
  });

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
