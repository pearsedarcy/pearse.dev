---
status: accepted
date: 2026-11-15
---

# The master ruleset is code, with no bypass actor

ADR 0008 makes the deploy publish only a build that the `check` job passed, but nothing stopped a change reaching `master` without a pull request, a force-push rewriting what had been checked, or the branch being deleted: `master` had no ruleset at all. A ruleset made by clicking through the settings page is also invisible in review and drifts without a trace.

Decision: **the ruleset for `master` lives in the repository as `.github/rulesets/master.json`, in the shape the rulesets API accepts, with no bypass actor** (#284, PR #316). It has four rules: no deletion, no force-push, changes arrive through a pull request (no approving review is required, because the sole maintainer cannot approve their own pull request, and the only merge method is a merge commit) and the `check` job must pass. No actor, admin included, can skip the checks. We rejected a bypass list for the owner, because a bypass is exactly the path that skips the gated build, and rejected requiring the CodeQL and zizmor results, because those scanners have path filters: a posts-only pull request never produces their result, so a required one would stall the most common change.

## Consequences

- Committing the JSON does not apply it. Applying or updating the ruleset is a repository-admin step with the API calls in README "Security"; read it back with `gh api repos/pearsedarcy/pearse.dev/rulesets` and compare.
- The required context is the job id `check`, from the GitHub Actions app. `tests/ruleset.test.mjs` fails when a required context is not a job in `check.yml`, or when the `pull_request` trigger gains a path or branch filter, either of which would leave a pull request waiting for a check that never runs.
- Nothing pushes to `master` directly: the deploy only publishes and the keepalive only re-enables workflows. The 60-day keepalive fallback in ADR 0003 still works, because a merge is a push.
- Requiring the scanners is a separate, later decision, once a posts-only pull request has been shown to merge with that rule active.
