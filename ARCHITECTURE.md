# Architecture Overview

## Product Positioning

Movie Buff Archive is an art-directed historical database for serious cinema audiences, not a mainstream recommendation app.

## Runtime Architecture

1. Next.js App Router serves statically generated pages.
2. Canonical data is stored in `data/normalized` as JSON.
3. Utility functions in `lib/data.ts` provide query access for pages.
4. Dynamic routes are pre-rendered using static params for performance and SEO.

## Data Pipeline

1. Ingestion scripts in `scripts/` update and normalize datasets.
2. GitHub Actions job runs monthly and opens a PR for review.
3. Merge to `main` triggers Vercel auto-deploy.
4. `scripts/validate-data.mjs` (`npm run data:validate`) validates every normalized JSON file against the schemas in `lib/schemas.mjs` and checks cross-file referential integrity. It runs as part of the monthly pipeline and in CI — a failure here means bad data cannot reach `main`.
5. **Wikipedia sources (occasional, manual only):** `data/source/cannes-wikipedia.json`, `data/source/golden-globes-wikipedia.json`, `data/source/bafta-wikipedia.json`, `data/source/berlinale-wikipedia.json`, and `data/source/venice-wikipedia.json` are optional additional sources, populated by the corresponding `npm run data:fetch:*-wikipedia` script. `merge-sources.mjs` reads each file only if present (`existsSync`-guarded, iterating a `WIKIPEDIA_SOURCES` list — adding a new festival's scraper output is a one-line addition to that list) and merges it after Wikidata with `master > wikidata > wikipedia` precedence, using a two-tier dedupe index — an imdbId-keyed primary index (unchanged from the master/Wikidata merge) plus a title-slug-keyed fallback index used only for imdbId-less candidates (which Wikipedia records always are), so a Wikipedia-sourced record correctly merges into an existing imdbId-keyed record instead of creating a duplicate. These scripts are intentionally excluded from `npm run data:collect` and the monthly GitHub Actions workflow — see README's "Occasional: Wikipedia Data-Completeness Pass" for the manual command sequence. `data/source/berlin-wikipedia.json` and `data/source/fetch-berlin-wikipedia.mjs` are an unrelated, unfinished stub — not part of this pipeline.
6. **Local posters, no runtime external requests:** `scripts/download-posters.mjs` (`npm run data:posters`) downloads each film's poster from its TMDB-sourced remote URL into `public/posters/`, then rewrites `Film.posterUrl` to the local path — this is the *only* pipeline step that makes an external network call for images, and it never runs at request time. The site itself (`components/poster.tsx`) only ever renders a local `/posters/...` path via `next/image`; a `posterUrl` that's empty or still remote (a failed/not-yet-run download) falls through to an on-brand CSS placeholder rather than ever hot-linking a third-party image host. `next.config.ts` accordingly has no `images.remotePatterns` — there's nothing remote left to allow.
7. **`Festival.inactiveYears`** marks years a festival gave no award, so `scripts/coverage-report.mjs` doesn't misreport them as data gaps. Currently populated for: Venice (`1943–1945`, WWII wartime suspension; `1969–1979`, the Golden Lion was non-competitive in the years following the 1968 Cannes/Venice reform protests) and Cannes (`1968`, the festival was cancelled mid-edition during the May '68 protests). No other festival in this dataset has a documented award suspension in its founded-year range.

## Source Strategy

- Primary enrichment candidates: TMDB, Wikidata, official festival archives.
- IMDb links are generated from stored IMDb IDs.
- All imported records should carry source provenance and confidence score in future revisions.

## Scaling Plan

1. Keep JSON for MVP and curation speed.
2. Migrate to Supabase Postgres when records and relationships grow.
3. Add derived graph files for director-festival-film relationship views.

## Extensibility

The normalized data model is designed so the following entities can be added without restructuring existing files. None of these are populated yet — only `Person.roles` containing `"director"` is currently sourced.

- **Writer / Cast / Producer credits**: `Person.roles` already supports `"writer" | "cast" | "producer"` alongside `"director"`. Per-nomination credits generalize via the optional `Nomination.credits: { personId, role }[]` field. `Nomination.director` / `directorIds` remain as dedicated fields for backward compatibility with existing pages — treat them as the `role: "director"` specialization of `credits`, not a separate concept.
- **Full film credits** (cast/crew independent of any specific award): a future `data/normalized/credits.json` join table (`{ id, filmId, personId, role, character?, billingOrder? }`), following the same `people.json`-by-id reference pattern used everywhere else.
- **Production companies / distributors**: `Film.productionCompanyIds` / `distributorIds` (optional `string[]`) are reserved for FK arrays into future `data/normalized/production-companies.json` / `distributors.json` lookup files (`{ id, name, countryCode }`).
- **Screenings**: a future `data/normalized/screenings.json` (`{ id, filmId, ceremonyId, program, date, venue }`) would capture non-competitive/non-award screenings (e.g. "Un Certain Regard") that the current award-centric `Nomination` model doesn't represent.
- **Genre / Country / Language**: intentionally kept as denormalized `string[]` on `Film` rather than promoted to lookup tables — they carry no metadata beyond a label today. Revisit only if they need attached metadata (e.g. canonical ISO codes, translations) or need to become first-class browsing routes (e.g. `/country/us`).
- **`Festival.website`** and **`Person.tmdbId`** are reserved, currently-null fields for near-term features (official festival links; future TMDB person enrichment) rather than dead code.
