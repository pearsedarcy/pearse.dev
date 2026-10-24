# Scheduler automation

The Scheduler (see `GLOSSARY.md`) runs on self-hosted n8n. It reads the social feed, asks for Approval, posts approved copy to LinkedIn and records what it posted in the Posting record. Nothing is posted without Approval (ADR 0004).

This directory holds the one-off setup the Scheduler needs from a human.

## `setup/credentials.sh`

Interactive wizard for the credentials only Pearse can create. Requires `bash`, `python3` and a browser.

```sh
automation/setup/credentials.sh             # run, or resume after the last completed step
automation/setup/credentials.sh --dry-run   # print what each step would do; no prompts, network or writes
automation/setup/credentials.sh --step 3    # run one step
automation/setup/credentials.sh --from 2    # run steps 2..5
automation/setup/credentials.sh renew-token # re-run step 2 and update the n8n credential
automation/setup/credentials.sh --help
```

| Step | What happens |
|------|--------------|
| 1 | Create the LinkedIn developer app, associate a company page (a placeholder page is fine), request "Share on LinkedIn" (`w_member_social`) and "Sign In with LinkedIn using OpenID Connect" (`openid profile`), add redirect URL `http://localhost:8976/callback`, paste client id and secret. |
| 2 | OAuth in the browser against a one-shot local listener, token exchange, verification with `/v2/userinfo`. Prints only the member id (`urn:li:person:<sub>`) and the days until expiry. |
| 3 | Create a Telegram bot with @BotFather, verify with `getMe`, send the bot a message, read and verify the chat id. |
| 4 | Create the n8n credentials `linkedin-member` (Header Auth, `Authorization: Bearer <token>`) and `telegram-pearse-dev` (Telegram API) through the n8n public API. If the API is unavailable the wizard prints manual instructions and continues. |
| 5 | Checklist of what exists where. |

Each verification fails with a clear message on a bad token or chat id; fix the value and re-run that step with `--step N`.

### Where secrets live

- **n8n** holds the credentials the workflows use.
- **The wizard's state file**, `${XDG_STATE_HOME:-~/.local/state}/pearse-dev-wizard/state.env` (mode 600), holds the same values so steps can resume and `renew-token` can run. It is outside the repository, and the wizard refuses to run if that path is inside a git repository.
- **This repository holds no secrets.** Secrets are read with hidden input, passed to child processes through the environment (not command lines), and never traced.

### Token renewal (60 days)

LinkedIn member tokens last 60 days. Step 2 prints the expiry and step 5 shows days left. Before then run:

```sh
automation/setup/credentials.sh renew-token
```

It repeats the browser authorisation only and updates the n8n `linkedin-member` credential. If your n8n version cannot update credentials through its API, the wizard says so and tells you to paste the new header value in the n8n UI.

### Rate limit

The LinkedIn member posting limit is 150 requests per day. The Scheduler posts a handful of approved items a week, so this is a ceiling to know about, not a constraint; the Posting record also prevents duplicate posts that would waste requests.
