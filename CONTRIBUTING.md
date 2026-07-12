# Contributing

## Reporting a data correction

Movie Buff Archive is a fully static site with no database and no backend. Corrections to a
fixed, safe set of film fields are validated and applied **automatically**; everything else
still goes through a human review step, exactly as before.

### How to submit one

Every movie card and film detail page shows a **"Suggest a Change"** link. It opens this
repository's [Data correction issue form](../../issues/new?template=data-correction.yml),
pre-filled with the film's title, festival, year, its internal identifier, and the page you
found it on.

Pick the one field that's wrong from the **"What field is wrong?"** dropdown and give the
correct value in **"Proposed new value"**. If what you're reporting isn't one of the listed
fields (a wrong director, an incorrect award category, a duplicate record, etc.), choose
**"Something else"** and describe it in "Proposed new value" instead — a maintainer will read
and apply it by hand.

**A source is always required**, automated or not. Acceptable sources are IMDb, the official
festival website, Wikipedia (with its own citation), or another primary/reputable reference.
For an automated submission, the source must be a checkable `http(s)` link — validation fails
without one. "I think this is wrong" without a citation won't be actioned.

### What happens after you submit it — automated path

`.github/workflows/process-correction.yml` runs on every new or edited issue carrying the
`data-correction` label:

1. **Validate**: `scripts/import-correction.mjs` parses the issue's structured fields (never
   executes anything from the issue body — it's read as plain text) and checks required
   fields, per-field format/type (an IMDb ID must match `tt\d+`, a URL must be `http(s)`, a
   year/runtime must be in a plausible range, list fields must parse into non-empty items,
   etc.), that the referenced film actually exists in the archive, and that the change
   wouldn't create a duplicate (e.g. an IMDb ID already used by a different film). "Something
   else" always fails validation on purpose — it's how it's routed to manual review.
   - **If validation fails**: you get a comment explaining exactly what to fix, and the
     `needs-changes` label. Edit the issue and it's re-checked automatically — no need to
     open a new one.
2. **Apply and rebuild**: if valid, the script patches `data/source/master-data.json` (the
   same hand-curated seed file a maintainer would edit — seed data always wins over the
   automated Wikidata/Wikipedia sources on the next merge, see `ARCHITECTURE.md`'s
   merge-precedence notes), then the workflow runs the *exact* pipeline a maintainer runs by
   hand: `data:merge` → `data:build` → `data:posters` → `data:validate` → `data:coverage` →
   `data:update`.
3. **Scope guard**: the workflow hard-fails (no PR) if anything outside
   `data/source/master-data.json`, `data/source/master-data.generated.json`,
   `data/normalized/*.json`, or `public/posters/**` changed — this is what "automatic changes
   are limited to the movie-data files" actually enforces, independent of what the script is
   merely *supposed* to touch.
4. **Test**: `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run build` all run
   before anything is proposed — these are the same checks `verify-build.yml` runs on a
   normal PR (run inline here because a bot-authored PR doesn't trigger other workflows on
   GitHub).
5. **Pull request**: only if every step above passed, a PR is opened (never a direct push to
   `main`) with the single field change, referencing the issue.
6. **Auto-merge**: the PR is set to merge automatically via `gh pr merge --auto`, which
   respects this repository's branch protection and required checks/reviews rather than
   bypassing them. The issue closes automatically when the PR merges.

**Required repo setting**: auto-merge only works if the repository has "Allow auto-merge"
turned on (Settings → General). If it isn't, the PR still opens (fully auditable, still
tested) — a maintainer just has to click merge instead of it happening on its own.

**Configuration**: the auto-fixable fields are IMDb ID, poster URL, runtime, genres,
synopsis, release year, country codes, and languages — defined in both the issue form's
"What field is wrong?" dropdown and `FIELD_MAP` in `scripts/import-correction.mjs`. To add a
new one: add a dropdown option to `.github/ISSUE_TEMPLATE/data-correction.yml` and a matching
entry to `FIELD_MAP` with a `validate`/`parse` pair — `scripts/import-correction.test.mjs`
checks the two stay in sync and will fail if they don't.

### Manually reviewing or overriding a submission

- **Hold a specific submission**: apply a `blocked` or `hold` label to the issue (before or
  after the PR opens) and auto-merge is skipped — the PR still gets opened and tested, it
  just waits for a maintainer to merge it by hand.
- **Stop an in-flight auto-merge**: `gh pr merge --disable-auto <number>`, or just close the
  PR — the issue stays open (it only auto-closes on a real merge) and can be picked up
  manually.
- **A validation failure isn't final**: editing the issue re-triggers the whole check. There's
  no need to close and reopen.
- **Everything the bot does is a normal, reviewable PR** — nothing is ever pushed straight to
  `main`, and the PR body always names the source issue.

### What happens after you submit it — manual path ("Something else")

1. A maintainer reads the issue and verifies the claim against the cited source.
2. If it checks out, the maintainer edits `data/source/master-data.json` directly — the same
   file the automated path patches — adding a new record or correcting the relevant field(s).
3. The maintainer re-runs the data pipeline (`npm run data:merge && npm run data:enrich:tmdb
   && npm run data:build && npm run data:posters && npm run data:validate && npm run
   data:coverage && npm run data:update` — see the README's "Systematic API Pipeline"
   section) and commits the result.
4. The issue is closed with a reference to the commit that applied the fix.

This stays manual for anything outside the fixed, auto-fixable field list on purpose: the
archive's whole design principle (see `ARCHITECTURE.md`'s merge-precedence notes) is that
hand-curated seed data is trusted precisely *because* it's been checked — automatically
importing an unbounded range of unverified issue submissions (new records, director/cast
changes, category renames, duplicate merges) would undermine that guarantee for every other
record in the dataset. The automated path only ever touches a narrow, mechanically-verifiable
set of scalar/array film fields for exactly this reason.

### Why the internal identifier matters

Films are frequently ambiguous by title alone (remakes, same-title-different-year, films
with no unique English title). The "internal identifier" field in the correction form is
the film's IMDb ID when it has one, or its synthetic archive ID (`film:{slug}-{year}`)
when it doesn't — either way, it lets the automated validator (or a maintainer) find the
*exact* record you mean without guessing. Please don't remove it from the pre-filled form.

## Code changes

Standard PR workflow: fork, branch, `npm test && npx tsc --noEmit && npm run lint && npm run
build` before opening a PR. See `CLAUDE.md` for the data pipeline architecture and
`ARCHITECTURE.md` for the full data model and merge-precedence design.
