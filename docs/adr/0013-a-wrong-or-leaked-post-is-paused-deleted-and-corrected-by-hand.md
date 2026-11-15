---
status: proposed
date: 2026-11-15
---

# A wrong or leaked post is paused, deleted and corrected by hand

ADR 0004 says a post under a real name about a real employer cannot be undone, but until now nothing said what happens when one goes out wrong: a factual error, the wrong item, or a leak of something confidential (ADR 0005). This ADR is that policy, and the n8n runbook ("If a post goes wrong") follows it step by step. It is **proposed**: every answer below is the conservative default, written for Pearse to confirm or change in the pull request. The approval commit writes in his choices, sets `status: accepted` and the date.

Nothing here adds automation. The Scheduler never deletes, edits or corrects a post; every step is a person using the network's own app. A workflow that could delete would be a second way to act under a real name without a look, which is what ADR 0004 exists to prevent.

## 1. Delete, then correct; never edit in place

A wrong post is deleted on the network and, if it is still worth saying, replaced by a new post (decision 4). A leak is always deleted, never edited, because an edit can leave the original visible in an edit history, a repost or a copy. We rejected editing in place as the default for a factual error, even where the network allows it, because a silent edit looks like the post was always right, and the edit label and the history sit on the post for good:

- **LinkedIn**: the app can edit the text of a post, and the post then shows as edited. Deleting removes the post from the feed.
- **Bluesky**: a post cannot be edited. Delete is the only fix.
- **Mastodon**: a post can be edited, but the previous versions stay readable in its public edit history and are sent to the servers that hold a copy. Deleting is also sent to those servers, on a best-effort basis.

If any of those behaviours has changed, the runbook step is still the same: delete. Editing is allowed only for a slip that cannot mislead anyone and is not a leak, and only by Pearse's explicit call in that incident.

## 2. Scope: every network the item went to

The three networks carry the same item with the same source copy (ADR 0002), so a wrong item is wrong everywhere. Delete or correct on every network where the item has a row in the Posting record, whatever the row says, including rows marked `unknown` (decision 5). We rejected fixing only the network where the error was noticed, because the other posts would stay up and be found later, and the error would look less careful for it.

## 3. Kill switch: set `DRY_RUN` to anything but `false`

One way pauses the Scheduler: set the `DRY_RUN` n8n variable to `true`. Only the exact value `false` posts for real, so any other value stops every post, and nothing about the pause needs the editor or a deploy. We rejected deactivating the workflow because it also stops the Telegram trigger: the buttons on every open offer go dead, so an unanswered offer cannot be skipped, and static data is saved only for production executions, so a test run in the editor cannot be relied on to record anything.

The side effects of the chosen switch, accepted because each one fails safe (an item can be offered again, never posted by mistake):

- The daily 07:00 run, `/run` and `/reoffer` keep sending offers, labelled DRY RUN. They are not an alarm: nothing in them can post.
- A tap on Approve, on any open offer, becomes a dry run: it replies with the payload it would have sent and posts nothing.
- Dry runs use the separate `dryRun` record. A Skip tapped while paused is written there, so it never reaches the live record and does not block the item once `DRY_RUN=false` comes back.
- `SCHEDULER_TODAY` takes effect while paused, because it is honoured in dry runs.

To resume, fix the cause first (decision 7), then set `DRY_RUN` to `false` and remove `SCHEDULER_TODAY` if it is set. Deleting the variable does not resume: the default is a dry run. After resuming, re-check the live side:

- Re-Skip, in live mode, any item that was skipped while paused.
- Skip, in live mode, every old open offer for the item that went wrong, because its Approve button is live again.
- Read the live record (n8n README, "The Posting record") and confirm each row says what the networks show.

## 4. Posting record and replacement: a new standalone post

After a post is deleted its `posted` row stays. The row statuses are only `posted`, `skipped`, `pending` and `unknown`, nothing can mark a row as deleted, and live `/reoffer` refuses an item that is `posted` on every network that is on. So the same id cannot be offered again live. The default is to **publish the corrected copy as a new standalone post under a new id**, added in a pull request and approved through the normal path (ADR 0004). The old row stays as the record of what happened. We rejected repairing the record by hand-editing static data (the n8n README's Posting record section describes how) as the default, because it rewrites history in a store that has no undo and no review; it remains the last resort when the same id must go out again, and is a hand edit by Pearse, noted in the CHANGELOG.

`/reoffer` is only for rows that are `skipped`, `unknown` or `pending`. A `deleted` status, or a command that clears a posted row, is out of scope for this ADR: it is a workflow change and belongs in its own issue.

## 5. `unknown` rows are checked on the network first

An `unknown` row means the call gave no clear answer, so the post may be live. After an incident, look on that network (the profile page in a signed-out window is enough) before treating the item as unposted, and before any `/reoffer`. If it is there, it is a post like any other: decisions 1 and 2 apply. If it is not, `/reoffer` is safe.

## 6. Tell the employer when a post could reflect on it

Tell **the direct manager at MTS**, by role, when a wrong post mentions MTS, MTS Hub or wetlabs.app, and for any leak of employer-confidential material, whichever network or wording it was. That manager decides whether anyone else is told. A wrong post that does not touch MTS stays with Pearse. We rejected telling only for leaks, because a wrong claim about a product is the employer's problem as much as a leak, and rejected telling for every post of any kind, because most wrong posts are about an article that has nothing to do with it.

The disclosure to readers is a separate matter: **correct publicly only when a reader could have been misled** (a wrong fact, a wrong figure, the wrong item attributed to the wrong thing). A deleted post that nobody could have acted on is deleted without comment, and a leak is never described in public, in a correction or a note, because that repeats it.

## 7. Speed and follow-up

Targets, counted from the moment the post is noticed:

- **Pause and delete**: pause the Scheduler at once; delete within 1 hour, and within 15 minutes for a leak.
- **Tell the employer** (when decision 6 requires it): the same working day for a wrong post, within 2 hours for a leak, without waiting for the clean-up to finish.
- **Correct**: a replacement post goes out only after the source copy is fixed and the pull request is merged, so it is never faster than the review.

Follow-up, in this order:

1. Fix the source copy in the repository (ADR 0002), so the feed does not offer the wrong text again.
2. For a leak, add a pattern for it to the out-of-repo denylist (ADR 0005), and run `npm run gate` locally.
3. Add a CHANGELOG entry under Unreleased that says what class of mistake it was, in generic words, never the leaked text.

## Consequences

- `automation/n8n/README.md` gets an "If a post goes wrong" section: stop, delete or correct, record, tell, follow up, each step citing this ADR. `automation/README.md` points to it.
- GLOSSARY gets **Kill switch** for the one way chosen in decision 3. There is no entry for the incident itself.
- Nothing changes in the workflow, the feed or any page, so ADR 0001 holds. `DRY_RUN` and `SCHEDULER_TODAY` mean what they meant before.
- Go-live (`DRY_RUN=false`, issue #13) waits for this ADR to be accepted and merged, so the policy exists before the first live post.
- `tests/adr-citations.test.mjs` reads `README.md`, `automation/README.md` and `automation/n8n/README.md` and fails if an ADR citation points at a missing or duplicated ADR, a link target is missing, an ADR lacks `status` or `date`, the README's decisions range is stale, or the runbook stops citing this ADR.
- A `deleted` status or a command that retires a posted row is not decided here. If it is wanted, it is a separate workflow issue.
- This ADR is numbered 0013 because 0007 and then 0008 were taken while it was drafted; the issue that asked for it called it 0007.
