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
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf "%s='%s'\n" "$key" "${value//\'/$sq}" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
  printf -v "$key" '%s' "$value"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}


# ──────────────────────────────────────────────────────────────────────────
# STAGES: pearse.dev Scheduler credentials (LinkedIn, Telegram, n8n).
# ──────────────────────────────────────────────────────────────────────────

{ set +x; } 2>/dev/null   # never trace: values below are secrets

LAST_STEP=5
DRY_RUN=0
ONLY_STEP=""
FROM_STEP=""
SUBCOMMAND=""
LI_REDIRECT="http://localhost:8976/callback"
LI_PORT=8976
HTTP_STATUS=""
HTTP_BODY=""

# State lives outside the repository, mode 600, one KEY='VALUE' per line.
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/pearse-dev-wizard"
ENV_FILE="$STATE_DIR/state.env"

usage() {
  cat <<'USAGE'
Usage: credentials.sh [options] [renew-token]

Walks you through the one-off credentials the Scheduler needs: a LinkedIn
member token, a Telegram bot with your chat id, and two n8n credentials.
Nothing is written to the repository; state goes to
${XDG_STATE_HOME:-~/.local/state}/pearse-dev-wizard/state.env (mode 600).

Steps
  1  LinkedIn developer app (client id and secret)
  2  Member token via local OAuth callback (60 days)
  3  Telegram bot and chat id
  4  n8n credentials (linkedin-member, telegram-pearse-dev)
  5  Summary checklist

Options
  --step N     run only step N
  --from N     run steps N..5 (default: resume after the last completed step)
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
import http.server, os, sys, urllib.parse
want, port = os.environ["CB_STATE"], int(os.environ["CB_PORT"])
res = {"code": "", "err": "timed out waiting for the redirect"}
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != "/callback":
            self.send_response(404); self.end_headers(); return
        q = urllib.parse.parse_qs(u.query)
        if q.get("state", [""])[0] != want:
            res["err"] = "state mismatch (possible forged redirect)"
        elif "code" not in q:
            res["err"] = q.get("error_description", q.get("error", ["no code returned"]))[0]
        else:
            res["code"], res["err"] = q["code"][0], ""
        self.send_response(200); self.send_header("Content-Type", "text/plain"); self.end_headers()
        self.wfile.write(b"Done. You can close this tab and return to the terminal.\n")
    def log_message(self, *a): pass
s = http.server.HTTPServer(("127.0.0.1", port), H)
s.timeout = 300
s.handle_request()
if res["err"]:
    sys.stderr.write(res["err"] + "\n"); sys.exit(1)
sys.stdout.write(res["code"])
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
  open_url "$url"
  code=$(CB_STATE="$state" CB_PORT="$LI_PORT" python3 -I -c "$PY_CALLBACK") \
    || die "authorisation failed (see message above); re-run: credentials.sh --step 2"
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
  mark_done 2
}

# ── step 3: Telegram ───────────────────────────────────────────────────────

step_3() {
  stage "Telegram bot and chat id"
  if dry "open https://t.me/BotFather and walk you through /newbot" \
         "ask for the bot token (hidden) and verify it with getMe" \
         "ask you to message the bot, read the chat id from getUpdates, verify with getChat" \
         "save TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to $ENV_FILE (mode 600)"; then return; fi
  local base name chat
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
  chat=$(printf '%s' "$HTTP_BODY" | jget result.-1.message.chat.id) || chat=""
  if [[ -z "$chat" ]]; then
    warn "no message found via getUpdates (is a webhook set on this bot?)"
    ask TELEGRAM_CHAT_ID "Enter your chat id manually:"
    chat="$TELEGRAM_CHAT_ID"
  fi
  [[ "$chat" =~ ^-?[0-9]+$ ]] || die "chat id must be a number, got '$chat'"
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
  local d1 d2 id1="" id2="" ok=1
  say "n8n: Settings -> n8n API -> Create an API key (self-hosted instance)."
  ask N8N_BASE_URL "n8n base URL (e.g. https://n8n.example.org):"
  N8N_BASE_URL="${N8N_BASE_URL%/}"
  [[ "$N8N_BASE_URL" =~ ^https?:// ]] || die "base URL must start with http:// or https://"
  ask_secret N8N_API_KEY "n8n API key (hidden):"
  write_env N8N_BASE_URL "$N8N_BASE_URL" >/dev/null
  write_env N8N_API_KEY "$N8N_API_KEY" >/dev/null
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
  (( DRY_RUN )) && { dry "PATCH $(state_get N8N_BASE_URL)/api/v1/credentials/<linkedin-member id> with the new token (manual instructions if unsupported)"; return; }
  local id base key data body
  id=$(state_get N8N_LINKEDIN_CRED_ID); base=$(state_get N8N_BASE_URL); key=$(state_get N8N_API_KEY)
  if [[ -z "$id" || -z "$base" || -z "$key" ]]; then
    warn "no n8n credential recorded; update 'linkedin-member' in n8n by hand."
    return
  fi
  data=$(D_NAME=Authorization D_VAL="Bearer $(state_get LINKEDIN_ACCESS_TOKEN)" json_build json name D_NAME value D_VAL)
  body=$(D="$data" json_build json data:json D)
  if http_req PATCH "$base/api/v1/credentials/$id" "$(N8N_K="$key" json_build json X-N8N-API-KEY N8N_K)" "$body" \
     && [[ "$HTTP_STATUS" == 200 ]]; then
    say "✓ n8n credential linkedin-member updated."
  else
    warn "n8n API could not update the credential (HTTP ${HTTP_STATUS:-?}). In n8n open 'linkedin-member' and set the header value to 'Bearer <token>'."
    note "token: grep LINKEDIN_ACCESS_TOKEN $ENV_FILE"
  fi
}

# ── step 5: summary ────────────────────────────────────────────────────────

step_5() {
  stage "Summary"
  if dry "print a checklist of what exists where, plus renewal and rate-limit reminders"; then return; fi
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
  printf '\n'
  warn "LinkedIn member tokens last 60 days. Run './automation/setup/credentials.sh renew-token' before then."
  warn "Member posting is limited to 150 requests per day."
  say "n8n stores the secrets for the Scheduler; this repository never does."
  mark_done 5
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
    [[ -z "$v" || "$v" =~ ^[1-5]$ ]] || die "step must be 1-5, got '$v'"
  done
  [[ -z "$ONLY_STEP" || -z "$FROM_STEP" ]] || die "use --step or --from, not both"

  need_tools
  local top
  if top=$(git rev-parse --show-toplevel 2>/dev/null) && [[ "$STATE_DIR" == "$top"/* ]]; then
    die "state dir $STATE_DIR is inside a git repository; set XDG_STATE_HOME elsewhere"
  fi
  if (( ! DRY_RUN )); then
    (umask 077 && mkdir -p "$STATE_DIR")
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
