# Operations: what expires and stops publishing

Five things can each stop the site or the Scheduler from publishing, with little or no warning. This page lists all five in one place: how long each lasts, what warns before it lapses, how to renew it and when it was last renewed. `tests/operations-doc.test.mjs` fails when the page drifts from the repo: a stale `Expires` value, a scheduled workflow it does not name, a path it cites that is gone, or a README that no longer links here.

| Item | Lifetime / current expiry | What warns | Renewal | Last renewed |
|---|---|---|---|---|
| LinkedIn member token | 60 days from issue. | Wizard step 2 prints the expiry and step 7 shows days left. Nothing warns automatically yet: #147 (open) plans a Telegram warning 10 days ahead. | `automation/setup/credentials.sh renew-token`, then re-select the recreated credential in any n8n node that used the old one ([Token renewal](../automation/README.md#token-renewal-60-days)). | not yet issued (#13) |
| `security.txt` Expires | The `Expires` value in `public/.well-known/security.txt`, currently 2027-10-01T00:00:00Z. | `tests/security-txt.test.mjs` prints a `::warning::` annotation on every Check run in the last 60 days. After the date passes the test fails the check job, so the daily deploy stops and scheduled posts no longer go live. | Open a PR that moves `Expires` about eleven months ahead (at most 366 days). | 2026-11-02 (#140) |
| Scheduled workflows | GitHub disables a schedule after 60 days with no repository activity. Seven workflows have one: `.github/workflows/deploy.yml` (the daily rebuild), `.github/workflows/keepalive.yml`, `.github/workflows/ahead.yml` (the ahead build), `.github/workflows/dns.yml`, `.github/workflows/link-rot.yml`, `.github/workflows/zizmor.yml` and `.github/workflows/codeql.yml`. | `keepalive.yml` re-enables `deploy.yml` and itself every week (#100 stays open only for whether that enable call resets GitHub's counter). The other five (`ahead.yml`, `dns.yml`, `link-rot.yml`, `zizmor.yml`, `codeql.yml`) get no warning: the signal is a missing daily or weekly run, and a failed scheduled `dns.yml` run emails whoever last edited its cron line. | A push to `master` at least every 60 days, or `gh workflow enable <file>` for one that has already been disabled. | n/a: last push to master (see git log) |
| Domain registration | The RDAP `expiration` event. | The `rdap-expiry` check in `npm run dns` (`scripts/dns-check.mjs`) fails once expiry is 30 days or less away. It runs weekly in `dns.yml`, and a failed scheduled run sends an email. | Renew with the registrar, then `gh workflow run dns.yml` to confirm the check passes. | not tracked in the repo |
| Publishing runway | Until the date of the last live or scheduled article. | The runway table in the step summary of every Check run, scheduled ones included, plus a `::warning title=Runway::` annotation for each draft dated within 7 days or overdue. The step uses `continue-on-error`, so it never fails a run, and the warning is easy to miss. | Schedule more articles ([Add an article](content-checklists.md#add-an-article)) and check with `npm run runway`. | n/a |

## When something lapses

**LinkedIn member token.** Once the token expires, LinkedIn refuses the Scheduler's posts: each Approve gets a 4xx reply in Telegram and nothing goes out to LinkedIn. Bluesky and Mastodon use their own credentials and are not affected, and the site itself keeps publishing. To recover:

- Run `automation/setup/credentials.sh renew-token`. It repeats the browser authorisation only and recreates the n8n credential with a new id.
- Re-select the new credential in every n8n node that used the old one.
- A refused post leaves no LinkedIn row in the Posting record, so tap Approve again on each refused item (`/reoffer <id>` for one whose offer is gone). See `automation/n8n/README.md`.

**`security.txt` Expires.** On the day after `Expires` passes, `tests/security-txt.test.mjs` fails. Every Check run goes red, pull requests included, and the daily deploy publishes nothing, so posts whose date arrives stay unpublished (ADR 0003). The deploy's `report` job opens or comments on a `Publishing failed` issue for each missed day. To recover, merge a PR that moves `Expires` about eleven months ahead. The push to `master` runs the deploy, and every post whose date has passed goes live in that build.

**Scheduled workflows.** A disabled `deploy.yml` means no daily rebuild: posts dated after the last push stay unpublished until the next push or manual run, and no failure is reported because no run happens. The other six stop silently: no daily ahead build (a lapsed one loses no publish, but scheduled articles are then first built on their publish day), no weekly DNS and mail check, no link-rot scan, no workflow scans and no CodeQL analysis. To recover:

- `gh workflow enable <file>` for each disabled workflow (`gh workflow list --all` shows which ones are disabled).
- `gh workflow run deploy.yml` to publish anything that came due while it was off.

**Domain registration.** A lapsed domain takes down the site and the domain's mailbox, which is the only contact route the site offers, and a domain that is not renewed in time can be lost to someone else. To recover, renew with the registrar at once, then run `gh workflow run dns.yml` (or `npm run dns` locally) and confirm every check passes, `rdap-expiry` and `rdap-lock` included.

**Publishing runway.** Nothing breaks: the site and the Scheduler keep working, and they simply run out of things to publish. The writing page and the social feed go quiet after the last scheduled article. To recover, schedule more articles with the [Add an article](content-checklists.md#add-an-article) checklist and check the new end date with `npm run runway`.

After renewing anything, update its Last renewed cell in the same PR.
