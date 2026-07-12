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

Data pipeline (all plain Node ESM scripts under `scripts/`, no build step) — commands, run order, and merge/pipeline internals are documented in `scripts/CLAUDE.md`, loaded automatically when working in that directory.

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

### Merge precedence, dedupe, and script conventions

Merge-order/dedupe rules, the dual-mode CLI/importable-module script pattern, and `scripts/lib/` utilities are documented in `scripts/CLAUDE.md`, loaded automatically when working in that directory.

### Testing conventions

Vitest only, co-located `*.test.ts`/`*.test.mjs` files next to source (see `vitest.config.mts`'s `include` globs — new test locations must be added there). Tests only exercise pure, exported functions — no live network calls, no real file I/O against the actual `data/` directory, no mocking frameworks beyond `vi.stubGlobal`/`vi.useFakeTimers`. `lib/data.ts`'s query functions are tested by `vi.mock`-ing the JSON imports with small fixture arrays, not the real dataset.

### Extensibility (designed for, not yet populated)

`Person.roles` supports `"director" | "writer" | "cast" | "producer"` but only `"director"` is ever sourced today. `Nomination.credits?: { personId, role }[]` is the generalized future join for non-director credits — `director`/`directorIds` stay as dedicated fields (a `role: "director"` specialization) for backward compatibility, don't add new bespoke `writerIds`/`castIds` arrays. `Film.productionCompanyIds`/`distributorIds` are reserved optional FK arrays for future lookup files. Genre/country/language are deliberately kept as denormalized `string[]` on `Film` rather than promoted to lookup tables — see `ARCHITECTURE.md`'s Extensibility section for the full reasoning before changing this.
