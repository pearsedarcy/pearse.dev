#!/usr/bin/env bash
#
# A wizard walks a human through a manual procedure, step by step.
# Generated from the /wizard skill template (library below is unmodified apart
# from dropping the unused GitHub-secret helpers and the stock finish()).
#
# Everything above the "STAGES" marker is the wizard library: do not hand-edit
# it. Author the per-step stages below the marker.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Wizard library: delightful, consistent UX, identical across every wizard.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""
fi

# Author sets this at the top of the stages section.
TOTAL_STAGES=0

_STAGE_INDEX=0
_WE_TMP=""        # write_env temp file, removed by the trap on EXIT/INT
trap '[[ -z "$_WE_TMP" ]] || rm -f "$_WE_TMP"' EXIT
trap 'exit 130' INT
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()    # KEYs written to ENV_FILE this run
WRITTEN_SECRET=() # secret NAMEs set this run
SKIPPED=()        # things we couldn't do (e.g. gh missing)

# _clear wipes the terminal so only the current step is on screen. No-op when
# output isn't a terminal, so piped logs stay readable.
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1 && tput clear 2>/dev/null; then return 0; fi
  printf '\033[2J\033[3J\033[H'
}

# banner "Title" shows the opening frame: what this wizard does.
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  You drive the browser; this wizard tells you exactly what to do and\n' "$DIM"
  printf '  captures the values you copy back. Stop any time with Ctrl-C and re-run\n'
  printf '  later, since it remembers values already saved.%s\n' "$RESET"
  pause "Ready to start?"
}

# stage "Name" clears the screen, then announces a stage and shows progress.
# Clearing keeps only the current step on screen.
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

# say "..." prints a plain instruction line.
say()  { printf '  %s\n' "$1"; }
# step "..." is a numbered-feeling action the human takes in the browser.
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

# open_url URL opens it in the human's browser, cross-platform incl. WSL.
open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else false; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser, so visit it manually: $url"
}

# pause "msg" waits for the human to confirm they've done the manual part.
pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

# confirm "question" is a y/N gate; returns success on yes.
confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

# _existing KEY: current value of KEY in ENV_FILE, if any, with write_env's single
# quotes or a plain dotenv double-quoted value undone.
_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line value sq="'\\''"; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  value="${line#*=}"
  if [[ "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"; value="${value//"$sq"/\'}"
  elif [[ "$value" == \"*\" ]]; then
    value="${value:1:${#value}-2}"
    [[ "$value" == *[\\\$\"]* ]] && return 1   # escapes, $ or ": can't decode safely; ask again
  fi
  printf '%s' "$value"
}

# ask KEY "Prompt" reads a value into $KEY. Offers the existing .env value as
# a default on re-runs (Enter keeps it). Visible input (non-secret), edited
# with Readline. Fails at EOF with no input.
ask() {
  local key="$1" prompt="$2" current input s=$'\001' e=$'\002' p rc=0
  current=$(_existing "$key" || true)
  # Readline needs the colour codes wrapped in \001..\002 to place the cursor.
  p="  $s$BOLD$e$prompt$s$RESET$e "
  [[ -n "$current" ]] && p+="$s$DIM$e[Enter keeps current]$s$RESET$e "
  read -e -r -p "$p" input || rc=1
  if (( rc )) && [[ -z "$input" ]]; then return 1; fi
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# ask_secret KEY "Prompt" is like ask, but input is hidden.
ask_secret() {
  local key="$1" prompt="$2" current input rc=0
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || rc=1
  printf '\n'
  if (( rc )) && [[ -z "$input" ]]; then return 1; fi
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# write_env KEY VALUE upserts KEY='VALUE' into ENV_FILE (replaces any existing
# line) and sets $KEY. Idempotent. Creates ENV_FILE at mode 0600; writes through
# a symlink and keeps an existing file's mode.
write_env() {
  local key="$1" value="$2" tmp sq="'\\''"
  [[ -e "$ENV_FILE" ]] || (umask 077 && : > "$ENV_FILE")
  tmp=$(mktemp "$(dirname "$ENV_FILE")/.write_env.XXXXXX")
  _WE_TMP="$tmp"
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf "%s='%s'\n" "$key" "${value//\'/$sq}" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"; _WE_TMP=""
  printf -v "$key" '%s' "$value"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}


# ──────────────────────────────────────────────────────────────────────────
# STAGES: pearse.dev Scheduler credentials (LinkedIn, Telegram, n8n, optional
# Bluesky and Mastodon).
# ──────────────────────────────────────────────────────────────────────────

{ set +x; } 2>/dev/null   # never trace: values below are secrets

LAST_STEP=7
DRY_RUN=0
ONLY_STEP=""
FROM_STEP=""
SUBCOMMAND=""
LI_REDIRECT="http://localhost:8976/callback"
LI_PORT=8976
HTTP_STATUS=""
HTTP_BODY=""
BSKY_BASE="https://bsky.social/xrpc"

# State lives outside the repository, mode 600, one KEY='VALUE' per line.
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/pearse-dev-wizard"
ENV_FILE="$STATE_DIR/state.env"

usage() {
  cat <<'USAGE'
Usage: credentials.sh [options] [renew-token]

Walks you through the one-off credentials the Scheduler needs: a LinkedIn
member token, a Telegram bot with your chat id, and two n8n credentials, then
the optional Bluesky and Mastodon cross-posting credentials (skip either).
Nothing is written to the repository; state goes to
${XDG_STATE_HOME:-~/.local/state}/pearse-dev-wizard/state.env (mode 600).

Steps
  1  LinkedIn developer app (client id and secret)
  2  Member token via local OAuth callback (60 days)
  3  Telegram bot and chat id
  4  n8n credentials (linkedin-member, telegram-pearse-dev)
  5  Bluesky app password, n8n credential bluesky-app-password (optional)
  6  Mastodon access token, n8n credential mastodon-token (optional)
  7  Summary checklist and the n8n variables to set

Options
  --step N     run only step N
  --from N     run steps N..7 (default: resume after the last completed step)
  --dry-run    print what each step would do; no prompts, network or writes
  -h, --help   show this help

Subcommands
  renew-token  re-run step 2 only, then update the n8n linkedin-member
               credential. Run before the 60-day token expires.
USAGE
}

die() { printf '  ✗ %s\n' "$1" >&2; exit 1; }

# ── helpers (secrets travel via environment variables, never argv) ─────────

PY_HTTP='
import json, os, sys, urllib.request, urllib.error
m, u = os.environ["H_METHOD"], os.environ["H_URL"]
h = json.loads(os.environ.get("H_HEADERS") or "{}")
b = os.environ.get("H_BODY") or None
if b is not None:
    b = b.encode()
    h.setdefault("Content-Type", os.environ.get("H_CT") or "application/json")
h.setdefault("User-Agent", "pearse-dev-wizard")
req = urllib.request.Request(u, data=b, headers=h, method=m)
try:
    r = urllib.request.urlopen(req, timeout=30)
    code, body = r.status, r.read().decode("utf-8", "replace")
except urllib.error.HTTPError as e:
    code, body = e.code, e.read().decode("utf-8", "replace")
except Exception:
    sys.exit(1)
sys.stdout.write("%s\n%s" % (code, body))
'

PY_BUILD='
import json, os, sys, urllib.parse
mode, args = sys.argv[1], sys.argv[2:]
d = {}
for i in range(0, len(args), 2):
    k, var = args[i], args[i + 1]
    if k.endswith(":json"):
        d[k[:-5]] = json.loads(os.environ[var])
    else:
        d[k] = os.environ[var]
sys.stdout.write(json.dumps(d) if mode == "json" else urllib.parse.urlencode(d))
'

PY_GET='
import json, sys
try:
    v = json.load(sys.stdin)
    for p in sys.argv[1].split("."):
        v = v[int(p)] if isinstance(v, list) else v[p]
except Exception:
    sys.exit(1)
sys.stdout.write(str(v))
'

PY_CALLBACK='
import http.server, os, sys, time, urllib.parse
want, port = os.environ["CB_STATE"], int(os.environ["CB_PORT"])
res = {"done": False, "code": "", "err": "timed out waiting for the redirect"}
class H(http.server.BaseHTTPRequestHandler):
    def reply(self, status, text):
        self.send_response(status); self.send_header("Content-Type", "text/plain"); self.end_headers()
        self.wfile.write(text.encode())
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path != "/callback" or q.get("state", [""])[0] != want:
            self.reply(404, "Not the expected callback.\n"); return   # stray request: keep waiting
        if "code" in q:
            res["code"], res["err"] = q["code"][0], ""
        else:
            res["err"] = q.get("error_description", q.get("error", ["no code returned"]))[0]
        res["done"] = True
        self.reply(200, "Done. You can close this tab and return to the terminal.\n")
    def log_message(self, *a): pass
try:
    s = http.server.HTTPServer(("127.0.0.1", port), H)
except OSError as e:
    sys.stderr.write("port %d on 127.0.0.1 is unavailable (%s). Stop whatever is using it and re-run.\n" % (port, e.strerror))
    sys.exit(2)
s.timeout = 1
open(os.environ["CB_READY"], "w").close()
deadline = time.time() + 300
while not res["done"] and time.time() < deadline:
    s.handle_request()
if res["err"]:
    sys.stderr.write(res["err"] + "\n"); sys.exit(1)
fd = os.open(os.environ["CB_OUT"], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.write(fd, res["code"].encode()); os.close(fd)
'

# json_build json|form KEY VAR ... : build a body from env vars named VAR.
json_build() { local mode="$1"; shift; python3 -I -c "$PY_BUILD" "$mode" "$@"; }
# jget PATH < json : print one field (dotted path; list indexes may be negative).
jget() { python3 -I -c "$PY_GET" "$1"; }

# http_req METHOD URL [HEADERS_JSON] [BODY] [CONTENT_TYPE] sets HTTP_STATUS/HTTP_BODY.
http_req() {
  local out headers="${3:-}"
  [[ -n "$headers" ]] || headers='{}'
  if ! out=$(H_METHOD="$1" H_URL="$2" H_HEADERS="$headers" H_BODY="${4:-}" H_CT="${5:-}" \
      python3 -I -c "$PY_HTTP"); then
    HTTP_STATUS=000; HTTP_BODY=""; return 1
  fi
  HTTP_STATUS="${out%%$'\n'*}"; HTTP_BODY="${out#*$'\n'}"
}

bearer_headers() { H_AUTH="Bearer $1" json_build json Authorization H_AUTH; }

dry() {  # dry "what this step would do" ...  (returns success when dry-running)
  (( DRY_RUN )) || return 1
  local line
  for line in "$@"; do printf '  %s[dry-run]%s %s\n' "$YELLOW" "$RESET" "$line"; done
  return 0
}

state_get() { _existing "$1" || true; }
mark_done() { write_env LAST_DONE_STEP "$1" >/dev/null; }

need_tools() {
  command -v python3 >/dev/null 2>&1 || die "python3 is required"
}

# ── step 1: LinkedIn developer app ─────────────────────────────────────────

step_1() {
  stage "LinkedIn developer app"
  if dry "open https://www.linkedin.com/developers/apps and walk you through creating the app" \
         "ask for the client id (visible) and client secret (hidden, read -rs)" \
         "save LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to $ENV_FILE (mode 600)"; then return; fi
  open_url "https://www.linkedin.com/developers/apps"
  step "Create app. Name it e.g. 'pearse.dev scheduler'."
  step "LinkedIn requires a company page. Pick an existing one, or create a placeholder page first (linkedin.com/company/setup/new)."
  step "Products tab: request 'Share on LinkedIn' (scope w_member_social)."
  step "Products tab: request 'Sign In with LinkedIn using OpenID Connect' (scopes openid profile)."
  step "Auth tab: add this redirect URL exactly:  $LI_REDIRECT"
  step "Auth tab: copy the Client ID and the Primary Client Secret."
  ask LINKEDIN_CLIENT_ID "Client ID:"
  ask_secret LINKEDIN_CLIENT_SECRET "Client secret (hidden):"
  [[ -n "$LINKEDIN_CLIENT_ID" && -n "$LINKEDIN_CLIENT_SECRET" ]] || die "client id and secret are both required"
  write_env LINKEDIN_CLIENT_ID "$LINKEDIN_CLIENT_ID"
  write_env LINKEDIN_CLIENT_SECRET "$LINKEDIN_CLIENT_SECRET"
  mark_done 1
}

# ── step 2: member token ───────────────────────────────────────────────────

# run_listener STATE URL: bind first, then open the browser, then wait for the
# redirect. Prints the authorisation code. Diagnostics go to stderr.
run_listener() {
  local state="$1" url="$2" ready="$STATE_DIR/.cb.ready" out="$STATE_DIR/.cb.code" err="$STATE_DIR/.cb.err" pid i
  rm -f "$ready" "$out" "$err"
  CB_STATE="$state" CB_PORT="$LI_PORT" CB_READY="$ready" CB_OUT="$out" python3 -I -c "$PY_CALLBACK" 2>"$err" &
  pid=$!
  for (( i = 0; i < 50; i++ )); do
    [[ -e "$ready" ]] && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if [[ ! -e "$ready" ]]; then
    cat "$err" >&2; rm -f "$err"
    die "could not start the local callback listener on port $LI_PORT"
  fi
  open_url "$url" >&2
  if ! wait "$pid"; then
    cat "$err" >&2; rm -f "$ready" "$out" "$err"
    die "authorisation failed; re-run: credentials.sh --step 2"
  fi
  cat "$out"; rm -f "$ready" "$out" "$err"
}

step_2() {
  stage "LinkedIn member token"
  if dry "start a one-shot listener on 127.0.0.1:$LI_PORT (python3 http.server)" \
         "print/open the authorisation URL (scopes: openid profile w_member_social)" \
         "exchange the code at https://www.linkedin.com/oauth/v2/accessToken" \
         "verify with GET https://api.linkedin.com/v2/userinfo; print only the member id (sub) and days until expiry" \
         "save the token only to $ENV_FILE (mode 600)"; then return; fi
  local cid csec state url code body tok expires sub days
  cid=$(state_get LINKEDIN_CLIENT_ID); csec=$(state_get LINKEDIN_CLIENT_SECRET)
  [[ -n "$cid" && -n "$csec" ]] || die "no client id/secret saved: run step 1 first (credentials.sh --step 1)"
  state=$(python3 -I -c 'import secrets; print(secrets.token_urlsafe(16))')
  url="https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${cid}&redirect_uri=http%3A%2F%2Flocalhost%3A${LI_PORT}%2Fcallback&state=${state}&scope=openid%20profile%20w_member_social"
  say "Approve the consent screen in your browser. This terminal waits up to 5 minutes."
  say "If no browser opens, visit:"
  say "$url"
  say "Listening on 127.0.0.1:$LI_PORT ..."
  code=$(run_listener "$state" "$url")
  body=$(LI_GRANT=authorization_code LI_CODE="$code" LI_CID="$cid" LI_SECRET="$csec" LI_REDIR="$LI_REDIRECT" \
    json_build form grant_type LI_GRANT code LI_CODE client_id LI_CID client_secret LI_SECRET redirect_uri LI_REDIR)
  http_req POST "https://www.linkedin.com/oauth/v2/accessToken" "" "$body" "application/x-www-form-urlencoded" \
    || die "could not reach linkedin.com"
  [[ "$HTTP_STATUS" == 200 ]] || die "token exchange failed (HTTP $HTTP_STATUS): $(printf '%s' "$HTTP_BODY" | jget error_description || echo 'check client secret and redirect URL')"
  tok=$(printf '%s' "$HTTP_BODY" | jget access_token) || die "no access_token in response"
  expires=$(printf '%s' "$HTTP_BODY" | jget expires_in) || expires=5184000
  http_req GET "https://api.linkedin.com/v2/userinfo" "$(bearer_headers "$tok")" || die "could not reach api.linkedin.com"
  [[ "$HTTP_STATUS" == 200 ]] || die "token rejected by /v2/userinfo (HTTP $HTTP_STATUS): is 'Sign In with LinkedIn using OpenID Connect' approved on the app?"
  sub=$(printf '%s' "$HTTP_BODY" | jget sub) || die "userinfo had no 'sub'"
  days=$(( expires / 86400 ))
  write_env LINKEDIN_ACCESS_TOKEN "$tok" >/dev/null
  write_env LINKEDIN_MEMBER_SUB "$sub" >/dev/null
  write_env LINKEDIN_TOKEN_EXPIRES_AT "$(( $(date +%s) + expires ))" >/dev/null
  say "✓ token verified. Member id (sub): $sub  ->  urn:li:person:$sub"
  say "✓ token valid for $days days. Stored in $ENV_FILE only."
  [[ "$SUBCOMMAND" == renew-token ]] || mark_done 2   # renewal must not rewind progress
}

# ── step 3: Telegram ───────────────────────────────────────────────────────

step_3() {
  stage "Telegram bot and chat id"
  if dry "open https://t.me/BotFather and walk you through /newbot" \
         "ask for the bot token (hidden) and verify it with getMe" \
         "ask you to message the bot, read the chat id from getUpdates, verify with getChat" \
         "save TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to $ENV_FILE (mode 600)"; then return; fi
  local base name chat updates who
  TELEGRAM_CHAT_ID=""
  open_url "https://t.me/BotFather"
  step "Send /newbot to @BotFather, pick a name and a username ending in 'bot'."
  step "Copy the HTTP API token it prints."
  ask_secret TELEGRAM_BOT_TOKEN "Bot token (hidden):"
  base="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"
  http_req GET "$base/getMe" || die "could not reach api.telegram.org"
  [[ "$HTTP_STATUS" == 200 ]] || die "Telegram rejected the bot token (HTTP $HTTP_STATUS): re-run credentials.sh --step 3"
  name=$(printf '%s' "$HTTP_BODY" | jget result.username) || die "unexpected getMe response"
  say "✓ bot verified: @$name"
  write_env TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN" >/dev/null
  step "Open your bot (t.me/$name), press Start and send it any message."
  pause "Press Enter once you have sent the message."
  http_req GET "$base/getUpdates" || die "could not reach api.telegram.org"
  updates="$HTTP_BODY"
  chat=$(printf '%s' "$updates" | jget result.-1.message.chat.id) || chat=""
  if [[ -z "$chat" ]]; then
    warn "no message found via getUpdates (is a webhook set on this bot?)"
    ask TELEGRAM_CHAT_ID "Enter your chat id manually:"
    chat="$TELEGRAM_CHAT_ID"
  fi
  [[ "$chat" =~ ^-?[0-9]+$ ]] || die "chat id must be a number, got '$chat'"
  who=$(printf '%s' "$updates" | jget result.-1.message.from.username) || who="(no username)"
  say "Last message came from: @$who, chat id $chat"
  confirm "Is that you? Store this chat id" || die "not confirmed; message the bot from your own account and re-run --step 3"
  http_req GET "$base/getChat?chat_id=$chat" || die "could not reach api.telegram.org"
  [[ "$HTTP_STATUS" == 200 ]] || die "chat id $chat is not reachable by this bot (HTTP $HTTP_STATUS): message the bot first, then re-run --step 3"
  write_env TELEGRAM_CHAT_ID "$chat" >/dev/null
  say "✓ chat id verified: $chat"
  mark_done 3
}

# ── step 4: n8n credentials ────────────────────────────────────────────────

n8n_manual() {
  warn "n8n API unavailable or refused the request. Do this by hand in n8n (Credentials -> Create):"
  say "1. Type 'Header Auth', name 'linkedin-member', header name 'Authorization',"
  say "   value 'Bearer <member token>'. Token: grep LINKEDIN_ACCESS_TOKEN $ENV_FILE"
  say "2. Type 'Telegram API', name 'telegram-pearse-dev', access token = your bot token"
  say "   (grep TELEGRAM_BOT_TOKEN $ENV_FILE)."
  say "Chat id for workflows: $(state_get TELEGRAM_CHAT_ID)"
}

# n8n_delete ID : delete a credential; 404 counts as already gone.
n8n_delete() {
  local base key; base=$(state_get N8N_BASE_URL); key=$(state_get N8N_API_KEY)
  http_req DELETE "$base/api/v1/credentials/$1" "$(N8N_K="$key" json_build json X-N8N-API-KEY N8N_K)" || return 1
  [[ "$HTTP_STATUS" == 200 || "$HTTP_STATUS" == 204 || "$HTTP_STATUS" == 404 ]]
}

# n8n_create NAME TYPE DATA_JSON_VAR -> prints new credential id, fails otherwise
n8n_create() {
  local name="$1" type="$2" datavar="$3" body base key
  base=$(state_get N8N_BASE_URL); key=$(state_get N8N_API_KEY)
  body=$(N8N_NAME="$name" N8N_TYPE="$type" N8N_DATA="${!datavar}" json_build json name N8N_NAME type N8N_TYPE data:json N8N_DATA) || return 1
  http_req POST "$base/api/v1/credentials" "$(N8N_K="$key" json_build json X-N8N-API-KEY N8N_K)" "$body" || return 1
  [[ "$HTTP_STATUS" == 200 || "$HTTP_STATUS" == 201 ]] || { warn "n8n answered HTTP $HTTP_STATUS creating '$name'" >&2; return 1; }
  printf '%s' "$HTTP_BODY" | jget id
}

step_4() {
  stage "n8n credentials"
  if dry "ask for the n8n base URL and an API key (hidden)" \
         "POST /api/v1/credentials: Header Auth 'linkedin-member' (Authorization: Bearer <token>)" \
         "POST /api/v1/credentials: Telegram API 'telegram-pearse-dev'" \
         "print the credential ids; on API failure print manual instructions and continue" \
         "save N8N_BASE_URL, N8N_API_KEY and the ids to $ENV_FILE (mode 600)"; then return; fi
  local d1 d2 id1="" id2="" ok=1 old
  [[ -n "$(state_get LINKEDIN_ACCESS_TOKEN)" ]] || die "no LinkedIn token saved: run step 2 first (credentials.sh --step 2)"
  [[ -n "$(state_get TELEGRAM_BOT_TOKEN)" ]] || die "no Telegram bot token saved: run step 3 first (credentials.sh --step 3)"
  say "n8n: Settings -> n8n API -> Create an API key (self-hosted instance)."
  ask N8N_BASE_URL "n8n base URL (e.g. https://n8n.example.org):"
  N8N_BASE_URL="${N8N_BASE_URL%/}"
  [[ "$N8N_BASE_URL" =~ ^https?:// ]] || die "base URL must start with http:// or https://"
  ask_secret N8N_API_KEY "n8n API key (hidden):"
  write_env N8N_BASE_URL "$N8N_BASE_URL" >/dev/null
  write_env N8N_API_KEY "$N8N_API_KEY" >/dev/null
  for old in N8N_LINKEDIN_CRED_ID N8N_TELEGRAM_CRED_ID; do   # re-run: replace, don't pile up duplicates
    if [[ -n "$(state_get "$old")" ]]; then
      n8n_delete "$(state_get "$old")" && say "removed previous credential $(state_get "$old")" \
        || warn "could not delete previous credential $(state_get "$old") ($old); remove it in n8n by hand"
    fi
  done
  d1=$(D_NAME=Authorization D_VAL="Bearer $(state_get LINKEDIN_ACCESS_TOKEN)" json_build json name D_NAME value D_VAL) || ok=0
  d2=$(D_TOK="$(state_get TELEGRAM_BOT_TOKEN)" json_build json accessToken D_TOK) || ok=0
  if (( ok )); then
    id1=$(n8n_create linkedin-member httpHeaderAuth d1) || ok=0
  fi
  if (( ok )); then
    id2=$(n8n_create telegram-pearse-dev telegramApi d2) || ok=0
  fi
  if (( ok )); then
    write_env N8N_LINKEDIN_CRED_ID "$id1" >/dev/null
    write_env N8N_TELEGRAM_CRED_ID "$id2" >/dev/null
    say "✓ linkedin-member      credential id: $id1"
    say "✓ telegram-pearse-dev  credential id: $id2"
  else
    n8n_manual
    SKIPPED+=("n8n credentials created by hand")
  fi
  mark_done 4
}

# ── renew-token ────────────────────────────────────────────────────────────

renew_token() {
  step_2
  (( DRY_RUN )) && { dry "DELETE the stored linkedin-member credential via /api/v1/credentials/<id>, then POST a new one with the new token (n8n has no update endpoint)" "store the new credential id; print manual instructions if delete or create fails"; return; }
  local id base key data new
  id=$(state_get N8N_LINKEDIN_CRED_ID); base=$(state_get N8N_BASE_URL); key=$(state_get N8N_API_KEY)
  if [[ -z "$id" || -z "$base" || -z "$key" ]]; then
    warn "no n8n credential recorded; update 'linkedin-member' in n8n by hand."
    note "token: grep LINKEDIN_ACCESS_TOKEN $ENV_FILE"
    return
  fi
  if ! n8n_delete "$id"; then
    warn "could not delete credential $id (HTTP ${HTTP_STATUS:-?}); nothing changed in n8n."
    n8n_manual
    return
  fi
  data=$(D_NAME=Authorization D_VAL="Bearer $(state_get LINKEDIN_ACCESS_TOKEN)" json_build json name D_NAME value D_VAL)
  if new=$(n8n_create linkedin-member httpHeaderAuth data); then
    write_env N8N_LINKEDIN_CRED_ID "$new" >/dev/null
    say "✓ n8n credential linkedin-member recreated, new id: $new"
    warn "the id changed: re-select 'linkedin-member' in any n8n node that uses it."
  else
    write_env N8N_LINKEDIN_CRED_ID "" >/dev/null
    warn "old credential deleted but the new one could not be created."
    n8n_manual
  fi
}

# ── steps 5 and 6: optional cross-posting credentials ──────────────────────

# n8n_replace NAME TYPE DATA_JSON_VAR ID_KEY : delete the credential recorded
# under ID_KEY (re-run), create a new one, record its id. Fails without n8n API.
n8n_replace() {
  local name="$1" type="$2" datavar="$3" idkey="$4" old id
  [[ -n "$(state_get N8N_BASE_URL)" && -n "$(state_get N8N_API_KEY)" ]] || return 1
  old=$(state_get "$idkey")
  if [[ -n "$old" ]]; then
    n8n_delete "$old" && say "removed previous credential $old" \
      || warn "could not delete previous credential $old ($idkey); remove it in n8n by hand"
  fi
  id=$(n8n_create "$name" "$type" "$datavar") || return 1
  write_env "$idkey" "$id" >/dev/null
  say "✓ $name credential id: $id"
}

# skip_network LABEL KEY STEP : record a deliberate skip. Skipping is a full answer,
# not a failure: the Scheduler skips a network whose variable is unset.
skip_network() {
  write_env "$2" 1 >/dev/null
  say "Skipped: $1 stays off. Re-run 'credentials.sh --step $3' to add it later."
  SKIPPED+=("$1")
  mark_done "$3"
}

step_5() {
  stage "Bluesky app password (optional)"
  if dry "ask whether to cross-post to Bluesky; answering no skips this step" \
         "open https://bsky.app/settings/app-passwords and walk you through creating an app password" \
         "ask for your handle (visible) and the app password (hidden)" \
         "verify with POST $BSKY_BASE/com.atproto.server.createSession, then end that session (deleteSession)" \
         "create the n8n credential 'bluesky-app-password' (Custom Auth, the createSession body) via /api/v1/credentials, or print manual instructions" \
         "save BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD to $ENV_FILE (mode 600)"; then return; fi
  local body refresh auth d
  if ! confirm "Cross-post the short copy to Bluesky?"; then
    skip_network Bluesky BLUESKY_SKIPPED 5; return
  fi
  open_url "https://bsky.app/settings/app-passwords"
  step "Add App Password. Name it e.g. 'pearse.dev scheduler'. Leave direct-message access off."
  step "Copy the password (xxxx-xxxx-xxxx-xxxx). Bluesky shows it only once."
  note "An app password, never your account password: it can be revoked on its own."
  ask BLUESKY_IDENTIFIER "Your handle (e.g. you.bsky.social, without @):"
  BLUESKY_IDENTIFIER="${BLUESKY_IDENTIFIER#@}"
  ask_secret BLUESKY_APP_PASSWORD "App password (hidden):"
  [[ -n "$BLUESKY_IDENTIFIER" && -n "$BLUESKY_APP_PASSWORD" ]] || die "handle and app password are both required"
  body=$(B_ID="$BLUESKY_IDENTIFIER" B_PW="$BLUESKY_APP_PASSWORD" json_build json identifier B_ID password B_PW)
  http_req POST "$BSKY_BASE/com.atproto.server.createSession" "" "$body" || die "could not reach bsky.social"
  [[ "$HTTP_STATUS" == 200 ]] || die "Bluesky rejected the handle or app password (HTTP $HTTP_STATUS): re-run credentials.sh --step 5"
  refresh=$(printf '%s' "$HTTP_BODY" | jget refreshJwt) || refresh=""
  HTTP_BODY=""
  if [[ -n "$refresh" ]]; then   # end the test session; failure here is harmless
    http_req POST "$BSKY_BASE/com.atproto.server.deleteSession" "$(bearer_headers "$refresh")" || true
  fi
  write_env BLUESKY_IDENTIFIER "$BLUESKY_IDENTIFIER" >/dev/null
  write_env BLUESKY_APP_PASSWORD "$BLUESKY_APP_PASSWORD" >/dev/null
  write_env BLUESKY_SKIPPED "" >/dev/null
  say "✓ app password verified for @$BLUESKY_IDENTIFIER"
  # Custom Auth credential: n8n merges this body into the createSession request.
  auth=$(B_ID="$BLUESKY_IDENTIFIER" B_PW="$BLUESKY_APP_PASSWORD" python3 -I -c \
    'import json, os; print(json.dumps({"body": {"identifier": os.environ["B_ID"], "password": os.environ["B_PW"]}}))')
  d=$(D_JSON="$auth" json_build json json D_JSON)
  if ! n8n_replace bluesky-app-password httpCustomAuth d N8N_BLUESKY_CRED_ID; then
    warn "n8n API unavailable (run step 4 first) or it refused the request. Create it by hand in n8n:"
    say "Credentials -> Create -> 'Custom Auth', name 'bluesky-app-password', JSON:"
    say '  {"body": {"identifier": "<your handle>", "password": "<app password>"}}'
    say "Values: grep BLUESKY_ $ENV_FILE"
    SKIPPED+=("n8n credential bluesky-app-password created by hand")
  fi
  say "Then set the n8n variable BLUESKY_CREDENTIAL=bluesky-app-password to switch Bluesky on."
  mark_done 5
}

step_6() {
  stage "Mastodon access token (optional)"
  if dry "ask whether to cross-post to Mastodon; answering no skips this step" \
         "ask for your instance URL (https://<host>) and open <instance>/settings/applications/new" \
         "walk you through creating an application with the single scope write:statuses" \
         "ask for the access token (hidden) and verify it with GET <instance>/api/v1/apps/verify_credentials" \
         "create the n8n credential 'mastodon-token' (Header Auth, Authorization: Bearer <token>) via /api/v1/credentials, or print manual instructions" \
         "save MASTODON_INSTANCE_URL and MASTODON_ACCESS_TOKEN to $ENV_FILE (mode 600)"; then return; fi
  local inst d
  if ! confirm "Cross-post the short copy to Mastodon?"; then
    skip_network Mastodon MASTODON_SKIPPED 6; return
  fi
  ask MASTODON_INSTANCE_URL "Your instance URL (https://<host>):"
  inst="${MASTODON_INSTANCE_URL%/}"
  [[ "$inst" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "the instance URL must look like https://<host>, with no path"
  open_url "$inst/settings/applications/new"
  step "Application name: 'pearse.dev scheduler'. Website: https://pearse.dev"
  step "Scopes: untick everything, then tick only write:statuses."
  step "Submit, open the new application and copy 'Your access token'."
  ask_secret MASTODON_ACCESS_TOKEN "Access token (hidden):"
  [[ -n "$MASTODON_ACCESS_TOKEN" ]] || die "the access token is required"
  http_req GET "$inst/api/v1/apps/verify_credentials" "$(bearer_headers "$MASTODON_ACCESS_TOKEN")" || die "could not reach $inst"
  [[ "$HTTP_STATUS" == 200 ]] || die "the instance rejected the token (HTTP $HTTP_STATUS): re-run credentials.sh --step 6"
  write_env MASTODON_INSTANCE_URL "$inst" >/dev/null
  write_env MASTODON_ACCESS_TOKEN "$MASTODON_ACCESS_TOKEN" >/dev/null
  write_env MASTODON_SKIPPED "" >/dev/null
  say "✓ token verified on $inst"
  d=$(D_NAME=Authorization D_VAL="Bearer $MASTODON_ACCESS_TOKEN" json_build json name D_NAME value D_VAL)
  if ! n8n_replace mastodon-token httpHeaderAuth d N8N_MASTODON_CRED_ID; then
    warn "n8n API unavailable (run step 4 first) or it refused the request. Create it by hand in n8n:"
    say "Credentials -> Create -> 'Header Auth', name 'mastodon-token', header name 'Authorization',"
    say "value 'Bearer <token>'. Token: grep MASTODON_ACCESS_TOKEN $ENV_FILE"
    SKIPPED+=("n8n credential mastodon-token created by hand")
  fi
  say "Then set the n8n variables MASTODON_CREDENTIAL=mastodon-token and MASTODON_INSTANCE_URL=$inst"
  mark_done 6
}

# ── step 7: summary ────────────────────────────────────────────────────────

# crosspost_line LABEL SECRET_KEY SKIP_KEY CREDENTIAL
crosspost_line() {
  if [[ -n "$(state_get "$2")" ]]; then
    note "  [x] $1 credential                  -> $ENV_FILE and n8n '$4'"
  elif [[ -n "$(state_get "$3")" ]]; then
    note "  [-] $1 skipped (optional)"
  else
    note "  [ ] $1 not set up (optional)"
  fi
}

step_7() {
  stage "Summary"
  if dry "print a checklist of what exists where, the n8n variables to set, plus renewal and rate-limit reminders"; then return; fi
  local exp now days
  exp=$(state_get LINKEDIN_TOKEN_EXPIRES_AT); now=$(date +%s)
  days="unknown"; [[ -n "$exp" ]] && days=$(( (exp - now) / 86400 ))
  printf '\n'
  say "What exists where"
  note "  [$([[ -n $(state_get LINKEDIN_CLIENT_ID) ]] && echo x || echo ' ')] LinkedIn app client id/secret      -> $ENV_FILE"
  note "  [$([[ -n $(state_get LINKEDIN_ACCESS_TOKEN) ]] && echo x || echo ' ')] LinkedIn member token ($days days left) -> $ENV_FILE and n8n 'linkedin-member'"
  note "  [$([[ -n $(state_get LINKEDIN_MEMBER_SUB) ]] && echo x || echo ' ')] Member URN urn:li:person:$(state_get LINKEDIN_MEMBER_SUB)"
  note "  [$([[ -n $(state_get TELEGRAM_BOT_TOKEN) ]] && echo x || echo ' ')] Telegram bot token                -> $ENV_FILE and n8n 'telegram-pearse-dev'"
  note "  [$([[ -n $(state_get TELEGRAM_CHAT_ID) ]] && echo x || echo ' ')] Telegram chat id $(state_get TELEGRAM_CHAT_ID)    -> $ENV_FILE (put it in the workflow)"
  note "  [$([[ -n $(state_get N8N_LINKEDIN_CRED_ID) ]] && echo x || echo ' ')] n8n credential ids               -> $ENV_FILE"
  crosspost_line Bluesky BLUESKY_APP_PASSWORD BLUESKY_SKIPPED bluesky-app-password
  crosspost_line Mastodon MASTODON_ACCESS_TOKEN MASTODON_SKIPPED mastodon-token
  printf '\n'
  say "n8n variables (Settings -> Variables) for the workflow"
  note "  TELEGRAM_CHAT_ID=$(state_get TELEGRAM_CHAT_ID)"
  note "  LINKEDIN_AUTHOR_URN=urn:li:person:$(state_get LINKEDIN_MEMBER_SUB)"
  note "  DRY_RUN=true   (until a dry run looks right)"
  [[ -n "$(state_get BLUESKY_APP_PASSWORD)" ]] && note "  BLUESKY_CREDENTIAL=bluesky-app-password"
  if [[ -n "$(state_get MASTODON_ACCESS_TOKEN)" ]]; then
    note "  MASTODON_CREDENTIAL=mastodon-token"
    note "  MASTODON_INSTANCE_URL=$(state_get MASTODON_INSTANCE_URL)"
  fi
  printf '\n'
  warn "LinkedIn member tokens last 60 days. Run './automation/setup/credentials.sh renew-token' before then."
  warn "Member posting is limited to 150 requests per day."
  say "n8n stores the secrets for the Scheduler; this repository never does."
  mark_done 7
  printf '\n'
}

# ── driver ─────────────────────────────────────────────────────────────────

run_step() {
  local n="$1"
  _STAGE_INDEX=$((n - 1))
  "step_$n"
}

run_wizard() {
  while (( $# )); do
    case "$1" in
      -h|--help) usage; return 0 ;;
      --dry-run) DRY_RUN=1 ;;
      --step) shift; ONLY_STEP="${1:-}" ;;
      --from) shift; FROM_STEP="${1:-}" ;;
      renew-token) SUBCOMMAND=renew-token ;;
      *) usage >&2; die "unknown argument: $1" ;;
    esac
    shift
  done
  local v
  for v in "$ONLY_STEP" "$FROM_STEP"; do
    [[ -z "$v" || "$v" =~ ^[1-7]$ ]] || die "step must be 1-7, got '$v'"
  done
  [[ -z "$ONLY_STEP" || -z "$FROM_STEP" ]] || die "use --step or --from, not both"

  need_tools
  local top
  if top=$(git rev-parse --show-toplevel 2>/dev/null) && [[ "$STATE_DIR" == "$top"/* ]]; then
    die "state dir $STATE_DIR is inside a git repository; set XDG_STATE_HOME elsewhere"
  fi
  if (( ! DRY_RUN )); then
    (umask 077 && mkdir -p "$STATE_DIR") && chmod 700 "$STATE_DIR"
  fi

  local start=1 n done_to
  if [[ "$SUBCOMMAND" == renew-token ]]; then
    TOTAL_STAGES=1
    renew_token
    return 0
  fi
  TOTAL_STAGES=$LAST_STEP
  if [[ -n "$ONLY_STEP" ]]; then
    start="$ONLY_STEP"; LAST_STEP_RUN="$ONLY_STEP"
  elif [[ -n "$FROM_STEP" ]]; then
    start="$FROM_STEP"
  else
    done_to=$(state_get LAST_DONE_STEP); done_to="${done_to:-0}"
    if (( done_to > 0 && done_to < LAST_STEP )); then
      start=$(( done_to + 1 ))
      note "  resuming at step $start (steps 1-$done_to already done; use --from 1 to redo)"
    fi
  fi
  local end="${LAST_STEP_RUN:-$LAST_STEP}"

  if (( DRY_RUN )); then
    printf '\n%s%s  pearse.dev credentials wizard (dry run)%s\n' "$BOLD" "$BLUE" "$RESET"
    note "  state file would be: $ENV_FILE"
  else
    banner "pearse.dev Scheduler credentials"
  fi
  for (( n = start; n <= end; n++ )); do
    run_step "$n"
    (( DRY_RUN )) || [[ $n -eq $end ]] || pause "Step $n done. Press Enter for the next step."
  done
  if (( DRY_RUN )); then
    printf '\n  %s[dry-run]%s nothing was prompted, fetched or written.\n\n' "$YELLOW" "$RESET"
  fi
}

run_wizard "$@"; exit
