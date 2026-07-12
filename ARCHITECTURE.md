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

## Data Quality: Movies, Not People

Wikipedia-sourced individual-award categories (Best Actor, Best Director, Best Screenplay,
career/honorary awards, ...) describe a *person* first in the source text, which created a
recurring class of bug: a person's name ending up as `Nomination.title`/`Film.title` instead
of the film they were actually being honored for. `scripts/lib/wikipedia-scrape.mjs` (shared
by Golden Globes/BAFTA/Berlinale/Venice) and `scripts/fetch-cannes-wikipedia.mjs` (Cannes'
bespoke parser) both guard against this the same way:

- **`extractTitleAndPerson`**: Wikipedia italicizes creative-work titles (MOS:TITLE) but
  never a person's name — true regardless of display order ("Person – Film" vs. older
  "Film – Person" conventions). The italicized link is always preferred as the film; a
  non-italicized link is captured separately as `personName`, never as the title.
- **`hasFilmSignal`**: threaded alongside `personName` through every extraction path —
  `true` only when the title genuinely came from italics, `false` when it fell back to "the
  only link/text available" (a weak, position-based guess).
- **`classifyPersonRole(category)`**: maps a category name to `"director" | "cast" |
  "writer" | "producer" | null`. A director-role person is written into the existing
  `Nomination.director` / `directorIds` fields; cast/writer/producer roles populate
  `Nomination.credits: { personId, role }[]` — both already-existing schema fields, now
  actually populated by the Wikipedia scrapers (previously only `director`/`directorIds`
  were sourced, and only from Wikidata). The film detail page surfaces these as "Starring:
  X" / "Written by: X" metadata beneath the relevant award row — the person is never the
  primary result, only metadata on the film's own record.
- **`isHonoraryCategory(category)`**: career/honorary awards (Honorary Golden Bear, Golden
  Lion for Lifetime Achievement, Academy Honorary Award, ...) are given directly to a person
  for their body of work — the source text is often just the honoree's bare name with no
  film mentioned at all. Combined with `hasFilmSignal`: when a category matches this *and*
  no genuine film signal was found, the record is dropped entirely rather than fabricating a
  movie from the honoree's name. Categories that DO carry a real film signal are kept (a
  handful of older Academy Honorary Awards were given to a specific foreign-language film
  before a competitive category existed for it — these are legitimately film-tied).
- **`NON_AWARD_SECTION_PATTERN` + `getSectionAncestors`**: some Wikipedia sections are
  structurally identical to real award data (a heading followed by a `<ul>`, or a
  `table.wikitable`) but never contain it — References/Sources citation lists, Trivia,
  Ceremony/Presenters listings, Golden Globes' "Awards breakdown" statistics tables and
  "Television" sections (a dual-medium page whose non-film awards don't belong in a
  film-festival archive), "Multiple nominations"/"Multiple wins" summary tables. Excluding
  these by heading name alone is fragile if only the *nearest* heading is checked — Golden
  Globes' "Awards breakdown" section has its own "Films"/"Television" H3 subheadings that
  would otherwise be confused with the real "Winners and nominees > Film" section just
  because the nearest heading text matches. `getSectionAncestors` walks the *full* enclosing
  heading chain (not just the nearest one) so a table or list can be told apart by its
  complete path, not a single ambiguous heading string.

## Extensibility

The normalized data model is designed so the following entities can be added without restructuring existing files.

- **Writer / Cast / Producer credits**: `Person.roles` supports `"writer" | "cast" | "producer"` alongside `"director"`, and `Nomination.credits: { personId, role }[]` is populated by the Wikipedia scrapers for individual-award categories (see "Data Quality: Movies, Not People" above) — `Nomination.director` / `directorIds` remain as dedicated fields for backward compatibility with existing pages, treated as the `role: "director"` specialization of `credits`, not a separate concept. Not yet sourced from Wikidata directly (Wikidata's film-anchored SPARQL queries in `scripts/fetch-wikidata-awards.mjs` only ever populate `directors`).
- **Full film credits** (cast/crew independent of any specific award): a future `data/normalized/credits.json` join table (`{ id, filmId, personId, role, character?, billingOrder? }`), following the same `people.json`-by-id reference pattern used everywhere else.
- **Production companies / distributors**: `Film.productionCompanyIds` / `distributorIds` (optional `string[]`) are reserved for FK arrays into future `data/normalized/production-companies.json` / `distributors.json` lookup files (`{ id, name, countryCode }`).
- **Screenings**: a future `data/normalized/screenings.json` (`{ id, filmId, ceremonyId, program, date, venue }`) would capture non-competitive/non-award screenings (e.g. "Un Certain Regard") that the current award-centric `Nomination` model doesn't represent.
- **Genre / Country / Language**: intentionally kept as denormalized `string[]` on `Film` rather than promoted to lookup tables — they carry no metadata beyond a label today. Revisit only if they need attached metadata (e.g. canonical ISO codes, translations) or need to become first-class browsing routes (e.g. `/country/us`).
- **`Festival.website`** and **`Person.tmdbId`** are reserved, currently-null fields for near-term features (official festival links; future TMDB person enrichment) rather than dead code.

## Filtering & Category Labels

`lib/festival-filters.ts`'s filter panel (result, runtime, year, country, category, genre) is
all plain in-memory `useState`, not URL-synced — see the comment at the top of
`components/festival-filters.tsx` for why (a `useSearchParams()`-based filter would force the
component behind a Suspense boundary whose fallback is what actually ships in this fully
static site's prerendered HTML). Category and genre options are both computed by
`getCategoryOptions`/`getGenreOptions`, scoped to every *other* active filter but never to
their own dimension — so picking a year narrows the category/genre list, but picking a
category doesn't hide its own sibling options. `lib/category-labels.ts`'s
`simplifyCategoryLabel` strips a festival's own redundant institutional-name prefix/suffix
from a category's *display* label only ("Academy Award for Best Actor" → "Best Actor") —
`Nomination.category` and `Category.name` are never mutated, so the full name is always
still there (shown via a `title` tooltip on the rendered chip/pill).

## Data Corrections

`lib/missing-info.ts` builds a pre-filled link to this repo's structured
`.github/ISSUE_TEMPLATE/data-correction.yml` GitHub Issue Form whenever a film is missing a
poster/IMDb link/runtime/genres/synopsis, or a user wants to report something else wrong.
There is no automated import path — see `CONTRIBUTING.md` for the manual review-and-apply
workflow (a maintainer verifies the cited source, then edits `data/source/master-data.json`,
which always wins over the automated sources on the next merge).
