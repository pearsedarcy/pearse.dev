---
status: accepted
date: 2026-10-24
---

# Confidential material is gated in CI with a denylist kept outside the repository

Content about MTS work must not name customers, congresses, infrastructure addresses, credentials or business figures. The repository is public, so the list of forbidden strings cannot live in it: the list would itself be the leak. The check runs in CI against the built site, reading its patterns from a repository secret, and fails the build on any hit. We rejected a committed denylist for that reason, and rejected "just be careful" because ghost-written content from multiple agents has already needed this filter once.

Local backstop (#127): a tracked `.githooks/pre-commit` runs `node scripts/gate.mjs --staged` on every commit, installed by the `prepare` script. It fails open when `node` or the patterns are missing, so CI stays the enforcing gate; in a linked worktree the gate also reads `.confidential-patterns` from the main worktree root.

## Exception: legacy redirect stubs keep their old paths (2026-11-01, #199)

The built site contains twelve static redirect stubs under `/work/`, one per entry of `MOVED_CASE_STUDIES` in `astro.config.mjs` (ADR 0006). Each is a noindex meta-refresh page whose text never repeats its old path, but the old path itself is a public URL and cannot be hidden. Three groups of them put a name in that path that the site no longer uses:

- `/work/ophthix/` carries the **retired product name**. It redirects to `/work/wetlabs-app/`.
- `/work/wetpack/`, `/work/opthalyze/`, `/work/mts-atlas/` and `/work/mts-cortex/` carry the names of **private sub-projects** that are now feature sections of MTS Hub. They redirect to anchors on `/work/mts-hub/`.
- `/work/infrastructure-observability/` (to an anchor on `/work/wetlabs-app/`) `/work/jdm-parts-webshop/` and `/work/artist-wordpress-site/` (client case studies renamed once permission was granted, to `/work/m-buildz/` and `/work/pauldarcy-ie/`) carry no retired name; they are listed only so the whole set is on record.
- `/work/chatterbox/`, `/work/tournament-brackets/`, `/work/cam-tests/` and `/work/mx-creative-keypad/` (one-sentence case studies folded into the /work/ Smaller builds list, #169, ADR 0007) redirect to `/work/#smaller-builds` and carry no retired name; they too are listed only for the record.

Decision: **keep every stub.** These URLs were indexed or shared before the rename, and the stubs are the only thing that keeps those links working; dropping them would turn each into a 404. The names are already visible to anyone holding an old link, so the stubs add no new disclosure. We rejected deleting the retired-name stub alone: the two-products rule (ADR 0006) already settled that old URLs stay alive, and one missing redirect would be a silent exception to it.

The exception is exactly this and no wider:

- The old name may appear in `dist/` only as the path of `/work/ophthix/index.html`. `tests/mts-products.test.mjs` fails on any other file name or file content that carries it.
- A stub's page text, title, canonical, sitemap entry and social feed never repeat the old path.
- A new stub means a new line here. The same test file fails if a `MOVED_CASE_STUDIES` slug is missing from this ADR.

## Amendment (2026-11-15, #98): fail closed, scan every tracked file

The gate as first built passed with a warning when it had no patterns, so with no secret set the scheduled rebuild deployed unchecked while the run showed green. It also scanned only `dist/`, `src/` and `docs/`, although every tracked file in a public repository ships, and it never looked at file names.

- In required mode (`GATE_REQUIRED=1`: push, schedule, manual runs and same-repo pull requests not opened by Dependabot) the gate fails when it has no patterns, fewer than a minimum (default 10, repository variable `CONFIDENTIAL_PATTERNS_MIN`), or no git repository. An optional repository variable `CONFIDENTIAL_PATTERNS_SHA256` pins the normalised list; a mismatch fails without printing either hash. Fork and Dependabot pull requests receive no secret and keep the warning.
- The gate scans every tracked file plus `dist/`, and matches each pattern against relative paths as well as content. A path hit prints the path, which is already public; a content hit still never prints the matched text.
- Deliberate mentions are listed in the committed `.gate-allow` by pattern number, scope and exact path, with a reason that does not quote the match. Stale entries fail the gate.
- Pattern numbers are positions, so the denylist is append-only. Removing or reordering lines requires reviewing `.gate-allow`, and once the fingerprint variable is set, any change to the list fails the build until the variable is updated.
- The pre-commit hook's `--staged` scan matches staged paths as well as content and honours the staged `.gate-allow`, but does not judge staleness, because it sees only part of the tree. The hook sets no gate variable, so it still fails open and CI stays the enforcing gate.
