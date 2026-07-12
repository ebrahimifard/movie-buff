# scripts/CLAUDE.md

Guidance specific to the data pipeline scripts in this directory. See the project root `CLAUDE.md` for the app-wide overview.

## Data pipeline commands

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

## Merge precedence and the two-tier dedupe index (`scripts/merge-sources.mjs`)

Sources merge in a fixed order — seed → Wikidata → Cannes/Golden-Globes/BAFTA Wikipedia (each optional, `existsSync`-guarded) — with **earlier-merged source wins on field conflicts** (`mergeFilm`'s "primary wins, secondary only fills empty fields" semantics). Records are keyed by `buildRecordKey` (imdb ID when present, else a slugified title) for the primary index, but Wikipedia-sourced records never have an imdbId, so a **second, title-only index** (`buildSlugKey`) is checked as a fallback *only* when the candidate itself lacks an imdbId — this lets a Wikipedia record merge into an existing imdbId-keyed record instead of duplicating it, without ever letting an imdbId-bearing candidate get fuzzy-matched by title alone (which would risk merging distinct films that share a title, e.g. remakes). Known limitation: category *names* aren't cross-source-normalized, so the same real-world award can still end up as two separate nomination rows if Wikidata's category string and a Wikipedia scraper's normalized category string don't match verbatim — there's no category crosswalk yet.

`build-comprehensive-data.mjs` resolves each film's normalized `id` via `resolveFilmId()`: imdbId if present, else a deterministic synthetic `film:{slug(title-year)}` — never `null` (a null-keyed film map previously caused silent collisions between distinct imdbId-less films).

## Pipeline scripts are dual-mode: CLI entry point *and* importable module

Every script in `scripts/*.mjs` exports its pure logic functions and guards its `run()` invocation behind `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { run().catch(...) }`. This means importing a script (e.g. from a test file) never triggers its side effects (network calls, file writes) — only running it directly via `node scripts/x.mjs` does. When adding a new script or extracting new logic from `run()`, preserve this pattern rather than putting side effects at module scope.

Shared pipeline utilities live in `scripts/lib/`: `http.mjs` (`fetchWithRetry` with backoff on 429/5xx, `DEFAULT_SCRAPE_DELAY_MS` for scraper politeness), `wikipedia-scrape.mjs` (shared parser for BAFTA/Golden Globes — handles both the modern "category grid" `{{Award category}}` template and the classic tabular/in-table-category-separator layouts; Cannes' page structure is different enough that it keeps its own bespoke parser in `fetch-cannes-wikipedia.mjs`), and `env.mjs` (`loadLocalEnv()` — a minimal `.env` loader for these standalone scripts, since Next.js's own dev/build auto-loads `.env` but plain `node scripts/x.mjs` doesn't; never overwrites a variable already in `process.env`, so CI-provided secrets always win over a local file).
