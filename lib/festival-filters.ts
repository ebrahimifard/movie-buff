import type { Category, Film, Nomination } from "./types";

export type RuntimeBucket = "under-90" | "90-120" | "over-120" | "unknown";

export type FestivalFilterRow = {
  nominationId: string;
  filmId: string;
  year: number;
  title: string;
  category: string;
  // Whether `category` genuinely represents a competitive festival
  // distinction (award, prize, nomination, jury/audience recognition), per
  // Category.isAward — see data/source/category-classifications.json. Only
  // affects which values getCategoryOptions offers as filter options; the
  // underlying nomination data and every other filter are unaffected.
  categoryIsAward: boolean;
  result: "winner" | "nominee";
  imdbId: string | null;
  director: string;
  runtimeMinutes: number;
  countryCode: string;
  posterUrl: string;
  genres: string[];
};

export type FestivalFilterState = {
  result?: "winner" | "nominee";
  runtime?: RuntimeBucket;
  year?: number;
  country?: string;
  categories?: string[];
  genres?: string[];
};

export type FestivalCategoryEntry = { category: string; result: "winner" | "nominee" };

// One card per movie: every FestivalFilterRow for a given filmId (a movie can
// have several nominations at the same festival) collapses into a single
// group. The card's badge/category summary always reflects the *complete*
// set of rows for that film — filters only decide which movies qualify for
// display (see groupRowsByFilm's caller), not what the resulting card shows.
// That keeps a card's content stable as unrelated filters are toggled.
export type FestivalMovieGroup = {
  filmId: string;
  title: string;
  year: number;
  years: number[];
  imdbId: string | null;
  director: string;
  runtimeMinutes: number;
  countryCode: string;
  posterUrl: string;
  genres: string[];
  winCount: number;
  nomineeCount: number;
  categories: FestivalCategoryEntry[];
};

export function getRuntimeBucket(runtimeMinutes: number): RuntimeBucket {
  if (!runtimeMinutes || runtimeMinutes <= 0) {
    return "unknown";
  }
  if (runtimeMinutes < 90) {
    return "under-90";
  }
  if (runtimeMinutes <= 120) {
    return "90-120";
  }
  return "over-120";
}

// One-time server-side join between a festival's nominations and their films
// (runtime lives only on Film, not Nomination) into the narrow projection the
// client filter panel actually needs — avoids shipping full Nomination/Film
// objects to the browser for large festivals (Oscars: 10,000+ rows).
// categoriesById is the same kind of one-time lookup, used only to read
// Category.isAward (see FestivalFilterRow.categoryIsAward) — a missing
// lookup (should never happen once data:validate passes) conservatively
// defaults to false rather than assuming a category is a real award.
export function buildFestivalFilterRows(
  nominations: Nomination[],
  filmsById: Map<string, Film>,
  categoriesById: Map<string, Category>
): FestivalFilterRow[] {
  return nominations.map((nomination) => {
    const film = filmsById.get(nomination.filmId);
    const category = categoriesById.get(nomination.categoryId);
    return {
      nominationId: nomination.id,
      filmId: nomination.filmId,
      year: nomination.year,
      title: nomination.title,
      category: nomination.category,
      categoryIsAward: category?.isAward ?? false,
      result: nomination.result,
      imdbId: nomination.imdbId,
      director: nomination.director,
      runtimeMinutes: film?.runtimeMinutes ?? 0,
      countryCode: nomination.country,
      posterUrl: film?.posterUrl ?? "",
      genres: film?.genres ?? []
    };
  });
}

// Groups by Film.id rather than imdbId: most Wikipedia-sourced festival
// records (Cannes/Berlinale/Venice/BAFTA/Golden Globes) have no IMDb match,
// but Nomination.filmId is always populated (see resolveFilmId() in
// scripts/build-comprehensive-data.mjs) — grouping by imdbId would fail to
// collapse the majority of those festivals' duplicate cards.
// Group order follows first-occurrence order of each filmId in `rows`; since
// callers always pass rows already sorted by year descending (the on-disk
// sort order from scripts/update-data.mjs), this yields groups ordered by
// each movie's most recent nomination without an extra sort pass.
export function groupRowsByFilm(rows: FestivalFilterRow[]): FestivalMovieGroup[] {
  const groups = new Map<string, FestivalMovieGroup>();

  for (const row of rows) {
    let group = groups.get(row.filmId);
    if (!group) {
      group = {
        filmId: row.filmId,
        title: row.title,
        year: row.year,
        years: [],
        imdbId: row.imdbId,
        director: row.director,
        runtimeMinutes: row.runtimeMinutes,
        countryCode: row.countryCode,
        posterUrl: row.posterUrl,
        genres: row.genres,
        winCount: 0,
        nomineeCount: 0,
        categories: []
      };
      groups.set(row.filmId, group);
    }

    if (row.year > group.year) {
      group.year = row.year;
    }
    if (!group.years.includes(row.year)) {
      group.years.push(row.year);
    }
    if (row.result === "winner") {
      group.winCount += 1;
    } else {
      group.nomineeCount += 1;
    }
    if (!group.categories.some((entry) => entry.category === row.category && entry.result === row.result)) {
      group.categories.push({ category: row.category, result: row.result });
    }
  }

  for (const group of groups.values()) {
    group.years.sort((a, b) => b - a);
  }

  return [...groups.values()];
}

export function filterNominations(rows: FestivalFilterRow[], filters: FestivalFilterState): FestivalFilterRow[] {
  return rows.filter((row) => {
    if (filters.result && row.result !== filters.result) {
      return false;
    }
    if (filters.runtime && getRuntimeBucket(row.runtimeMinutes) !== filters.runtime) {
      return false;
    }
    if (filters.year !== undefined && row.year !== filters.year) {
      return false;
    }
    if (filters.country && row.countryCode !== filters.country) {
      return false;
    }
    if (filters.categories && filters.categories.length > 0 && !filters.categories.includes(row.category)) {
      return false;
    }
    // A film can carry several genres (row.genres), so this is OR-within
    // the selected genre set (matches if the film has ANY of the selected
    // genres) — consistent with the categories filter's semantics above.
    // A film with no genres at all (genres: []) simply never matches an
    // active genre filter, which is the correct behavior: it's neither
    // wrongly included nor does it crash on the empty array.
    if (filters.genres && filters.genres.length > 0 && !row.genres.some((genre) => filters.genres!.includes(genre))) {
      return false;
    }
    return true;
  });
}

export function getFacetOptions(rows: FestivalFilterRow[]): { years: number[]; countries: string[] } {
  const years = [...new Set(rows.map((row) => row.year))].sort((a, b) => b - a);
  const countries = [...new Set(rows.map((row) => row.countryCode))].sort();
  return { years, countries };
}

// Category options are scoped to every *other* active filter (year, result,
// runtime, country) but never to `filters.categories` itself — otherwise
// picking one category would immediately hide every other option. This is
// what makes the category list narrow when, e.g., a year is selected.
// Only genuine award/prize/nomination categories (categoryIsAward) are ever
// offered as options — a row whose category is a section name, genre tag,
// or other non-award value (see Category.isAward /
// data/source/category-classifications.json) never appears here, though the
// underlying nomination/film data is untouched.
export function getCategoryOptions(rows: FestivalFilterRow[], filters: FestivalFilterState): string[] {
  const otherFilters: FestivalFilterState = { ...filters, categories: undefined };
  const scoped = filterNominations(rows, otherFilters);
  return [...new Set(scoped.filter((row) => row.categoryIsAward).map((row) => row.category))].sort();
}

// Genre options are scoped to every *other* active filter (year, result,
// category, ...) but never to `filters.genres` itself, mirroring
// getCategoryOptions — so the genre list narrows along with everything
// else (e.g. picking a year only shows genres actually present that year)
// without a selected genre hiding its own sibling options. Genre values
// come straight from Film.genres (already deduped/normalized at the data
// layer — see toGenres() in scripts/enrich-tmdb.mjs), so no further
// normalization is needed here; a film with no genres simply contributes
// nothing to this list.
export function getGenreOptions(rows: FestivalFilterRow[], filters: FestivalFilterState): string[] {
  const otherFilters: FestivalFilterState = { ...filters, genres: undefined };
  const scoped = filterNominations(rows, otherFilters);
  const genres = new Set<string>();
  for (const row of scoped) {
    for (const genre of row.genres) {
      if (genre) {
        genres.add(genre);
      }
    }
  }
  return [...genres].sort();
}

export type FestivalGroup = {
  festivalId: string;
  festivalName: string;
  entries: Nomination[];
};

// Used by the film detail page to present a movie's full cross-festival
// history grouped by festival rather than as one flat chronological list.
// Group order follows first-occurrence order of each festivalId; callers
// pass nominations already sorted by year descending (getNominationsByImdbId),
// so groups surface a film's most recently active festival first.
export function groupNominationsByFestival(nominations: Nomination[]): FestivalGroup[] {
  const groups = new Map<string, FestivalGroup>();

  for (const nomination of nominations) {
    let group = groups.get(nomination.festivalId);
    if (!group) {
      group = { festivalId: nomination.festivalId, festivalName: nomination.festivalName, entries: [] };
      groups.set(nomination.festivalId, group);
    }
    group.entries.push(nomination);
  }

  return [...groups.values()];
}

