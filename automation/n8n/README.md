# Social scheduler workflow (n8n)

`social-scheduler.json` is the Scheduler from ADR 0004 as an n8n 1.x workflow export. It reads the social feed, asks for Approval in Telegram, posts approved copy to LinkedIn and keeps the Posting record. Nothing is posted without a tap on Approve.

| File | What it is |
|------|------------|
| `social-scheduler.json` | The workflow. Credentials are referenced by name only; it holds no tokens and no chat id. |
| `select.mjs` | The tested reference for the logic in the **Decide** and **Record result** Code nodes: selection, the LinkedIn payload, the Posting record. |
| `../../tests/scheduler.test.mjs` | Tests for `select.mjs` and for the workflow file. They also run the two embedded nodes with n8n's globals stubbed. |

## How it runs

```
Daily schedule (07:00, 09:00) ─┐
                               ├─ Fetch social feed ─ Decide ─ Route action ─┬─ ack     ─ Answer button
Telegram update ───────────────┘                                            ├─ offer   ─ Send offer (Approve / Skip)
  (messages and button taps)                                                ├─ notify  ─ Send message
                                                                            ├─ dryrun  ─ Log dry-run payload ─ Send message
                                                                            └─ post    ─ Post to LinkedIn ─ Record result ─ Send message
```

1. **Daily, 07:00 Europe/Vienna** (the workflow's timezone), it fetches `https://pearse.dev/social.json` and selects the entries dated today that may be posted: articles with `published: true`, and standalone posts with `status: approved`. It drops anything in the Posting record and anything already offered, then sends each one to Telegram with the full LinkedIn and short copy and two buttons. A run with nothing to offer sends nothing.
2. **A second run at 09:00** repeats the selection. Anything offered at 07:00 is not offered again, so it only picks up an article that became published in between. The site's daily rebuild runs at 06:00 UTC, which is 07:00 in Vienna in winter and 08:00 in summer, so at 07:00 today's article usually still shows `published: false`. Remove the 09:00 rule from **Daily schedule** if the rebuild moves earlier.
3. **Approve** (`approve:<id>`) fetches the feed again and re-checks the entry: still in the feed, eligible (an article must be `published: true`), not dated after today, and not in the Posting record. It then posts the LinkedIn copy and replies with the post URN and link. A `published: false` article is refused at every step and never posted.
4. **Skip** (`skip:<id>`) adds a `skipped` row to the Posting record, so the item is never offered again.
5. **Errors go back to the same chat**: a LinkedIn non-2xx reply (HTTP status and the first 500 characters of the body), a feed that cannot be read, a missing `LINKEDIN_AUTHOR_URN`. A failed post records nothing; tap Approve on the same message to retry. The LinkedIn node never retries automatically, so a timeout cannot double-post.

Only updates from `TELEGRAM_CHAT_ID` are acted on; button taps and messages from any other chat are ignored.

### Telegram commands

| Command | What it does |
|---------|--------------|
| `/run` | Runs today's selection now. Same rules as the daily run, so it is a no-op if everything was offered already ("Nothing new to offer"). |
| `/reoffer <id>` | Offers one item again: one that was skipped, or offered and never answered (a lost or deleted message). Its `skipped` row and its offer are removed first. A `posted` item is refused, except in a dry run. The item must still be eligible and dated today or earlier. |
| `/help` | Lists the commands. |

## Settings

Set these as **n8n variables** (Settings > Variables), or, on an instance without variables, as **environment variables** of the n8n process. The Code nodes read `$vars` first and fall back to `$env`. Environment access must not be blocked (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`) if you use that route.

| Name | Required | Meaning |
|------|----------|---------|
| `TELEGRAM_CHAT_ID` | yes | The chat that gets the prompts and whose taps count. Step 3 of `../setup/credentials.sh` prints it. |
| `LINKEDIN_AUTHOR_URN` | yes | `urn:li:person:<sub>`, the `author` of every post. Step 2 of the wizard prints it. |
| `DRY_RUN` | no | **Defaults to dry run.** Only the exact value `false` (any case) posts for real. |
| `SCHEDULER_TODAY` | no | `YYYY-MM-DD`: pretend today is this date. Honoured in dry runs only, ignored when `DRY_RUN=false`. |

Credentials (created by `../setup/credentials.sh` step 4, see `../README.md`):

| Credential name | n8n type | Used by |
|-----------------|----------|---------|
| `telegram-pearse-dev` | Telegram API | Telegram update, Answer button, Send offer, Send message |
| `linkedin-member` | Header Auth (`Authorization: Bearer …`) | Post to LinkedIn |

After `credentials.sh renew-token` the `linkedin-member` credential gets a new id: open **Post to LinkedIn** and select it again.

## The LinkedIn call

`POST https://api.linkedin.com/v2/ugcPosts` with headers `X-Restli-Protocol-Version: 2.0.0` and `Content-Type: application/json`, authenticated by `linkedin-member`. The body comes from `buildLinkedInPayload` in `select.mjs`:

- **Article**: `shareMediaCategory: ARTICLE`, with `media[0].originalUrl` the article URL and `media[0].title` its title, so LinkedIn renders the link card.
- **Standalone post**: `shareMediaCategory: NONE`, text only.
- Both: `author` is `LINKEDIN_AUTHOR_URN`, `lifecycleState: PUBLISHED`, `visibility` `PUBLIC`, and `shareCommentary.text` the entry's `social.linkedin`.

The post URN comes from the response body's `id`, or the `x-restli-id` header.

## The Posting record

Stored in the workflow's **static data** (`$getWorkflowStaticData('global')`):

```json
{
  "live":   { "record": [{ "id": "p01", "network": "linkedin", "postedAt": "2026-11-03T06:04:12.000Z", "postUrn": "urn:li:share:…", "status": "posted" }],
              "offered": { "p01": "2026-11-03T06:00:01.000Z" } },
  "dryRun": { "record": [], "offered": {} }
}
```

- `record` is the Posting record, one row per decision: `{id, network, postedAt, postUrn, status: 'posted'|'skipped'}`. For a skip, `postedAt` is when it was skipped and `postUrn` is null. Rows are keyed by feed `id` (the article slug, or the standalone id such as `p01`).
- `offered` remembers what was sent for Approval, so a second run the same day is a no-op.
- Dry runs use their own `dryRun` copy, so testing never blocks or fakes a live post. Switching `DRY_RUN` to `false` starts from the untouched `live` record.

**Why static data and not an n8n Data Table.** Static data needs no setup and the export imports as is: both triggers live in this one workflow, so the daily run and the button taps share it. A Data Table would have to be created by hand first and its instance-specific id selected in every node that uses it, and Data Tables are newer than much of n8n 1.x. The trade-offs, acceptable at a handful of posts a week:

- Static data is saved only for **production executions**: the workflow must be active, started by its triggers. Clicking "Execute workflow" in the editor does not persist it. Test through Telegram (`/run`) on the active workflow.
- Two executions running at the same moment can overwrite each other's changes. In the worst case a double tap on Approve posts twice; LinkedIn usually rejects the identical second post as a duplicate, and the error comes back to the chat.
- To read or repair the record, open a recent execution of **Decide** (its code can be changed temporarily to `return [{ json: $getWorkflowStaticData('global') }]`), or use `/reoffer`.

## Import (Pearse)

This export could not be imported into a live n8n from the agent that wrote it; do this once:

1. Run `../setup/credentials.sh` (issue #13) so `telegram-pearse-dev` and `linkedin-member` exist in n8n.
2. In n8n: **Workflows > Import from File**, choose `automation/n8n/social-scheduler.json`.
3. Open **Telegram update**, **Answer button**, **Send offer**, **Send message** and **Post to LinkedIn**. If n8n did not match a credential by name, select it from the list. Save.
4. Add the variables `TELEGRAM_CHAT_ID`, `LINKEDIN_AUTHOR_URN` and `DRY_RUN=true` (or the environment variables, see Settings).
5. Activate the workflow. The Telegram Trigger registers the bot's webhook, so n8n must be reachable over public HTTPS, and only one active workflow can use this bot's trigger.

## Test with a dry run

1. Keep `DRY_RUN=true`. Set `SCHEDULER_TODAY` to a date with an entry in the live feed (open `https://pearse.dev/social.json` and pick an article with `published: true`, or an approved standalone post).
2. Send `/run` to the bot. Each item arrives as `DRY RUN: Approve this LinkedIn post for <date>?` with the full copy and the two buttons.
3. Tap **Approve**. The reply is `DRY RUN: would POST https://api.linkedin.com/v2/ugcPosts`, the headers, and the exact JSON body. The same body is the output of **Log dry-run payload** in the execution view, and on n8n's stdout when `CODE_ENABLE_STDOUT=true`.
4. Send `/run` again: `Nothing new to offer`. Tap **Approve** again: `already posted`. Tap **Skip** on another item, then `/run`: it is not offered.
5. `/reoffer <id>` brings an item back for another try (in a dry run, even one marked posted).
6. When satisfied: delete `SCHEDULER_TODAY`, set `DRY_RUN=false`.

## Changing the logic

Edit `select.mjs`, run `node --test tests/scheduler.test.mjs`, then paste the whole file into the top of the **Decide** and **Record result** Code nodes with every leading `export ` removed, keeping the shim below it. Re-export the workflow over `social-scheduler.json`. The test `Code nodes embed select.mjs verbatim` fails until both copies match, and the confidentiality test fails if an export picks up a token or chat id.
