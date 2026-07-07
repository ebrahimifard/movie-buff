# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Movie Buff Archive — a static Next.js archive of film festival awards history (Oscars, Cannes, Venice, Berlinale, Locarno, Sundance, TIFF, BAFTA, Golden Globes). Positioned as an art-directed historical database for cinephiles, not a mainstream recommendation app. There is **no database, no API routes, no backend runtime** — the site statically imports JSON files at build time.

## Commands

```bash
npm install
npm run dev              # Next.js dev server
npm run build             # production build (also runs type-checking)
npm run lint               # next lint (flat config: eslint.config.mjs)
npm test                   # vitest run — full suite
npm run test:watch         # vitest watch mode
npx vitest run scripts/merge-sources.test.mjs   # single test file
npx tsc --noEmit            # type-check only, no build
```

Data pipeline (all plain Node ESM scripts under `scripts/`, no build step):

```bash
npm run data:collect        # orchestrator: wikidata fetch -> merge -> tmdb enrich
npm run data:fetch:wikidata
npm run data:merge
npm run data:enrich:tmdb    # requires TMDB_API_KEY (local .env or real env var)
npm run data:build          # regenerates all data/normalized/*.json from data/source
npm run data:validate       # zod schema + referential-integrity check — run this after data:build
npm run data:coverage       # per-festival missing/weak year report
npm run data:update         # sorts/reformats normalized JSON for clean diffs
```

Routine local pipeline run: `data:collect` → `data:build` → `data:validate` → `data:coverage` → `data:update`.

Occasional (manual, NOT part of `data:collect` or CI) Wikipedia data-completeness pass — see README for the full two-pass command sequence and why BAFTA's scraper needs a coverage report generated *before* it runs: `data:fetch:cannes-wikipedia`, `data:fetch:golden-globes-wikipedia`, `data:fetch:bafta-wikipedia`, then re-run `data:merge` → `data:build` → `data:validate` → `data:coverage` → `data:update`.

## Architecture

### Data flow (source of truth is a chain of scripts, not a database)

```
data/source/master-data.json (hand-curated seed)
data/source/wikidata-awards.json (SPARQL scrape, via fetch-wikidata-awards.mjs)
data/source/{cannes,golden-globes,bafta}-wikipedia.json (optional, manual scrapes)
        │  merge-sources.mjs  (two-tier dedupe, see below)
        ▼
data/source/master-data.generated.json
        │  enrich-tmdb.mjs (optional, needs TMDB_API_KEY; fills poster/runtime/genres/synopsis)
        │  build-comprehensive-data.mjs
        ▼
data/normalized/{festivals,ceremonies,categories,films,people,nominations,manifest}.json
        │  lib/data.ts imports these directly (Next.js bundles JSON at build time)
        ▼
app/*  (Next.js App Router, statically generated, generateStaticParams everywhere)
```

`data/normalized/*.json` is the only thing the Next.js app reads. Everything upstream of it is a build-time concern, not a runtime one.

### Types and validation are schema-derived, not hand-duplicated

`lib/schemas.mjs` defines zod schemas for all 6 normalized entities (Festival, Ceremony, Category, Person, Film, Nomination) plus the shared `IMDB_ID_PATTERN` regex. `lib/types.ts` derives TypeScript types from those schemas via `z.infer<>` — don't hand-write a type here; add/change the zod schema instead. `lib/data.ts` re-exports the types and holds the JSON-import + query-function layer (`getYears`, `getByYear`, `getFestivalBySlug`, etc.) — pages should only ever import from `@/lib/data`, not from `lib/schemas.mjs` or `lib/types.ts` directly.

`scripts/validate-data.mjs` validates every normalized file against these same schemas plus cross-file referential integrity (every FK — `festivalId`, `ceremonyId`, `categoryId`, `filmId`, `directorIds[]` — must resolve to a real record). Run it after any manual edit to `data/normalized/` or after `data:build`; both CI workflows run it automatically.

### Merge precedence and the two-tier dedupe index (`scripts/merge-sources.mjs`)

Sources merge in a fixed order — seed → Wikidata → Cannes/Golden-Globes/BAFTA Wikipedia (each optional, `existsSync`-guarded) — with **earlier-merged source wins on field conflicts** (`mergeFilm`'s "primary wins, secondary only fills empty fields" semantics). Records are keyed by `buildRecordKey` (imdb ID when present, else a slugified title) for the primary index, but Wikipedia-sourced records never have an imdbId, so a **second, title-only index** (`buildSlugKey`) is checked as a fallback *only* when the candidate itself lacks an imdbId — this lets a Wikipedia record merge into an existing imdbId-keyed record instead of duplicating it, without ever letting an imdbId-bearing candidate get fuzzy-matched by title alone (which would risk merging distinct films that share a title, e.g. remakes). Known limitation: category *names* aren't cross-source-normalized, so the same real-world award can still end up as two separate nomination rows if Wikidata's category string and a Wikipedia scraper's normalized category string don't match verbatim — there's no category crosswalk yet.

`build-comprehensive-data.mjs` resolves each film's normalized `id` via `resolveFilmId()`: imdbId if present, else a deterministic synthetic `film:{slug(title-year)}` — never `null` (a null-keyed film map previously caused silent collisions between distinct imdbId-less films).

### Pipeline scripts are dual-mode: CLI entry point *and* importable module

Every script in `scripts/*.mjs` exports its pure logic functions and guards its `run()` invocation behind `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { run().catch(...) }`. This means importing a script (e.g. from a test file) never triggers its side effects (network calls, file writes) — only running it directly via `node scripts/x.mjs` does. When adding a new script or extracting new logic from `run()`, preserve this pattern rather than putting side effects at module scope.

Shared pipeline utilities live in `scripts/lib/`: `http.mjs` (`fetchWithRetry` with backoff on 429/5xx, `DEFAULT_SCRAPE_DELAY_MS` for scraper politeness), `wikipedia-scrape.mjs` (shared parser for BAFTA/Golden Globes — handles both the modern "category grid" `{{Award category}}` template and the classic tabular/in-table-category-separator layouts; Cannes' page structure is different enough that it keeps its own bespoke parser in `fetch-cannes-wikipedia.mjs`), and `env.mjs` (`loadLocalEnv()` — a minimal `.env` loader for these standalone scripts, since Next.js's own dev/build auto-loads `.env` but plain `node scripts/x.mjs` doesn't; never overwrites a variable already in `process.env`, so CI-provided secrets always win over a local file).

### Testing conventions

Vitest only, co-located `*.test.ts`/`*.test.mjs` files next to source (see `vitest.config.mts`'s `include` globs — new test locations must be added there). Tests only exercise pure, exported functions — no live network calls, no real file I/O against the actual `data/` directory, no mocking frameworks beyond `vi.stubGlobal`/`vi.useFakeTimers`. `lib/data.ts`'s query functions are tested by `vi.mock`-ing the JSON imports with small fixture arrays, not the real dataset.

### Extensibility (designed for, not yet populated)

`Person.roles` supports `"director" | "writer" | "cast" | "producer"` but only `"director"` is ever sourced today. `Nomination.credits?: { personId, role }[]` is the generalized future join for non-director credits — `director`/`directorIds` stay as dedicated fields (a `role: "director"` specialization) for backward compatibility, don't add new bespoke `writerIds`/`castIds` arrays. `Film.productionCompanyIds`/`distributorIds` are reserved optional FK arrays for future lookup files. Genre/country/language are deliberately kept as denormalized `string[]` on `Film` rather than promoted to lookup tables — see `ARCHITECTURE.md`'s Extensibility section for the full reasoning before changing this.
