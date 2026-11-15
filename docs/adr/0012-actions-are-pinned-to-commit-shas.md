---
status: accepted
date: 2026-11-02
---

# Actions are pinned to commit SHAs and kept current by Dependabot

Before #162 (PR #225) every action in the workflows was referenced by a mutable tag, including the deploy, which holds `pages: write` and `id-token: write`. Whoever can move a tag on an action's repository can then run code in that job: the pattern of the 2025 tj-actions compromise. Nothing proposed version updates either, and CI printed deprecation warnings for a Node 20 action and for the coming move of `ubuntu-latest`.

Decision: **every remote `uses:` is pinned to a full 40-character commit SHA with a `# vX.Y.Z` comment, every job with steps runs on `ubuntu-24.04`, and Dependabot proposes the updates.** `.github/dependabot.yml` checks npm and GitHub Actions weekly, one group per ecosystem (npm: minor and patch only, so a major opens its own pull request), with a seven-day cooldown so a release is a week old before it is proposed. The repository setting `sha_pinning_required` is on, so GitHub itself refuses an unpinned action. We rejected major tags (`@v6`), because a tag can be moved after review, and `ubuntu-latest`, because it changes the runner image without a commit.

## Consequences

- `tests/action-pins.test.mjs` reads `.github/` from source and fails on a tag ref, a short SHA, a missing version comment, a job with steps on any runner other than `ubuntu-24.04`, or a Dependabot config without both ecosystems, a weekly schedule, the cooldown and the groups. Local `./` refs and reusable-workflow jobs are skipped where the rule does not apply.
- To bump an action by hand, resolve the commit SHA of the tag, not the tag object (they differ for annotated tags): `gh api repos/<owner>/<repo>/commits/<tag> -q .sha`. The weekly Dependabot pull request is the normal path.
- Dependabot pull requests get no repository secret, so the confidentiality gate only warns on them (ADR 0005); they go through normal review.
- Transitive npm alerts that no direct bump fixes are closed with `overrides` in `package.json` (#255, PR #257).
- The workflows are also scanned, report-only, by zizmor and CodeQL (#146, PR #234).
