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

## Next Data Upgrades

- Add TMDB enrichment for posters/backdrops.
- Add Wikidata SPARQL import for historical completeness.
- Add confidence scoring and curator approval queue.
- Add relationship graph generation.
