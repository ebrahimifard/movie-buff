"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Poster } from "./poster";
import { simplifyCategoryLabel } from "@/lib/category-labels";
import { buildMissingInfoIssueUrl } from "@/lib/missing-info";
import {
  filterNominations,
  getCategoryOptions,
  getFacetOptions,
  getGenreOptions,
  groupRowsByFilm,
  type FestivalFilterRow,
  type FestivalFilterState,
  type FestivalMovieGroup,
  type RuntimeBucket
} from "@/lib/festival-filters";

const PAGE_SIZE = 60;
const COUNTRY_PILL_THRESHOLD = 12;

const RUNTIME_OPTIONS: { value: RuntimeBucket; label: string }[] = [
  { value: "under-90", label: "Under 90 min" },
  { value: "90-120", label: "90–120 min" },
  { value: "over-120", label: "Over 120 min" },
  { value: "unknown", label: "Unknown runtime" }
];

// Filter state deliberately lives in plain component state, not the URL.
// useSearchParams() would force this component behind a Suspense boundary
// whose fallback is what actually ships in the static HTML (this is a fully
// static site, generateStaticParams-only, no per-request server) — meaning
// the real results grid would never appear in the prerendered page at all,
// only after client hydration. Plain state keeps the grid part of the
// static output and avoids that trap, at the cost of filter state not
// surviving a full page reload or being independently bookmarkable.
export function FestivalFilters({
  rows,
  festivalId,
  festivalName
}: {
  rows: FestivalFilterRow[];
  festivalId: string;
  festivalName: string;
}) {
  const [filters, setFilters] = useState<FestivalFilterState>({});
  const [isOpen, setIsOpen] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const facets = useMemo(() => getFacetOptions(rows), [rows]);
  const categoryOptions = useMemo(() => getCategoryOptions(rows, filters), [rows, filters]);
  const genreOptions = useMemo(() => getGenreOptions(rows, filters), [rows, filters]);

  // Every movie's card, built once from the full row set. Filters (below)
  // only decide which of these groups are visible — a card's badges and
  // category list always reflect the movie's complete record at this
  // festival, not just the rows that happen to match the active filters.
  const allGroups = useMemo(() => groupRowsByFilm(rows), [rows]);
  const filteredRows = useMemo(() => filterNominations(rows, filters), [rows, filters]);
  const qualifyingFilmIds = useMemo(() => new Set(filteredRows.map((row) => row.filmId)), [filteredRows]);
  const filtered = useMemo(() => allGroups.filter((group) => qualifyingFilmIds.has(group.filmId)), [allGroups, qualifyingFilmIds]);

  const visible = filtered.slice(0, visibleCount);
  const useCountryPills = facets.countries.length <= COUNTRY_PILL_THRESHOLD;
  const hasActiveFilters = Boolean(
    filters.result ||
      filters.runtime ||
      filters.year !== undefined ||
      filters.country ||
      (filters.categories && filters.categories.length > 0) ||
      (filters.genres && filters.genres.length > 0)
  );

  function updateFilters(next: FestivalFilterState) {
    setVisibleCount(PAGE_SIZE);
    setFilters(next);
  }

  function toggleCategory(category: string) {
    const current = filters.categories ?? [];
    const next = current.includes(category) ? current.filter((entry) => entry !== category) : [...current, category];
    updateFilters({ ...filters, categories: next.length > 0 ? next : undefined });
  }

  function toggleGenre(genre: string) {
    const current = filters.genres ?? [];
    const next = current.includes(genre) ? current.filter((entry) => entry !== genre) : [...current, genre];
    updateFilters({ ...filters, genres: next.length > 0 ? next : undefined });
  }

  return (
    <div>
      <section className="mt-8 rounded-xl border border-bone/15 bg-charcoal/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            aria-controls="festival-filter-panel"
            className="focus-ring meta flex items-center gap-2 text-xs text-bone/70"
          >
            <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
            Filters
          </button>
          <p className="meta text-xs text-bone/60">
            {filtered.length} of {allGroups.length} movies
          </p>
        </div>

        {isOpen ? (
          <div id="festival-filter-panel" className="mt-4 flex flex-col gap-4">
            <FilterGroup label="Award status">
              <Pill active={!filters.result} onClick={() => updateFilters({ ...filters, result: undefined })}>
                All
              </Pill>
              <Pill active={filters.result === "winner"} onClick={() => updateFilters({ ...filters, result: "winner" })}>
                Winners only
              </Pill>
              <Pill active={filters.result === "nominee"} onClick={() => updateFilters({ ...filters, result: "nominee" })}>
                Nominations only
              </Pill>
            </FilterGroup>

            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="meta text-xs text-bone/60">Category</p>
                {filters.categories && filters.categories.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => updateFilters({ ...filters, categories: undefined })}
                    className="focus-ring meta text-xs text-gold underline decoration-gold/70 underline-offset-4"
                  >
                    All categories
                  </button>
                ) : null}
              </div>
              <div className="mt-2 flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-md border border-bone/10 bg-obsidian/40 p-2">
                {categoryOptions.length === 0 ? (
                  <p className="meta px-1 py-1 text-xs text-bone/50">No categories match the current filters</p>
                ) : (
                  categoryOptions.map((category) => (
                    <Pill
                      key={category}
                      active={Boolean(filters.categories?.includes(category))}
                      onClick={() => toggleCategory(category)}
                      title={category}
                    >
                      {simplifyCategoryLabel(category, festivalId)}
                    </Pill>
                  ))
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="meta text-xs text-bone/60">Genre</p>
                {filters.genres && filters.genres.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => updateFilters({ ...filters, genres: undefined })}
                    className="focus-ring meta text-xs text-gold underline decoration-gold/70 underline-offset-4"
                  >
                    All genres
                  </button>
                ) : null}
              </div>
              <div className="mt-2 flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-md border border-bone/10 bg-obsidian/40 p-2">
                {genreOptions.length === 0 ? (
                  <p className="meta px-1 py-1 text-xs text-bone/50">No genres match the current filters</p>
                ) : (
                  genreOptions.map((genre) => (
                    <Pill key={genre} active={Boolean(filters.genres?.includes(genre))} onClick={() => toggleGenre(genre)}>
                      {genre}
                    </Pill>
                  ))
                )}
              </div>
            </div>

            <FilterGroup label="Runtime">
              <Pill active={!filters.runtime} onClick={() => updateFilters({ ...filters, runtime: undefined })}>
                All runtimes
              </Pill>
              {RUNTIME_OPTIONS.map((option) => (
                <Pill key={option.value} active={filters.runtime === option.value} onClick={() => updateFilters({ ...filters, runtime: option.value })}>
                  {option.label}
                </Pill>
              ))}
            </FilterGroup>

            {useCountryPills ? (
              <FilterGroup label="Country">
                <Pill active={!filters.country} onClick={() => updateFilters({ ...filters, country: undefined })}>
                  All countries
                </Pill>
                {facets.countries.map((country) => (
                  <Pill key={country} active={filters.country === country} onClick={() => updateFilters({ ...filters, country })}>
                    {country}
                  </Pill>
                ))}
              </FilterGroup>
            ) : null}

            <div className="flex flex-wrap gap-4">
              <label className="flex flex-col gap-1">
                <span className="meta text-xs text-bone/60">Year</span>
                <select
                  className="focus-ring rounded-md border border-bone/20 bg-obsidian px-3 py-2 text-sm text-bone"
                  value={filters.year ?? ""}
                  onChange={(event) => updateFilters({ ...filters, year: event.target.value ? Number(event.target.value) : undefined })}
                >
                  <option value="">All years</option>
                  {facets.years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>

              {useCountryPills ? null : (
                <label className="flex flex-col gap-1">
                  <span className="meta text-xs text-bone/60">Country</span>
                  <select
                    className="focus-ring rounded-md border border-bone/20 bg-obsidian px-3 py-2 text-sm text-bone"
                    value={filters.country ?? ""}
                    onChange={(event) => updateFilters({ ...filters, country: event.target.value || undefined })}
                  >
                    <option value="">All countries</option>
                    {facets.countries.map((country) => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {hasActiveFilters ? (
              <button
                type="button"
                onClick={() => updateFilters({})}
                className="focus-ring meta self-start text-xs text-gold underline decoration-gold/70 underline-offset-4"
              >
                Reset filters
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {filtered.length === 0 ? (
        <div className="texture mt-8 rounded-xl border border-bone/15 bg-charcoal/60 p-10 text-center">
          <p className="meta text-xs text-bone/60">No movies match the selected filters</p>
          <button
            type="button"
            onClick={() => updateFilters({})}
            className="focus-ring meta mt-3 text-xs text-gold underline decoration-gold/70 underline-offset-4"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <>
          <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((group) => (
              <FestivalMovieCard key={group.filmId} group={group} festivalId={festivalId} festivalName={festivalName} />
            ))}
          </section>

          {visibleCount < filtered.length ? (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                className="focus-ring meta rounded-full border border-bone/30 px-5 py-2 text-xs text-bone/80 hover:border-gold/60"
              >
                Load more ({filtered.length - visibleCount} remaining)
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="meta text-xs text-bone/60">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Pill({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`focus-ring meta rounded-full border px-3 py-1 text-xs transition ${
        active ? "border-gold/60 bg-gold/20 text-gold" : "border-bone/20 text-bone/80 hover:border-bone/40"
      }`}
    >
      {active ? <span aria-hidden="true">{"✓ "}</span> : null}
      {children}
    </button>
  );
}

const MAX_VISIBLE_CATEGORY_CHIPS = 3;

function CategoryChip({ entry, festivalId }: { entry: { category: string; result: "winner" | "nominee" }; festivalId: string }) {
  return (
    <span
      title={entry.category}
      className={`meta rounded-full border px-2 py-0.5 text-[11px] ${
        entry.result === "winner" ? "border-gold/50 text-gold" : "border-bone/20 text-bone/70"
      }`}
    >
      {simplifyCategoryLabel(entry.category, festivalId)}
    </span>
  );
}

// One card per movie (see groupRowsByFilm). Card size stays bounded
// regardless of nomination count: at most MAX_VISIBLE_CATEGORY_CHIPS
// category chips render inline, with any remainder tucked behind a native
// <details> disclosure rather than growing the card.
function FestivalMovieCard({
  group,
  festivalId,
  festivalName
}: {
  group: FestivalMovieGroup;
  festivalId: string;
  festivalName: string;
}) {
  const visibleCategories = group.categories.slice(0, MAX_VISIBLE_CATEGORY_CHIPS);
  const overflowCategories = group.categories.slice(MAX_VISIBLE_CATEGORY_CHIPS);
  const yearLabel = group.years.length > 1 ? `${group.years[group.years.length - 1]}–${group.years[0]}` : String(group.year);

  const missingFields = [
    !group.imdbId ? "IMDb link" : null,
    !group.posterUrl || !group.posterUrl.startsWith("/posters/") ? "poster" : null,
    !group.runtimeMinutes ? "runtime" : null
  ].filter((field): field is string => field !== null);

  return (
    <article className="texture rounded-xl border border-bone/15 bg-charcoal/70 p-4 transition hover:-translate-y-1 hover:border-gold/60">
      <Poster posterUrl={group.posterUrl} alt={group.title} variant="card" />
      <p className="meta mt-3 text-xs text-bone/60">{yearLabel}</p>
      <h3 className="cinematic-title mt-1 text-2xl text-bone">{group.title}</h3>
      <p className="mt-2 text-bone/80">{group.director || "Unknown director"}</p>
      {group.genres.length ? <p className="mt-2 text-sm text-bone/65">{group.genres.slice(0, 2).join(" / ")}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {group.winCount > 0 ? (
          <span className="meta rounded-full bg-gold/20 px-3 py-1 text-xs text-gold">
            {group.winCount} win{group.winCount === 1 ? "" : "s"}
          </span>
        ) : null}
        {group.nomineeCount > 0 ? (
          <span className="meta rounded-full bg-bone/10 px-3 py-1 text-xs text-bone/80">
            {group.nomineeCount} nomination{group.nomineeCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {visibleCategories.map((entry) => (
          <CategoryChip key={`${entry.category}-${entry.result}`} entry={entry} festivalId={festivalId} />
        ))}
        {overflowCategories.length > 0 ? (
          <details className="inline-block">
            <summary className="focus-ring meta cursor-pointer list-none rounded-full border border-bone/20 px-2 py-0.5 text-[11px] text-bone/70 hover:border-gold/60">
              +{overflowCategories.length} more
            </summary>
            <div className="mt-2 flex w-full flex-wrap gap-1.5">
              {overflowCategories.map((entry) => (
                <CategoryChip key={`${entry.category}-${entry.result}`} entry={entry} festivalId={festivalId} />
              ))}
            </div>
          </details>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-end">
        {group.imdbId ? (
          <Link href={`/film/${group.imdbId}`} className="focus-ring meta text-xs text-bone/90 underline decoration-bone/60 underline-offset-4">
            Details
          </Link>
        ) : (
          <Link
            href={buildMissingInfoIssueUrl({
              title: group.title,
              year: group.year,
              festivalName,
              missingFields,
              internalId: group.filmId,
              pageUrl: `/festival/${festivalId}`
            })}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring meta text-xs text-silver underline decoration-silver/50 underline-offset-4"
          >
            Suggest a Change
          </Link>
        )}
      </div>
    </article>
  );
}
