"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Poster } from "./poster";
import {
  filterNominations,
  getFacetOptions,
  type FestivalFilterRow,
  type FestivalFilterState,
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
export function FestivalFilters({ rows }: { rows: FestivalFilterRow[] }) {
  const [filters, setFilters] = useState<FestivalFilterState>({});
  const [isOpen, setIsOpen] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const facets = useMemo(() => getFacetOptions(rows), [rows]);
  const filtered = useMemo(() => filterNominations(rows, filters), [rows, filters]);
  const visible = filtered.slice(0, visibleCount);
  const useCountryPills = facets.countries.length <= COUNTRY_PILL_THRESHOLD;
  const hasActiveFilters = Boolean(filters.result || filters.runtime || filters.year !== undefined || filters.country);

  function updateFilters(next: FestivalFilterState) {
    setVisibleCount(PAGE_SIZE);
    setFilters(next);
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
            {filtered.length} of {rows.length} records
          </p>
        </div>

        {isOpen ? (
          <div id="festival-filter-panel" className="mt-4 flex flex-col gap-4">
            <FilterGroup label="Award status">
              <Pill active={!filters.result} onClick={() => updateFilters({ ...filters, result: undefined })}>
                All
              </Pill>
              <Pill active={filters.result === "winner"} onClick={() => updateFilters({ ...filters, result: "winner" })}>
                Winners
              </Pill>
              <Pill active={filters.result === "nominee"} onClick={() => updateFilters({ ...filters, result: "nominee" })}>
                Nominees
              </Pill>
            </FilterGroup>

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
          <p className="meta text-xs text-bone/60">No records match the selected filters</p>
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
            {visible.map((row) => (
              <FestivalResultCard key={row.nominationId} row={row} />
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

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`focus-ring meta rounded-full border px-3 py-1 text-xs transition ${
        active ? "border-gold/60 bg-gold/20 text-gold" : "border-bone/20 text-bone/80 hover:border-bone/40"
      }`}
    >
      {active ? <span aria-hidden="true">{"✓ "}</span> : null}
      {children}
    </button>
  );
}

function FestivalResultCard({ row }: { row: FestivalFilterRow }) {
  return (
    <article className="texture rounded-xl border border-bone/15 bg-charcoal/70 p-4 transition hover:-translate-y-1 hover:border-gold/60">
      <Poster posterUrl={row.posterUrl} alt={row.title} variant="card" />
      <p className="meta mt-3 text-xs text-bone/60">{row.year}</p>
      <h3 className="cinematic-title mt-1 text-2xl text-bone">{row.title}</h3>
      <p className="mt-2 text-bone/80">{row.director || "Unknown director"}</p>
      {row.genres.length ? <p className="mt-2 text-sm text-bone/65">{row.genres.slice(0, 2).join(" / ")}</p> : null}
      <p className="meta mt-4 text-xs text-silver">{row.category}</p>
      <div className="mt-4 flex items-center justify-between">
        <span className={`meta rounded-full px-3 py-1 text-xs ${row.result === "winner" ? "bg-gold/20 text-gold" : "bg-bone/10 text-bone/80"}`}>
          {row.result}
        </span>
        {row.imdbId ? (
          <Link href={`/film/${row.imdbId}`} className="focus-ring meta text-xs text-bone/90 underline decoration-bone/60 underline-offset-4">
            Details
          </Link>
        ) : (
          <span className="meta text-xs text-silver">Details unavailable</span>
        )}
      </div>
    </article>
  );
}
