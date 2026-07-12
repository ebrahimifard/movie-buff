# Contributing

## Reporting a data correction

Movie Buff Archive is a fully static site with no database and no backend — there is no
automated pipeline that accepts and imports a user-submitted correction directly. Every
correction goes through a human review step before it reaches the live data.

### How to submit one

Every movie card and film detail page shows a **"Suggest a correction"** link when a field
is missing (poster, IMDb link, runtime, genres, synopsis) or you've otherwise noticed
something wrong. It opens this repository's [Data correction issue form](../../issues/new?template=data-correction.yml),
pre-filled with the film's title, festival, year, category, its internal identifier, and
the page you found it on.

If you're reporting something the "Suggest a correction" link doesn't cover (a wrong
director, an incorrect year, a duplicate record, etc.), open the same
[Data correction](../../issues/new?template=data-correction.yml) form directly and fill in
the fields yourself.

**A source is required.** Acceptable sources are IMDb, the official festival website,
Wikipedia (with its own citation), or another primary/reputable reference. Issues without a
checkable source are unlikely to be reviewed — the entire point of requiring one is to keep
the archive from filling up with unverifiable guesses. "I think this is wrong" without a
citation will be asked to provide one before it's actioned.

### What happens after you submit it

1. A maintainer reads the issue and verifies the claim against the cited source.
2. If it checks out, the maintainer edits `data/source/master-data.json` — the hand-curated
   seed file — adding a new record or correcting the relevant field(s) on an existing one.
   Seed data always wins over the automated Wikidata/Wikipedia sources during the next merge
   (see `mergeFilm` in `scripts/merge-sources.mjs` and the "Merge precedence" section of
   `ARCHITECTURE.md`), so an edit here is guaranteed to stick rather than being silently
   overwritten by the next scheduled data refresh.
3. The maintainer re-runs the data pipeline (`npm run data:merge && npm run data:enrich:tmdb
   && npm run data:build && npm run data:posters && npm run data:validate && npm run
   data:coverage && npm run data:update` — see the README's "Systematic API Pipeline"
   section) and commits the result.
4. The issue is closed with a reference to the commit that applied the fix.

This is deliberately manual rather than an auto-merge bot: the archive's whole design
principle (see `ARCHITECTURE.md`'s merge-precedence notes) is that hand-curated seed data is
trusted precisely *because* a human checked it — automatically importing unverified issue
submissions would undermine that guarantee for every other record in the dataset.

### Why the internal identifier matters

Films are frequently ambiguous by title alone (remakes, same-title-different-year, films
with no unique English title). The "internal identifier" field in the correction form is
the film's IMDb ID when it has one, or its synthetic archive ID (`film:{slug}-{year}`)
when it doesn't — either way, it lets a maintainer find the *exact* record you mean without
guessing. Please don't remove it from the pre-filled form.

## Code changes

Standard PR workflow: fork, branch, `npm test && npx tsc --noEmit && npm run lint && npm run
build` before opening a PR. See `CLAUDE.md` for the data pipeline architecture and
`ARCHITECTURE.md` for the full data model and merge-precedence design.
