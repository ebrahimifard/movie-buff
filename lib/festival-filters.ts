import type { Film, Nomination } from "./types";

export type RuntimeBucket = "under-90" | "90-120" | "over-120" | "unknown";

export type FestivalFilterRow = {
  nominationId: string;
  filmId: string;
  year: number;
  title: string;
  category: string;
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
export function buildFestivalFilterRows(nominations: Nomination[], filmsById: Map<string, Film>): FestivalFilterRow[] {
  return nominations.map((nomination) => {
    const film = filmsById.get(nomination.filmId);
    return {
      nominationId: nomination.id,
      filmId: nomination.filmId,
      year: nomination.year,
      title: nomination.title,
      category: nomination.category,
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
export function getCategoryOptions(rows: FestivalFilterRow[], filters: FestivalFilterState): string[] {
  const otherFilters: FestivalFilterState = { ...filters, categories: undefined };
  const scoped = filterNominations(rows, otherFilters);
  return [...new Set(scoped.map((row) => row.category))].sort();
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

