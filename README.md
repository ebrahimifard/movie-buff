# Movie Buff Archive

A premium, cinephile-first historical archive of film festivals and awards.

## Vision

Movie Buff Archive is designed as a digital cinematheque for serious film enthusiasts, combining archival rigor with avant-garde visual design.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS + custom cinematic design tokens
- Framer Motion for controlled transitions
- JSON canonical dataset for zero-cost MVP
- GitHub Actions for monthly updates
- Vercel for automatic deployment from GitHub

## Core Routes

- `/` homepage with year explorer and festival constellation
- `/year/[year]` archive view with filters
- `/festival/[slug]` festival-focused records
- `/film/[imdbId]` detailed film dossier with archive references

## Data Model

Primary normalized files live in `data/normalized/`:

- `festivals.json`
- `ceremonies.json`
- `categories.json`
- `films.json`
- `people.json`
- `nominations.json`
- `manifest.json`

Source editorial records live in `data/source/master-data.json`.

Build normalized dataset:

```bash
npm run data:build
```

Each nomination record contains:

- year
- festival
- category
- film title
- director
- winner/nominee status
- IMDb ID

Each film record additionally contains:

- runtime
- genres
- languages
- synopsis
- poster URL

## Local Development

```bash
npm install
npm run dev
```

## Deployment (GitHub -> Vercel)

1. Create a GitHub repository and push this project.
2. Import repository into Vercel.
3. Keep build settings default for Next.js.
4. Every push to `main` auto-deploys.

## Automated Data Updates

Workflow: `.github/workflows/update-data.yml`

- Runs monthly on schedule
- Executes `npm run data:collect`, `npm run data:build`, and `npm run data:update`
- Opens PR with dataset refresh

You can trigger it manually via **Run workflow** in GitHub Actions.

## Systematic API Pipeline

The project now includes a multi-stage data pipeline to collect and expand records automatically:

1. `npm run data:fetch:wikidata`
	- Resolves award entities from Wikidata by label.
	- Pulls both nominees and winners by award with year, IMDb ID, directors, and countries.
2. `npm run data:merge`
	- Merges fetched records with curated seed data.
	- De-duplicates by festival + year + category + film identity.
	- Promotes `winner` when both nominee and winner variants exist for the same record.
3. `npm run data:enrich:tmdb`
	- Enriches films by IMDb ID (poster, runtime, genres, languages, synopsis).
	- Requires `TMDB_API_KEY`.
4. `npm run data:build`
	- Compiles normalized datasets (`films`, `people`, `ceremonies`, `nominations`, etc.).
5. `npm run data:coverage`
	- Computes per-festival yearly coverage, including missing and weak years.
6. `npm run data:update`
	- Sorts and normalizes JSON formatting for clean diffs.

Run the full pipeline locally:

```bash
npm run data:collect
npm run data:build
npm run data:coverage
npm run data:update
```

## Occasional: Wikipedia Data-Completeness Pass

Beyond the routine monthly pipeline, three additional sources — Cannes, Golden Globes, and BAFTA Wikipedia scrapers — can fill in festival-years the Wikidata/TMDB pipeline is missing or weak on. These are **not** part of `npm run data:collect` and do **not** run automatically: historical years rarely change once filled, so re-scraping Wikipedia every month would add load for little benefit. Run this manually, occasionally:

```bash
# 1. Ensure normalized data + coverage report are current
#    (BAFTA's scraper reads coverage-report.json to pick which years to target)
npm run data:build
npm run data:coverage

# 2. Scrape Wikipedia sources
npm run data:fetch:cannes-wikipedia
npm run data:fetch:golden-globes-wikipedia
npm run data:fetch:bafta-wikipedia

# 3. Re-merge, rebuild, validate, and refresh coverage to incorporate the new data
npm run data:merge
npm run data:build
npm run data:validate
npm run data:coverage
npm run data:update
```

Why two passes: BAFTA's scraper only targets years flagged `missingYears`/`weakYears` in `coverage-report.json`, so that report must be current *before* running it (step 1); afterward, coverage is regenerated again (step 3) to reflect the newly-added data. Step 3 uses `data:merge`, not `data:collect` — there's no need to re-hit the live Wikidata endpoint just to pick up the Wikipedia JSON already sitting on disk. `merge-sources.mjs` reads these three source files only if present (each is optional), matching them against existing seed/Wikidata records by IMDb ID when available and falling back to a title match otherwise — see `ARCHITECTURE.md` for the merge precedence.

## Next Data Upgrades

- Add TMDB enrichment for posters/backdrops.
- Add Wikidata SPARQL import for historical completeness.
- Add confidence scoring and curator approval queue.
- Add relationship graph generation.
