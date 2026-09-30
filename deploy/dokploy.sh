#!/usr/bin/env bash
# Deploy your own Agent Office to a Dokploy server with one command, using Dokploy's API.
#
#   deploy/dokploy.sh up --url https://dokploy.example.com   create the office, build it, open it
#   deploy/dokploy.sh open                                   tunnel to the office and open it
#   deploy/dokploy.sh destroy                                delete it and its volume (asks first)
#
# The office is never on the internet: it listens on 127.0.0.1 in its container, and everyone
# reaches it through an SSH tunnel to the container's sshd, published on one port of the Dokploy
# server (2222 unless you pick another). What it keeps (accounts, floors, projects, sign-ins,
# teammates' keys, the SSH host key) is on a Docker volume at /data, so restarts and redeploys lose
# none of it. Dokploy builds deploy/container/Dockerfile from this checkout, uploaded as a zip.
# Run `deploy/dokploy.sh help` for all commands and options.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NAME="agent-office"
URL_ARG="${DOKPLOY_URL:-}"
API_KEY_ARG="${DOKPLOY_API_KEY:-}"
SERVER_ARG=""
SERVER_PICK="" # its ID in Dokploy
SSH_HOST_ARG=""
SSH_PORT_ARG=""
GH_TOKEN_ARG=""
NO_GH_TOKEN=0
CLAUDE_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"
ANTHROPIC_KEY=""
YES=0
NO_OPEN=0
DOCKERFILE="deploy/container/Dockerfile"
DEFAULT_SSH_PORT=2222  # the port on the Dokploy server that leads to the container's sshd
SSH_USER="agentoffice" # your key's shell in the container: the user that runs the office
TEAM_USER="office"     # teammates' keys log in as this user, which can only tunnel to the office
OFFICE_PORT=4600       # where the office listens in the container (127.0.0.1 only)
LOCAL_PORT=4600
LOCAL_PORT_SET=0

usage() {
  cat <<'EOF'
Agent Office on Dokploy — one command up, one command down.

Usage: deploy/dokploy.sh <command> [options]

The office is never on the internet. It listens on 127.0.0.1 in its container, and everyone reaches
it through an SSH tunnel on http://localhost:4600, to the container's sshd on one port of your
Dokploy server. Accounts, floors, projects, sign-ins and teammates' keys live on a Docker volume, so
they survive restarts and redeploys.

The first `up` needs your Dokploy's address and an API key (Dokploy: Settings → Profile →
API/CLI Keys); both are remembered for this office after that.

Commands
  up                 Create (or reuse) the Dokploy project and application, upload this checkout for
                     Dokploy to build, start the office, then open it in your browser. The first
                     page shows the office password ONCE.
  open               Tunnel to your office and open it in the browser (Ctrl-C closes the tunnel)
  update             Upload and build this checkout again, and redeploy it (running workers stop,
                     and come back where they left off)
  restart            Restart the office's container without rebuilding it
  destroy            Delete the office's application and its volume, and the project if nothing
                     else is in it (asks you to type the office name first). `down` does the same.

  service <port>     Open a worker's web server from the office's 🌐 Services board on
                     http://localhost:<port> (through the office; Ctrl-C closes the tunnel)
  invite <gh-user>   Let a teammate tunnel in with the SSH keys on their GitHub account, and
                     print the one command to send them. Or: invite <name> <public-key-file>
  uninvite <name>    Remove a teammate's keys and drop open tunnels
  team               List who is invited
  status             Show the application, the last deployment, the SSH address and whether the
                     office is up
  ssh                A shell in the container, as the user that runs the office
  logs               Follow the office's logs
  reset-password     Forget the password and show a new one once in your browser

Options
  --name <name>             Office name (default: agent-office). Several offices = several projects
  --url <url>               Your Dokploy, like https://dokploy.example.com (default: $DOKPLOY_URL)
  --api-key <key>           A Dokploy API key (default: $DOKPLOY_API_KEY). Leave its rate limit off:
                            the script checks on builds every few seconds.
  --server <name|id>        Run the office on one of Dokploy's remote servers instead of Dokploy's
                            own (needed on Dokploy Cloud)
  --ssh-port <n>            Port on the server that leads to the office's SSH (default: 2222)
  --ssh-host <host>         Address you and teammates SSH to (default: the server's IP in Dokploy)
  --port <n>                Local port for the tunnel (default: 4600, or the next free one)
  --github-token <token>    GitHub token for private repos + the issue/PR boards
                            (default: your local `gh auth token`)
  --no-github-token         Don't put any GitHub token in the office
  --claude-token <token>    Claude subscription token from `claude setup-token`
                            (default: $CLAUDE_CODE_OAUTH_TOKEN). Without one, log in from the
                            first worker's terminal in the office.
  --anthropic-api-key <key> Use an Anthropic API key instead
  --no-open                 Don't open the browser (up: don't open the tunnel either)
  -y, --yes                 Don't ask for confirmation
EOF
}

say() { printf '\033[1;35m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31m✗\033[0m %s\n' "$*" >&2
  exit 1
}

# The first word that isn't an option is the command; options can go before or after it (the office
# suggests `deploy/dokploy.sh --name <name> service <port>`).
CMD=""
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name | --url | --api-key | --server | --ssh-port | --ssh-host | --port | --github-token | --claude-token | --anthropic-api-key)
      [[ $# -ge 2 ]] || die "$1 needs a value (see: deploy/dokploy.sh help)" ;;
  esac
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --url) URL_ARG="$2"; shift 2 ;;
    --api-key) API_KEY_ARG="$2"; shift 2 ;;
    --server) SERVER_ARG="$2"; shift 2 ;;
    --ssh-port) SSH_PORT_ARG="$2"; shift 2 ;;
    --ssh-host) SSH_HOST_ARG="$2"; shift 2 ;;
    --port) LOCAL_PORT="$2"; LOCAL_PORT_SET=1; shift 2 ;;
    --github-token) GH_TOKEN_ARG="$2"; shift 2 ;;
    --no-github-token) NO_GH_TOKEN=1; shift ;;
    --claude-token) CLAUDE_TOKEN="$2"; shift 2 ;;
    --anthropic-api-key) ANTHROPIC_KEY="$2"; shift 2 ;;
    --no-open) NO_OPEN=1; shift ;;
    -y | --yes) YES=1; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) die "unknown option $1 (see: deploy/dokploy.sh help)" ;;
    *)
      if [[ -z "$CMD" ]]; then CMD="$1"; else POSITIONAL+=("$1"); fi
      shift
      ;;
  esac
done
CMD="${CMD:-help}"

[[ "$NAME" =~ ^[a-zA-Z0-9-]+$ ]] || die "--name may only contain letters, numbers and dashes"
[[ "$LOCAL_PORT" =~ ^[0-9]+$ && $LOCAL_PORT -gt 0 && $LOCAL_PORT -lt 65536 ]] || die "--port must be a port number"
[[ -z "$SSH_PORT_ARG" || ("$SSH_PORT_ARG" =~ ^[0-9]+$ && $SSH_PORT_ARG -gt 0 && $SSH_PORT_ARG -lt 65536) ]] || die "--ssh-port must be a port number"
[[ "$API_KEY_ARG" != *[[:space:]]* ]] || die "the API key has spaces in it"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/agent-office/dokploy/$NAME"
NAME_FLAG=""
[[ "$NAME" != "agent-office" ]] && NAME_FLAG=" --name $NAME"
KEY_FILE="$STATE_DIR/id_ed25519"
KNOWN_HOSTS="$STATE_DIR/known_hosts"
CLAIM_FILE="$STATE_DIR/claim-token"
API_KEY_FILE="$STATE_DIR/api-key" # "x-api-key: <key>", read by curl -H @file so the key stays out of ps
IDS_FILE="$STATE_DIR/dokploy.env"  # DOKPLOY_URL PROJECT_ID ENVIRONMENT_ID APPLICATION_ID APP_NAME SERVER_ID VOLUME_NAME SSH_HOST SSH_PORT
DOKPLOY_URL="" PROJECT_ID="" ENVIRONMENT_ID="" APPLICATION_ID="" APP_NAME="" SERVER_ID="" VOLUME_NAME="" SSH_HOST="" SSH_PORT=""

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required (${2:-install it first})"; }

# Evaluates a JavaScript expression over the JSON on stdin (as j) and prints the result: json 'j.id'
json() {
  node -e 'let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const v = new Function("j", `return (${process.argv[1]})`)(JSON.parse(s));
      if (v !== undefined && v !== null) console.log(typeof v === "object" ? JSON.stringify(v) : String(v));
    });' "$1"
}

# Prints the JSON a JavaScript expression makes of the other arguments (as v[0], v[1]…). They go to
# node through its environment, so tokens never show in ps: mkjson '({id: v[0]})' "$ID"
mkjson() {
  local expr="$1" i=0 v
  shift
  (
    for v in "$@"; do
      export "J$i=$v"
      i=$((i + 1))
    done
    node -e 'const v = [];
      for (let i = 0; process.env["J" + i] !== undefined; i++) v.push(process.env["J" + i]);
      console.log(JSON.stringify(new Function("v", `return (${process.argv[1]})`)(v)));' "$expr"
  )
}

load_ids() {
  # shellcheck disable=SC1090
  [[ -f "$IDS_FILE" ]] && source "$IDS_FILE"
  [[ -z "$URL_ARG" ]] || DOKPLOY_URL="$URL_ARG"
  if [[ -n "$DOKPLOY_URL" ]]; then
    [[ "$DOKPLOY_URL" =~ ^https?:// ]] || DOKPLOY_URL="https://$DOKPLOY_URL"
    DOKPLOY_URL="${DOKPLOY_URL%/}"
  fi
  # A key given now replaces the remembered one (once there's an office to remember it for).
  if [[ -n "$API_KEY_ARG" && -d "$STATE_DIR" ]]; then
    (umask 077 && printf 'x-api-key: %s\n' "$API_KEY_ARG" >"$API_KEY_FILE")
  fi
  return 0
}

save_ids() {
  printf 'DOKPLOY_URL=%q PROJECT_ID=%q ENVIRONMENT_ID=%q APPLICATION_ID=%q APP_NAME=%q SERVER_ID=%q VOLUME_NAME=%q SSH_HOST=%q SSH_PORT=%q\n' \
    "$DOKPLOY_URL" "$PROJECT_ID" "$ENVIRONMENT_ID" "$APPLICATION_ID" "$APP_NAME" "$SERVER_ID" "$VOLUME_NAME" "$SSH_HOST" "$SSH_PORT" >"$IDS_FILE"
}

preflight() {
  need ssh
  need curl
  need node "https://nodejs.org"
  load_ids
}

require_office() {
  [[ -n "$APPLICATION_ID" && -n "$SSH_HOST" && -n "$SSH_PORT" ]] ||
    die "no office named \"$NAME\" on Dokploy — run: deploy/dokploy.sh up --url <your Dokploy>$NAME_FLAG"
}

random_token() { od -An -N24 -tx1 /dev/urandom | tr -d ' \n'; }

open_url() {
  local url="$1"
  if [[ $NO_OPEN -eq 1 ]]; then return; fi
  if command -v open >/dev/null 2>&1; then open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 &
  elif command -v wslview >/dev/null 2>&1; then wslview "$url"
  elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$url"
  fi
}

# --- Dokploy ---------------------------------------------------------------------------------------

# Calls Dokploy's API: api GET <procedure> [query]   or   api POST <procedure> <JSON body>
# Prints the answer. On an error it says what Dokploy said (on stderr) and fails: with 4 when what
# was asked for isn't there (saying nothing), 5 when this Dokploy's API has no such procedure, 1
# otherwise.
api() {
  local method="$1" proc="$2" arg="${3:-}" out code body msg
  if [[ "$method" == GET ]]; then
    out=$(curl -sS --max-time 60 -H @"$API_KEY_FILE" -w '\n%{http_code}' "$DOKPLOY_URL/api/$proc${arg:+?$arg}" 2>&1) ||
      { warn "couldn't reach Dokploy at $DOKPLOY_URL: $(head -n 1 <<<"$out")"; return 1; }
  else
    out=$(printf '%s' "$arg" | curl -sS --max-time 120 -H @"$API_KEY_FILE" -H 'Content-Type: application/json' \
      --data-binary @- -w '\n%{http_code}' "$DOKPLOY_URL/api/$proc" 2>&1) ||
      { warn "couldn't reach Dokploy at $DOKPLOY_URL: $(head -n 1 <<<"$out")"; return 1; }
  fi
  code="${out##*$'\n'}"
  body="${out%$'\n'*}"
  if [[ "$code" == 2?? ]]; then
    printf '%s\n' "$body"
    return 0
  fi
  if [[ "$code" == 404 ]]; then
    [[ $(json 'j.data && j.data.path || ""' <<<"$body" 2>/dev/null) == "$proc" ]] && return 4
    warn "Dokploy's API at $DOKPLOY_URL has no $proc (is it a Dokploy, and a recent one?)"
    return 5
  fi
  msg=$(json 'j.message' <<<"$body" 2>/dev/null) || msg=""
  case "$code" in
    401) msg="Dokploy refused the API key — make one in Dokploy (Settings → Profile → API/CLI Keys) and pass --api-key" ;;
    429) msg="this API key hit its rate limit — make one in Dokploy with rate limiting off, and pass --api-key" ;;
  esac
  warn "Dokploy ($proc): ${msg:-HTTP $code}"
  return 1
}

# Checks that there's a Dokploy to talk to, with a key it takes.
connect() {
  [[ -n "$DOKPLOY_URL" ]] || die "which Dokploy? Pass --url https://dokploy.example.com (or set DOKPLOY_URL)"
  [[ -s "$API_KEY_FILE" ]] ||
    die "no Dokploy API key: make one in Dokploy (Settings → Profile → API/CLI Keys), then pass --api-key <key> (or set DOKPLOY_API_KEY)"
  api GET user.get >/dev/null || die "couldn't use Dokploy's API at $DOKPLOY_URL"
}

# The office's page in Dokploy: its deployments, their build logs, its environment and ports.
app_url() { echo "$DOKPLOY_URL/dashboard/project/$PROJECT_ID/environment/$ENVIRONMENT_ID/services/application/$APPLICATION_ID"; }

# Whether Dokploy still has something: exists project.one projectId=<id>. Only an answer can say it's
# gone: when Dokploy can't be asked, this dies, so nothing gets made again or forgotten over an
# office that's still running.
exists() {
  local rc=0
  api GET "$1" "$2" >/dev/null || rc=$?
  [[ $rc -eq 0 || $rc -eq 4 ]] || die "couldn't ask Dokploy whether ${2#*=} is still there"
  [[ $rc -eq 0 ]]
}

# The project (with its environment) and the office's application: made once, then remembered in
# $IDS_FILE. Each ID is saved as soon as it exists, so a later step failing never makes the next
# `up` create a second office (or `destroy` miss the first).
ensure_project() {
  local out servers
  # Checked before anything is made. It only places a new application: one that exists stays put.
  if [[ -n "$SERVER_ARG" ]]; then
    servers=$(api GET server.all) || die "couldn't list Dokploy's servers"
    SERVER_PICK=$(mkjson 'JSON.parse(v[0]).filter((s) => s.serverId === v[1] || s.name === v[1]).map((s) => s.serverId)' "$servers" "$SERVER_ARG" |
      json 'j.length === 1 ? j[0] : ""')
    [[ -n "$SERVER_PICK" ]] ||
      die "no server \"$SERVER_ARG\" in Dokploy (or several by that name); its servers: $(json 'j.map((s) => s.name).join(", ") || "none"' <<<"$servers")"
  fi
  if [[ -n "$PROJECT_ID" ]] && ! exists project.one "projectId=$PROJECT_ID"; then
    warn "the Dokploy project for \"$NAME\" is gone; making a new one"
    PROJECT_ID="" ENVIRONMENT_ID="" APPLICATION_ID="" APP_NAME=""
  fi
  if [[ -z "$PROJECT_ID" ]]; then
    out=$(api POST project.create "$(mkjson '({name: v[0], description: "Agent Office (deploy/dokploy.sh)"})' "$NAME")") ||
      die "couldn't create the Dokploy project"
    PROJECT_ID=$(json 'j.project.projectId' <<<"$out")
    ENVIRONMENT_ID=$(json 'j.environment.environmentId' <<<"$out")
    [[ -n "$PROJECT_ID" && -n "$ENVIRONMENT_ID" ]] || die "Dokploy made the project but didn't say its IDs: $out"
    save_ids
    ok "Dokploy project $NAME"
  fi
  if [[ -n "$APPLICATION_ID" ]] && ! exists application.one "applicationId=$APPLICATION_ID"; then
    # The volume (if it's still there) is mounted again, with everything on it.
    warn "the office's application in Dokploy is gone; making a new one"
    APPLICATION_ID="" APP_NAME=""
  fi
  if [[ -z "$APPLICATION_ID" ]]; then
    [[ -z "$SERVER_PICK" ]] || SERVER_ID="$SERVER_PICK"
    out=$(api POST application.create "$(mkjson '({name: "office", appName: v[0], description: "Agent Office (deploy/dokploy.sh)", environmentId: v[1], serverId: v[2] || null})' \
      "$NAME" "$ENVIRONMENT_ID" "$SERVER_ID")") ||
      die "couldn't create the office's application$([[ -n "$SERVER_ID" ]] || echo " (on Dokploy Cloud, pick one of your servers with --server <name>)")"
    APPLICATION_ID=$(json 'j.applicationId' <<<"$out")
    APP_NAME=$(json 'j.appName' <<<"$out")
    [[ -n "$APPLICATION_ID" && -n "$APP_NAME" ]] || die "Dokploy made the application but didn't say its ID: $out"
    save_ids
    ok "Application office ($APP_NAME)"
  fi
}

# How Dokploy builds and runs it, where it keeps its data, and how SSH reaches it.
configure_app() {
  local app port want out
  app=$(api GET application.one "applicationId=$APPLICATION_ID") || die "couldn't read the office's application"
  SERVER_ID=$(json 'j.serverId || ""' <<<"$app")
  [[ -z "$SERVER_PICK" || "$SERVER_PICK" == "$SERVER_ID" ]] ||
    warn "--server only places a new office; this one stays where it is (destroy it first to move it)"

  # deploy/container/Dockerfile, with the whole upload as its context.
  api POST application.saveBuildType "$(mkjson '({applicationId: v[0], buildType: "dockerfile", dockerfile: v[1], dockerContextPath: ".",
    dockerBuildStage: "", herokuVersion: null, railpackVersion: null, publishDirectory: null, isStaticSpa: null})' "$APPLICATION_ID" "$DOCKERFILE")" >/dev/null ||
    die "couldn't set how Dokploy builds the office"
  # Stop the old container before starting the new one: Dokploy's default starts the new one
  # first, which would run two offices on one volume for a moment (and on one SSH port).
  api POST application.update "$(mkjson '({applicationId: v[0],
    updateConfigSwarm: {Parallelism: 1, Order: "stop-first", FailureAction: "rollback"},
    rollbackConfigSwarm: {Parallelism: 1, Order: "stop-first"}})' "$APPLICATION_ID")" >/dev/null ||
    die "couldn't set how Dokploy replaces the office's container"

  # Everything the office keeps goes on this volume (see deploy/container/start.sh).
  if [[ $(json "j.mounts.some((m) => m.mountPath === '/data')" <<<"$app") != true ]]; then
    VOLUME_NAME="${VOLUME_NAME:-$APP_NAME-data}"
    api POST mounts.create "$(mkjson '({type: "volume", volumeName: v[0], mountPath: "/data", serviceType: "application", serviceId: v[1]})' \
      "$VOLUME_NAME" "$APPLICATION_ID")" >/dev/null || die "couldn't add the volume"
    save_ids
    ok "Volume $VOLUME_NAME on /data"
  else
    VOLUME_NAME=$(json "j.mounts.find((m) => m.mountPath === '/data').volumeName || ''" <<<"$app")
  fi

  # The container's sshd on a port of the server: the only way in. Published in host mode, straight
  # from the server's port to the container.
  port=$(json 'j.ports.find((p) => p.targetPort === 22) || ""' <<<"$app")
  want="${SSH_PORT_ARG:-${SSH_PORT:-$DEFAULT_SSH_PORT}}"
  if [[ -z "$port" ]]; then
    api POST port.create "$(mkjson '({publishedPort: Number(v[0]), publishMode: "host", targetPort: 22, protocol: "tcp", applicationId: v[1]})' \
      "$want" "$APPLICATION_ID")" >/dev/null || die "couldn't publish SSH on port $want"
  elif [[ $(json 'j.publishedPort' <<<"$port") != "$want" ]]; then
    api POST port.update "$(mkjson '({portId: JSON.parse(v[0]).portId, publishedPort: Number(v[1]), publishMode: "host", targetPort: 22, protocol: "tcp"})' \
      "$port" "$want")" >/dev/null || die "couldn't move SSH to port $want"
  fi
  SSH_PORT="$want"

  # Where you and teammates SSH to: the server the office runs on.
  if [[ -n "$SSH_HOST_ARG" ]]; then
    SSH_HOST="$SSH_HOST_ARG"
  elif [[ -z "$SSH_HOST" ]]; then
    if [[ -n "$SERVER_ID" ]]; then
      SSH_HOST=$(json 'j.server && j.server.ipAddress || ""' <<<"$app")
    else
      out=$(api GET settings.getIp) && SSH_HOST=$(json 'j' <<<"$out")
    fi
    # Dokploy's own address, when it doesn't know its IP.
    [[ -n "$SSH_HOST" ]] || SSH_HOST=$(sed -E 's#^[a-z]+://([^/:]+).*#\1#' <<<"$DOKPLOY_URL")
  fi
  save_ids
  ok "SSH at $SSH_HOST:$SSH_PORT"
}

# Sets KEY=VALUE environment variables on the office's application, keeping every other one (yours,
# from Dokploy's Environment tab). They reach the container at its next deploy or restart.
set_env() {
  local app
  app=$(api GET application.one "applicationId=$APPLICATION_ID") || die "couldn't read the office's application"
  api POST application.saveEnvironment "$(mkjson '(() => {
    const app = JSON.parse(v[0]), set = v.slice(1);
    const key = (line) => line.replace(/^\s*export\s+/, "").split("=")[0].trim();
    const names = new Set(set.map(key));
    const kept = (app.env || "").split("\n").filter((line) => line.trim() && !names.has(key(line)));
    const lines = set.map((kv) => {
      const i = kv.indexOf("="), value = kv.slice(i + 1);
      if (/[\x27\n]/.test(value)) throw new Error(kv.slice(0, i) + " cannot have quotes or newlines in it");
      return kv.slice(0, i) + "=\x27" + value + "\x27";
    });
    // createEnvFile off: Dokploy would otherwise write these into the build folder as .env.
    return {applicationId: app.applicationId, env: [...kept, ...lines].join("\n"),
      buildArgs: app.buildArgs || "", buildSecrets: app.buildSecrets || "", createEnvFile: false};
  })()' "$app" "$@")" >/dev/null || die "couldn't set the office's environment variables"
}

# "<id> <status>" of the office's latest deployment (running, done, error, cancelled), or "none".
latest_deployment() {
  api GET deployment.all "applicationId=$APPLICATION_ID" | json 'j.length ? j[0].deploymentId + " " + j[0].status : "none"'
}

# This checkout as a zip, as `git add -A` would see it: tracked files with your uncommitted changes,
# and new files .gitignore doesn't leave out, minus local secrets (like Dockerfile.dockerignore).
# Made with a scratch index, so yours is untouched.
make_zip() {
  local dir="$STATE_DIR/upload" index
  mkdir -p "$dir"
  rm -f "$dir/index" "$dir/checkout.zip"
  (
    cd "$REPO_DIR"
    index=$(git rev-parse --path-format=absolute --git-path index)
    [[ ! -f "$index" ]] || cp "$index" "$dir/index"
    export GIT_INDEX_FILE="$dir/index"
    git add -A .
    git rm -r -q --cached --ignore-unmatch -- ':(glob)**/.env*' ':(glob)**/.claude/**' ':(glob)**/.agent-office/**' \
      ':(glob)**/*.pem' ':(glob)**/*.key' ':(glob)**/id_*' ':(glob)**/pw.txt'
    git archive --format=zip -o "$dir/checkout.zip" "$(git write-tree)"
  ) >&2 || die "couldn't pack this checkout"
  echo "$dir/checkout.zip"
}

# Uploads this checkout for Dokploy to build with deploy/container/Dockerfile, and waits for the new
# container's office to answer.
deploy() {
  need git
  git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1 || die "run this from a git clone of agent-office (it uploads the checkout's files)"
  local what zip before was out code i line id st=""
  what=$(git -C "$REPO_DIR" log -1 --format='%h %s')
  [[ -z "$(git -C "$REPO_DIR" status --porcelain)" ]] || what+=", with your uncommitted changes"
  zip=$(make_zip)
  before=$(latest_deployment) || die "couldn't list the office's deployments"
  was=$(started)
  say "Uploading this checkout ($what, $(du -h "$zip" | cut -f1 | tr -d ' ')) for Dokploy to build — a few minutes"
  out=$(curl -sS --max-time 1800 -H @"$API_KEY_FILE" -F "applicationId=$APPLICATION_ID" -F "zip=@$zip;type=application/zip" \
    -w '\n%{http_code}' "$DOKPLOY_URL/api/application.dropDeployment" 2>&1) || die "couldn't upload to Dokploy: $(head -n 1 <<<"$out")"
  rm -f "$zip" "${zip%/*}/index"
  code="${out##*$'\n'}"
  [[ "$code" == 2?? ]] || die "Dokploy didn't take the upload: $(json 'j.message' <<<"${out%$'\n'*}" 2>/dev/null || echo "HTTP $code")"
  for ((i = 0; i < 240; i++)); do
    line=$(latest_deployment 2>/dev/null) || line=""
    id="${line%% *}" st="${line#* }"
    if [[ -n "$line" && "$line" != none && "$id" != "${before%% *}" ]]; then
      case "$st" in
        done) break ;;
        error | cancelled)
          die "the build $([[ $st == error ]] && echo failed || echo was cancelled) — its log is on the office's Deployments tab in Dokploy: $(app_url)" ;;
      esac
    fi
    sleep 5
  done
  [[ "$st" == done ]] || die "the build is still going after 20 minutes — follow it in Dokploy: $(app_url)"
  ok "Built"
  say "Waiting for the new container's office to answer over SSH"
  if [[ -n "$was" ]]; then wait_replaced "$was"; else wait_healthy; fi ||
    die "the office didn't come up — check: deploy/dokploy.sh logs$NAME_FLAG (and that port $SSH_PORT is free on the server, and open in any firewall in front of it)"
  ok "Deployed"
}

# --- SSH -------------------------------------------------------------------------------------------

ssh_opts() {
  echo -p "$SSH_PORT" -i "$KEY_FILE" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KNOWN_HOSTS" \
    -o ConnectTimeout=10 -o ServerAliveInterval=15 -o LogLevel=ERROR
}

remote() {
  [[ -f "$KEY_FILE" ]] || die "the SSH key for this office isn't on this machine ($KEY_FILE)"
  # shellcheck disable=SC2046
  ssh $(ssh_opts) "$SSH_USER@$SSH_HOST" "$@"
}

office_get() { remote "curl -fs --max-time 4 http://127.0.0.1:$OFFICE_PORT$1"; }

wait_healthy() {
  local i rc
  for ((i = 0; i < 40; i++)); do
    rc=0
    remote "for i in \$(seq 60); do curl -fs --max-time 4 http://127.0.0.1:$OFFICE_PORT/api/health >/dev/null && exit 0; sleep 2; done; exit 1" \
      2>/dev/null || rc=$?
    [[ $rc -eq 255 ]] || return "$rc" # 255: ssh itself failed, the container is still starting
    sleep 5
  done
  return 1
}

# When the container's first process started: it changes when Dokploy replaces the container.
started() { remote 'stat -c %Y /proc/1' 2>/dev/null || true; }

# After a restart or redeploy: waits for the new container, then for the office in it.
wait_replaced() {
  local was="$1" i now
  for ((i = 0; i < 60; i++)); do
    now=$(started)
    [[ -n "$now" && "$now" != "$was" ]] && break
    sleep 5
  done
  wait_healthy
}

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null || (exec 3<>"/dev/tcp/::1/$1") 2>/dev/null; }

pick_port() {
  local p
  if [[ $LOCAL_PORT_SET -eq 1 ]]; then
    port_busy "$LOCAL_PORT" && die "localhost:$LOCAL_PORT is already in use"
    echo "$LOCAL_PORT"
    return
  fi
  for ((p = LOCAL_PORT; p < LOCAL_PORT + 50; p++)); do
    port_busy "$p" || { echo "$p"; return; }
  done
  die "no free local port from $LOCAL_PORT up (pick one with --port)"
}

# Forward localhost:<port> to the office in the container, open the browser, and hold until Ctrl-C.
tunnel() {
  local path="$1" port pid i up=0
  port=$(pick_port) || exit 1
  # shellcheck disable=SC2046
  ssh $(ssh_opts) -N -o ExitOnForwardFailure=yes -L "$port:127.0.0.1:$OFFICE_PORT" "$SSH_USER@$SSH_HOST" &
  pid=$!
  trap 'kill "$pid" 2>/dev/null; echo; ok "Tunnel closed"; exit 0' INT TERM
  for ((i = 0; i < 40; i++)); do
    kill -0 "$pid" 2>/dev/null || die "couldn't open the SSH tunnel to $SSH_HOST:$SSH_PORT"
    curl -fs --max-time 2 "http://localhost:$port/api/health" >/dev/null 2>&1 && { up=1; break; }
    sleep 0.5
  done
  if [[ $up -ne 1 ]]; then
    kill "$pid" 2>/dev/null
    die "the tunnel opened but the office didn't answer through it — check: deploy/dokploy.sh logs$NAME_FLAG"
  fi
  ok "Your office: http://localhost:$port$path"
  echo "   (tunneled over SSH to $SSH_HOST:$SSH_PORT — keep this running while you use it; Ctrl-C closes it)"
  open_url "http://localhost:$port$path"
  wait "$pid" || true
  trap - INT TERM
  warn "The tunnel dropped — reopen it with: deploy/dokploy.sh open$NAME_FLAG"
}

# A worker's server from the 🌐 Services board: localhost:<port> tunnels to the office, which
# relays it by that port (see src/server/relay.ts), so the local port must match the service's.
service_tunnel() {
  local port="$1" pid i up=0
  port_busy "$port" && die "localhost:$port is already in use on this computer — stop whatever runs there first"
  # shellcheck disable=SC2046
  ssh $(ssh_opts) -N -o ExitOnForwardFailure=yes -L "$port:127.0.0.1:$OFFICE_PORT" "$SSH_USER@$SSH_HOST" &
  pid=$!
  trap 'kill "$pid" 2>/dev/null; echo; ok "Tunnel closed"; exit 0' INT TERM
  for ((i = 0; i < 40; i++)); do
    kill -0 "$pid" 2>/dev/null || die "couldn't open the SSH tunnel to $SSH_HOST:$SSH_PORT"
    port_busy "$port" && { up=1; break; }
    sleep 0.5
  done
  [[ $up -eq 1 ]] || { kill "$pid" 2>/dev/null; die "the tunnel didn't come up"; }
  ok "The worker's server: http://localhost:$port"
  echo "   (through the office — sign in with the office password if it asks; Ctrl-C closes it)"
  open_url "http://localhost:$port"
  wait "$pid" || true
  trap - INT TERM
  warn "The tunnel dropped — reopen it with: deploy/dokploy.sh service $port$NAME_FLAG"
}

open_office() {
  local claimable path="/"
  claimable=$(office_get /api/claim 2>/dev/null || true)
  if [[ "$claimable" == *'"claimable":true'* && -f "$CLAIM_FILE" ]]; then
    path="/claim?t=$(cat "$CLAIM_FILE")"
    say "Opening the one-time password page — write the password down, it is never shown again"
  fi
  tunnel "$path"
}

valid_member() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$ ]] || die "names are letters, numbers, dots, dashes and underscores: $1"; }

team_members() { remote "agent-office-team list"; } # "<name> <number of keys>" per line

# --- commands --------------------------------------------------------------------------------------

cmd_up() {
  need ssh-keygen
  need git
  [[ -f "$REPO_DIR/$DOCKERFILE" ]] || die "run this from a clone of agent-office ($DOCKERFILE is missing)"
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  preflight
  connect

  local gh_token="$GH_TOKEN_ARG"
  if [[ -z "$gh_token" && $NO_GH_TOKEN -eq 0 ]] && command -v gh >/dev/null 2>&1; then
    gh_token=$(gh auth token 2>/dev/null || true)
  fi
  [[ $NO_GH_TOKEN -eq 1 ]] && gh_token=""

  say "Agent Office \"$NAME\" on Dokploy ($DOKPLOY_URL)"
  echo "   app:      this checkout, uploaded for Dokploy to build with $DOCKERFILE"
  echo "   data:     a Docker volume on /data: accounts, floors, projects (~/workspace), sign-ins, team keys"
  echo "   access:   SSH tunnel only (the office is never exposed), on a port of the Dokploy server"
  if [[ -n "$gh_token" ]]; then
    echo "   github:   your GitHub token goes in the office (private clones, issue/PR boards, pushes)"
  else
    echo "   github:   no token — private repos and the boards won't work until gh is signed in"
  fi
  if [[ -n "$CLAUDE_TOKEN" || -n "$ANTHROPIC_KEY" ]]; then
    echo "   claude:   signed in with the token you provided"
  else
    echo "   claude:   not signed in — log in from the first worker's terminal (or pass --claude-token)"
  fi

  [[ -f "$KEY_FILE" ]] || ssh-keygen -q -t ed25519 -N '' -C "agent-office-$NAME" -f "$KEY_FILE"
  [[ -f "$CLAIM_FILE" ]] || (umask 077 && random_token >"$CLAIM_FILE")

  ensure_project
  configure_app

  # Your key gets a shell in the container; the claim link shows the generated password once;
  # teammates are told to SSH to the server's port; the office's panels suggest this script.
  local vars=("AGENT_OFFICE_ADMIN_KEYS=$(cat "$KEY_FILE.pub")" "AGENT_OFFICE_CLAIM_TOKEN=$(cat "$CLAIM_FILE")"
    "AGENT_OFFICE_PUBLIC_HOST=$SSH_HOST:$SSH_PORT" "AGENT_OFFICE_DEPLOY_SCRIPT=deploy/dokploy.sh$NAME_FLAG")
  [[ -z "$CLAUDE_TOKEN" ]] || vars+=("CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_TOKEN")
  [[ -z "$ANTHROPIC_KEY" ]] || vars+=("ANTHROPIC_API_KEY=$ANTHROPIC_KEY")
  set_env "${vars[@]}"

  deploy

  if [[ -n "$gh_token" ]]; then
    say "Signing the GitHub CLI in"
    # Kept in gh's own config on the volume, so gh, git, the boards and the workers all use it.
    printf '%s' "$gh_token" | remote 'gh auth login --hostname github.com --git-protocol https --with-token &&
      gh auth setup-git --hostname github.com && gh api user --jq "\"    as \" + .login"' || warn "couldn't sign the GitHub CLI in"
  fi
  local git_name git_email
  git_name=$(git config user.name 2>/dev/null || true)
  git_email=$(git config user.email 2>/dev/null || true)
  [[ -z "$git_name" ]] || remote "git config --global user.name $(printf '%q' "$git_name")"
  [[ -z "$git_email" ]] || remote "git config --global user.email $(printf '%q' "$git_email")"

  ok "Your office is running on Dokploy (reachable only through SSH)"
  echo
  echo "   Open it later:     deploy/dokploy.sh open$NAME_FLAG"
  echo "   Add a teammate:    the 👥 Invite button in the office, or deploy/dokploy.sh invite <their-github-username>$NAME_FLAG"
  echo "   Update it:         deploy/dokploy.sh update$NAME_FLAG"
  echo "   Tear it down:      deploy/dokploy.sh destroy$NAME_FLAG"
  echo "   In Dokploy:        $(app_url)"
  echo
  [[ $NO_OPEN -eq 1 ]] && return
  open_office
}

cmd_open() {
  preflight
  require_office
  wait_healthy || die "the office isn't answering — check: deploy/dokploy.sh logs$NAME_FLAG"
  open_office
}

cmd_update() {
  preflight
  require_office
  connect
  deploy
  ok "Updated (workers that were running come back where they left off)"
}

cmd_restart() {
  preflight
  require_office
  connect
  local was
  was=$(started)
  api POST application.reload "$(mkjson '({applicationId: v[0], appName: v[1]})' "$APPLICATION_ID" "$APP_NAME")" >/dev/null ||
    die "couldn't restart the office"
  say "Restarting"
  wait_replaced "$was" || die "the office didn't come back — check: deploy/dokploy.sh logs$NAME_FLAG"
  ok "Restarted"
}

cmd_service() {
  preflight
  [[ ${#POSITIONAL[@]} -eq 1 && "${POSITIONAL[0]}" =~ ^[0-9]+$ && ${POSITIONAL[0]} -gt 0 && ${POSITIONAL[0]} -lt 65536 ]] ||
    die "usage: deploy/dokploy.sh service <port>   (a port from the office's 🌐 Services board)"
  [[ "${POSITIONAL[0]}" -ne $OFFICE_PORT ]] || die "$OFFICE_PORT is the office itself — use: deploy/dokploy.sh open"
  require_office
  service_tunnel "${POSITIONAL[0]}"
}

cmd_status() {
  preflight
  if [[ -z "$APPLICATION_ID" ]]; then
    echo "No office named \"$NAME\" on Dokploy."
    return
  fi
  connect
  local app deployment
  app=$(api GET application.one "applicationId=$APPLICATION_ID") || die "couldn't read the office's application"
  deployment=$(latest_deployment) || deployment=""
  echo "office:     $NAME (Dokploy application $APP_NAME$([[ -z "$SERVER_ID" ]] || echo ", on $(json 'j.server && j.server.name' <<<"$app")"))"
  echo "dokploy:    $(app_url)"
  echo "deployment: ${deployment#* } (application: $(json 'j.applicationStatus' <<<"$app"))"
  echo "ssh:        $SSH_HOST:$SSH_PORT  (open the office with: deploy/dokploy.sh open$NAME_FLAG)"
  if [[ -f "$KEY_FILE" ]] && office_get /api/health >/dev/null 2>&1; then
    echo "volume:     $VOLUME_NAME: $(remote "df -h /data | awk 'NR == 2 {print \$3 \" used of \" \$2}'")"
    echo "office:     up"
    local team
    team=$(team_members 2>/dev/null | awk '{printf "%s%s", sep, $1; sep=", "}')
    echo "team:       ${team:-nobody invited yet}"
  else
    echo "volume:     ${VOLUME_NAME:-none}"
    echo "office:     not answering"
  fi
}

cmd_invite() {
  preflight
  [[ ${#POSITIONAL[@]} -ge 1 && ${#POSITIONAL[@]} -le 2 ]] ||
    die "usage: deploy/dokploy.sh invite <github-username>   or   deploy/dokploy.sh invite <name> <public-key-file>"
  local who="${POSITIONAL[0]}" src raw
  valid_member "$who"
  if [[ ${#POSITIONAL[@]} -eq 2 ]]; then
    src="${POSITIONAL[1]}"
    [[ -f "$src" ]] || die "no such file: $src"
    raw=$(cat "$src")
  else
    src="github.com/$who.keys"
    raw=$(curl -fsS --max-time 10 "https://github.com/$who.keys") || die "couldn't fetch https://$src"
  fi
  [[ -n "$raw" ]] || die "no SSH public keys found in $src"
  require_office
  local n fp
  # The container keeps only valid keys and restricts each one to opening the tunnel.
  n=$(printf '%s\n' "$raw" | remote "agent-office-team add $who") || die "couldn't add $who's keys from $src"
  ok "$who is invited ($n key(s) from $src)"
  fp=$(remote "agent-office-team fingerprint")
  echo
  echo "   Send $who this:"
  echo
  echo "     ssh -L 4600:localhost:$OFFICE_PORT ssh://$TEAM_USER@$SSH_HOST:$SSH_PORT"
  echo
  echo "     Leave it running, open http://localhost:4600 and sign in with the office password."
  echo "     The first time, ssh asks you to trust the server. Only say yes if it shows"
  echo "     ED25519 key fingerprint $fp"
  echo
}

cmd_uninvite() {
  preflight
  [[ ${#POSITIONAL[@]} -eq 1 ]] || die "usage: deploy/dokploy.sh uninvite <name>"
  local who="${POSITIONAL[0]}" out rc=0
  valid_member "$who"
  require_office
  out=$(remote "agent-office-team remove $who" 2>&1) || rc=$?
  [[ $rc -eq 66 ]] && die "$who isn't invited (see: deploy/dokploy.sh team$NAME_FLAG)"
  [[ $rc -eq 0 ]] || die "couldn't remove the keys: $out"
  ok "$who's keys are removed and open tunnels were dropped (other teammates just reconnect)"
  echo "   They still know the office password. To change it: deploy/dokploy.sh reset-password$NAME_FLAG"
}

cmd_team() {
  preflight
  require_office
  local list
  list=$(team_members)
  if [[ -z "$list" ]]; then
    echo "Nobody is invited yet. Add someone: deploy/dokploy.sh invite <github-username>$NAME_FLAG"
    return
  fi
  echo "$list" | awk '{printf "%s  (%d key%s)\n", $1, $2, ($2 == 1 ? "" : "s")}'
}

cmd_ssh() {
  preflight
  require_office
  # shellcheck disable=SC2046
  exec ssh $(ssh_opts) -t "$SSH_USER@$SSH_HOST" "${POSITIONAL[@]+"${POSITIONAL[@]}"}"
}

# The container's output, from Dokploy (which keeps no more than Docker does): the last 100 lines,
# then whatever comes after, until Ctrl-C.
cmd_logs() {
  preflight
  require_office
  connect
  local out last="" since=""
  while :; do
    out=$(api GET application.readLogs "applicationId=$APPLICATION_ID${since:+&since=$since}") || out='""'
    # Each line starts with Docker's timestamp (fixed width, so they sort as text).
    out=$(mkjson 'JSON.parse(v[0]).split("\n").filter((l) => l && l.split(" ")[0] > v[1]).join("\n")' "$out" "$last" | json 'j')
    if [[ -n "$out" ]]; then
      printf '%s\n' "$out"
      last=$(tail -n 1 <<<"$out" | cut -d' ' -f1)
    fi
    since=1m
    sleep 2
  done
}

cmd_reset_password() {
  preflight
  require_office
  connect
  (umask 077 && random_token >"$CLAIM_FILE")
  say "Resetting the office password"
  set_env "AGENT_OFFICE_CLAIM_TOKEN=$(cat "$CLAIM_FILE")"
  local was
  was=$(started)
  remote "node /opt/agent-office/bin/agent-office.js --reset-password >/dev/null" || die "reset failed"
  # A restart, so the office starts with the new claim token (and makes the new password).
  api POST application.reload "$(mkjson '({applicationId: v[0], appName: v[1]})' "$APPLICATION_ID" "$APP_NAME")" >/dev/null ||
    die "couldn't restart the office"
  wait_replaced "$was" || die "the office didn't come back — check: deploy/dokploy.sh logs$NAME_FLAG"
  ok "Everyone has been signed out"
  open_office
}

cmd_down() {
  preflight
  if [[ -z "$PROJECT_ID" && -z "$APPLICATION_ID" ]]; then
    echo "Nothing to delete for \"$NAME\"."
    rm -rf "$STATE_DIR"
    return
  fi
  connect
  # The state directory (this office's SSH key, claim token, API key and IDs) goes only once the
  # office has: exists dies when Dokploy can't say, and a failed delete stops here.
  local have_app=0 i rc out others
  [[ -n "$APPLICATION_ID" ]] && exists application.one "applicationId=$APPLICATION_ID" && have_app=1
  say "This permanently deletes office \"$NAME\" from $DOKPLOY_URL: the application${VOLUME_NAME:+, the volume $VOLUME_NAME} and everything on it."
  echo "   Anything in the office that isn't pushed to GitHub is lost."
  if [[ $YES -ne 1 ]]; then
    read -r -p "   Type the office name ($NAME) to confirm: " answer
    [[ "$answer" == "$NAME" ]] || die "cancelled"
  fi
  if [[ $have_app -eq 1 ]]; then
    api POST application.delete "$(mkjson '({applicationId: v[0]})' "$APPLICATION_ID")" >/dev/null || die "couldn't delete the office's application"
    ok "Application deleted (its container is stopped and removed)"
  else
    ok "The office's application is already deleted"
  fi
  APPLICATION_ID=""
  save_ids

  # Dokploy leaves an application's volumes behind. It's in use until the container is gone.
  if [[ -n "$VOLUME_NAME" ]]; then
    for ((i = 0; i < 24; i++)); do
      rc=0
      out=$(api POST dockerVolume.removeVolume "$(mkjson '({volumeName: v[0], serverId: v[1] || undefined})' "$VOLUME_NAME" "$SERVER_ID")" 2>&1) || rc=$?
      [[ $rc -eq 0 || $rc -eq 4 || $rc -eq 5 || "$out" == *"no such volume"* ]] && break
      sleep 5
    done
    if [[ $rc -eq 0 || $rc -eq 4 || "$out" == *"no such volume"* ]]; then
      ok "Volume $VOLUME_NAME deleted"
    elif [[ $rc -eq 5 ]]; then
      warn "this Dokploy can't delete volumes through its API. On the server, run: docker volume rm $VOLUME_NAME"
    else
      die "couldn't delete the volume $VOLUME_NAME: ${out:-no answer} (run this again to retry)"
    fi
  fi

  # The project too, unless you've put something else in it.
  if [[ -n "$PROJECT_ID" ]] && exists project.one "projectId=$PROJECT_ID"; then
    others=$(api GET project.one "projectId=$PROJECT_ID" |
      json 'j.environments.reduce((n, e) => n + ["applications", "compose", "libsql", "mariadb", "mongo", "mysql", "postgres", "redis"].reduce((m, k) => m + (e[k] || []).length, 0), 0)') ||
      die "couldn't read the Dokploy project"
    if [[ "$others" -eq 0 ]]; then
      api POST project.remove "$(mkjson '({projectId: v[0]})' "$PROJECT_ID")" >/dev/null || die "couldn't delete the Dokploy project"
      ok "Dokploy project $NAME deleted"
    else
      warn "left the Dokploy project \"$NAME\" in place: it has $others other service(s) in it"
    fi
  fi
  rm -rf "$STATE_DIR"
  ok "All gone"
}

case "$CMD" in
  up) cmd_up ;;
  open) cmd_open ;;
  update) cmd_update ;;
  restart) cmd_restart ;;
  service) cmd_service ;;
  status) cmd_status ;;
  invite) cmd_invite ;;
  uninvite) cmd_uninvite ;;
  team) cmd_team ;;
  ssh) cmd_ssh ;;
  logs) cmd_logs ;;
  reset-password) cmd_reset_password ;;
  destroy | down) cmd_down ;;
  help | -h | --help) usage ;;
  *) die "unknown command \"$CMD\" (see: deploy/dokploy.sh help)" ;;
esac
