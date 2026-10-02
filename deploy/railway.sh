#!/usr/bin/env bash
# Deploy your own Agent Office to Railway with one command, using the Railway CLI.
#
#   deploy/railway.sh up        create the project, build and start the office, open it
#   deploy/railway.sh open      tunnel to the office and open it in your browser
#   deploy/railway.sh destroy   delete the project, its volume and everything on it (asks first)
#
# The office is never on the internet: it listens on 127.0.0.1 in its container, and everyone
# reaches it through an SSH tunnel to the container's sshd, behind Railway's TCP proxy. What it
# keeps (accounts, floors, projects, sign-ins, teammates' keys, the SSH host key) is on a volume at
# /data, so restarts and redeploys lose none of it. The image is deploy/container/Dockerfile, built
# from this checkout. Run `deploy/railway.sh help` for all commands and options.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NAME="agent-office"
WORKSPACE=""
GH_TOKEN_ARG=""
NO_GH_TOKEN=0
CLAUDE_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"
ANTHROPIC_KEY=""
YES=0
NO_OPEN=0
SERVICE_NAME="office"
DOCKERFILE="deploy/container/Dockerfile"
SSH_USER="agentoffice" # your key's shell in the container: the user that runs the office
TEAM_USER="office"     # teammates' keys log in as this user, which can only tunnel to the office
OFFICE_PORT=4600       # where the office listens in the container (127.0.0.1 only)
LOCAL_PORT=4600
LOCAL_PORT_SET=0

usage() {
  cat <<'EOF'
Agent Office on Railway — one command up, one command down.

Usage: deploy/railway.sh <command> [options]

The office is never on the internet. It listens on 127.0.0.1 in its container, and everyone reaches
it through an SSH tunnel on http://localhost:4600, to the container's sshd behind Railway's TCP proxy.
Accounts, floors, projects, sign-ins and teammates' keys live on a volume, so they survive restarts
and redeploys.

Commands
  up                 Create (or reuse) the Railway project, build this checkout and start the office,
                     then open it in your browser. The first page shows the office password ONCE.
  open               Tunnel to your office and open it in the browser (Ctrl-C closes the tunnel)
  update             Build this checkout again and redeploy it (running workers stop, and come back
                     where they left off)
  restart            Restart the office's container without rebuilding it
  destroy            Delete the Railway project: the office, its volume and everything on it (asks
                     you to type the office name first). `down` does the same.

  service <port>     Open a worker's web server from the office's 🌐 Services board on
                     http://localhost:<port> (through the office; Ctrl-C closes the tunnel)
  invite <gh-user>   Let a teammate tunnel in with the SSH keys on their GitHub account, and
                     print the one command to send them. Or: invite <name> <public-key-file>
  uninvite <name>    Remove a teammate's keys and drop open tunnels
  team               List who is invited
  status             Show the project, the deployment, the SSH address and whether the office is up
  ssh                A shell in the container, as the user that runs the office
  logs               Follow the office's logs
  reset-password     Forget the password and show a new one once in your browser

Options
  --name <name>             Office name (default: agent-office). Several offices = several projects
  --workspace <name|id>     Railway workspace for a new project (needed if you're in more than one)
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
# suggests `deploy/railway.sh --name <name> service <port>`).
CMD=""
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name | --workspace | --port | --github-token | --claude-token | --anthropic-api-key)
      [[ $# -ge 2 ]] || die "$1 needs a value (see: deploy/railway.sh help)" ;;
  esac
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --port) LOCAL_PORT="$2"; LOCAL_PORT_SET=1; shift 2 ;;
    --github-token) GH_TOKEN_ARG="$2"; shift 2 ;;
    --no-github-token) NO_GH_TOKEN=1; shift ;;
    --claude-token) CLAUDE_TOKEN="$2"; shift 2 ;;
    --anthropic-api-key) ANTHROPIC_KEY="$2"; shift 2 ;;
    --no-open) NO_OPEN=1; shift ;;
    -y | --yes) YES=1; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) die "unknown option $1 (see: deploy/railway.sh help)" ;;
    *)
      if [[ -z "$CMD" ]]; then CMD="$1"; else POSITIONAL+=("$1"); fi
      shift
      ;;
  esac
done
CMD="${CMD:-help}"

[[ "$NAME" =~ ^[a-zA-Z0-9-]+$ ]] || die "--name may only contain letters, numbers and dashes"
[[ "$LOCAL_PORT" =~ ^[0-9]+$ && $LOCAL_PORT -gt 0 && $LOCAL_PORT -lt 65536 ]] || die "--port must be a port number"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/agent-office/railway/$NAME"
NAME_FLAG=""
[[ "$NAME" != "agent-office" ]] && NAME_FLAG=" --name $NAME"
KEY_FILE="$STATE_DIR/id_ed25519"
KNOWN_HOSTS="$STATE_DIR/known_hosts"
CLAIM_FILE="$STATE_DIR/claim-token"
IDS_FILE="$STATE_DIR/railway.env" # PROJECT_ID ENVIRONMENT_ID SERVICE_ID SSH_HOST SSH_PORT
PROJECT_ID="" ENVIRONMENT_ID="" SERVICE_ID="" SSH_HOST="" SSH_PORT=""

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required (${2:-install it first})"; }

# Evaluates a JavaScript expression over the JSON on stdin (as j) and prints the result: json 'j.id'
json() {
  node -e 'let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const v = new Function("j", `return (${process.argv[1]})`)(JSON.parse(s));
      if (v !== undefined && v !== null) console.log(typeof v === "object" ? JSON.stringify(v) : String(v));
    });' "$1"
}

# The Railway CLI, run in the state directory (`railway init` links it to the office's project).
rw() { (cd "$STATE_DIR" && railway "$@"); }
svc() { echo -s "$SERVICE_ID" -e "$ENVIRONMENT_ID"; }

preflight() {
  need railway "https://docs.railway.com/cli"
  railway tcp-proxy --help >/dev/null 2>&1 || die "this Railway CLI has no tcp-proxy command — upgrade it: railway upgrade (or brew upgrade railway)"
  need ssh
  need curl
  need node "https://nodejs.org"
  railway whoami >/dev/null 2>&1 || die "the Railway CLI isn't logged in (run: railway login)"
}

load_ids() {
  # shellcheck disable=SC1090
  [[ -f "$IDS_FILE" ]] && source "$IDS_FILE"
  return 0
}

save_ids() {
  printf 'PROJECT_ID=%q ENVIRONMENT_ID=%q SERVICE_ID=%q SSH_HOST=%q SSH_PORT=%q\n' \
    "$PROJECT_ID" "$ENVIRONMENT_ID" "$SERVICE_ID" "$SSH_HOST" "$SSH_PORT" >"$IDS_FILE"
}

require_office() {
  load_ids
  [[ -n "$SERVICE_ID" && -n "$SSH_HOST" ]] || die "no office named \"$NAME\" on Railway — run: deploy/railway.sh up$NAME_FLAG"
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

# --- Railway ---------------------------------------------------------------------------------------

# Whether $PROJECT_ID is still on Railway (a deleted one stays listed for a while, with deletedAt).
# Only a listing that worked can say it's gone: when Railway can't be asked (network, login, 2FA),
# this dies, so nothing gets made again or forgotten over a project that's still running.
project_exists() {
  local list found
  list=$(railway list --json </dev/null) ||
    die "couldn't list your Railway projects, so can't tell whether \"$NAME\" ($PROJECT_ID) is still there — check: railway whoami"
  found=$(json "Array.isArray(j) ? j.some((p) => p.id === '$PROJECT_ID' && !p.deletedAt) : 'unreadable'" <<<"$list" 2>/dev/null) || found=""
  [[ "$found" == true || "$found" == false ]] ||
    die "couldn't read Railway's list of projects (railway list --json), so can't tell whether \"$NAME\" ($PROJECT_ID) is still there"
  [[ "$found" == true ]]
}

# The project, its environment and the office's service: made once, then remembered in $IDS_FILE.
# Each ID is saved as soon as it exists, so a later step failing never makes the next `up` create
# a second project (or `destroy` miss the first).
ensure_project() {
  load_ids
  if [[ -n "$PROJECT_ID" ]] && ! project_exists; then
    warn "the Railway project for \"$NAME\" is gone; making a new one"
    PROJECT_ID="" ENVIRONMENT_ID="" SERVICE_ID="" SSH_HOST="" SSH_PORT=""
  fi
  if [[ -z "$PROJECT_ID" ]]; then
    if [[ -z "$WORKSPACE" ]]; then
      local spaces
      spaces=$(railway whoami --json | json 'j.workspaces.map((w) => w.name).join("\n")')
      [[ $(wc -l <<<"$spaces") -eq 1 ]] || die "you're in several Railway workspaces; pick one with --workspace:
$(sed 's/^/   /' <<<"$spaces")"
      WORKSPACE="$spaces"
    fi
    PROJECT_ID=$(rw init --name "$NAME" --workspace "$WORKSPACE" --json </dev/null 2>/dev/null | json 'j.id') || PROJECT_ID=""
    [[ -n "$PROJECT_ID" ]] ||
      die "couldn't create the Railway project (try: railway init --name $NAME)"
    save_ids
    ok "Railway project $NAME"
  fi
  if [[ -z "$ENVIRONMENT_ID" ]]; then
    ENVIRONMENT_ID=$(rw status --json | json 'j.environments.edges[0].node.id') || ENVIRONMENT_ID=""
    [[ -n "$ENVIRONMENT_ID" ]] || die "couldn't find the Railway project's environment (run this again to retry)"
    save_ids
  fi
  if [[ -z "$SERVICE_ID" ]]; then
    SERVICE_ID=$(rw add --service "$SERVICE_NAME" --json </dev/null 2>/dev/null | json 'j.id') || SERVICE_ID=""
    [[ -n "$SERVICE_ID" ]] || die "couldn't add the office's service (run this again to retry)"
    save_ids
    ok "Service $SERVICE_NAME"
  fi
  # Linked, so plain `railway` commands run in the state directory act on the office's service.
  rw link --project "$PROJECT_ID" --environment "$ENVIRONMENT_ID" --service "$SERVICE_ID" --json </dev/null >/dev/null 2>&1 || true
}

# Everything the office keeps goes on this volume (see deploy/container/start.sh).
ensure_volume() {
  local have
  have=$(rw volume $(svc) list --json | json "j.volumes.filter((v) => v.serviceName === '$SERVICE_NAME' && v.mountPath === '/data').length")
  if [[ "${have:-0}" -eq 0 ]]; then
    rw volume $(svc) add --mount-path /data --json </dev/null >/dev/null || die "couldn't add the volume"
    ok "Volume on /data"
  fi
}

# Railway's TCP proxy in front of the container's sshd: the only way in.
ensure_tcp_proxy() {
  local out="" i
  for ((i = 0; i < 12; i++)); do
    out=$(rw tcp-proxy list $(svc) --json </dev/null 2>/dev/null | json 'j.proxies.find((p) => p.applicationPort === 22)') || out=""
    [[ -n "$out" ]] && break
    # Railway can turn it down for a moment right after the volume is added: try again.
    rw tcp-proxy create $(svc) --port 22 --json </dev/null >/dev/null 2>"$STATE_DIR/tcp-proxy.log" || sleep 5
  done
  [[ -n "$out" ]] || die "couldn't add the TCP proxy: $(tail -n 3 "$STATE_DIR/tcp-proxy.log")"
  SSH_HOST=$(json 'j.domain' <<<"$out")
  SSH_PORT=$(json 'j.proxyPort' <<<"$out")
  [[ -n "$SSH_HOST" && -n "$SSH_PORT" ]] || die "the TCP proxy has no address yet"
  save_ids
  ok "SSH at $SSH_HOST:$SSH_PORT"
}

# The latest deployment's status: BUILDING, DEPLOYING, SUCCESS, FAILED, CRASHED, REMOVED… With a
# deployment ID, WAITING until that one is the latest.
deploy_status() {
  rw service status $(svc) --json </dev/null 2>/dev/null | json "'${1:-}' && j.deploymentId !== '${1:-}' ? 'WAITING' : j.status" || true
}

# Builds this checkout with deploy/container/Dockerfile and deploys it.
deploy() {
  local log="$STATE_DIR/build.log" what
  what=$(git -C "$REPO_DIR" log -1 --format='%h %s' 2>/dev/null || echo 'not a git checkout')
  [[ -z "$(git -C "$REPO_DIR" status --porcelain 2>/dev/null)" ]] || what+=", with your uncommitted changes"
  say "Building and deploying this checkout ($what) — a few minutes"
  if ! rw up "$REPO_DIR" --path-as-root $(svc) --ci </dev/null >"$log" 2>&1; then
    tail -n 40 "$log" >&2
    die "the build failed (the whole log: $log)"
  fi
  ok "Built"
  local i st="" id
  # This upload's deployment (from its link in the log), so the one before it doesn't count.
  id=$(sed -n 's/.*[?&]id=\([0-9a-f-]*\).*/\1/p' "$log" | head -n 1)
  for ((i = 0; i < 120; i++)); do
    st=$(deploy_status "$id")
    case "$st" in
      SUCCESS) ok "Deployed"; return ;;
      FAILED | CRASHED | REMOVED) die "the deployment $(tr '[:upper:]' '[:lower:]' <<<"$st") — check: deploy/railway.sh logs$NAME_FLAG" ;;
    esac
    sleep 5
  done
  die "the deployment is still ${st:-starting} after 10 minutes — check: deploy/railway.sh logs$NAME_FLAG"
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

# When the container's first process started: it changes when Railway replaces the container.
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
    die "the tunnel opened but the office didn't answer through it — check: deploy/railway.sh logs$NAME_FLAG"
  fi
  ok "Your office: http://localhost:$port$path"
  echo "   (tunneled over SSH to $SSH_HOST:$SSH_PORT — keep this running while you use it; Ctrl-C closes it)"
  echo "   Workers' web servers open on this computer too, by themselves, with (in another terminal): agent-office tunnel http://localhost:$port"
  open_url "http://localhost:$port$path"
  wait "$pid" || true
  trap - INT TERM
  warn "The tunnel dropped — reopen it with: deploy/railway.sh open$NAME_FLAG"
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
  warn "The tunnel dropped — reopen it with: deploy/railway.sh service $port$NAME_FLAG"
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
  preflight
  need ssh-keygen
  [[ -f "$REPO_DIR/$DOCKERFILE" ]] || die "run this from a clone of agent-office ($DOCKERFILE is missing)"

  local gh_token="$GH_TOKEN_ARG"
  if [[ -z "$gh_token" && $NO_GH_TOKEN -eq 0 ]] && command -v gh >/dev/null 2>&1; then
    gh_token=$(gh auth token 2>/dev/null || true)
  fi
  [[ $NO_GH_TOKEN -eq 1 ]] && gh_token=""

  say "Agent Office \"$NAME\" on Railway ($(railway whoami --json 2>/dev/null | json 'j.name || j.email' || true))"
  echo "   app:      this checkout, built with $DOCKERFILE"
  echo "   data:     a volume on /data: accounts, floors, projects (~/workspace), sign-ins, team keys"
  echo "   access:   SSH tunnel only (the office is never exposed), through Railway's TCP proxy"
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

  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  [[ -f "$KEY_FILE" ]] || ssh-keygen -q -t ed25519 -N '' -C "agent-office-$NAME" -f "$KEY_FILE"
  [[ -f "$CLAIM_FILE" ]] || (umask 077 && random_token >"$CLAIM_FILE")

  ensure_project
  ensure_volume
  ensure_tcp_proxy

  # Your key gets a shell in the container; the claim link shows the generated password once; the
  # office's panels suggest this script's commands. (The container finds its SSH address in the
  # variables Railway sets for the TCP proxy.)
  rw variable set $(svc) --skip-deploys "RAILWAY_DOCKERFILE_PATH=$DOCKERFILE" \
    "AGENT_OFFICE_ADMIN_KEYS=$(cat "$KEY_FILE.pub")" "AGENT_OFFICE_CLAIM_TOKEN=$(cat "$CLAIM_FILE")" \
    "AGENT_OFFICE_DEPLOY_SCRIPT=deploy/railway.sh$NAME_FLAG" </dev/null >/dev/null || die "couldn't set the service's variables"
  [[ -z "$CLAUDE_TOKEN" ]] || printf '%s' "$CLAUDE_TOKEN" | rw variable set $(svc) --skip-deploys --stdin CLAUDE_CODE_OAUTH_TOKEN >/dev/null
  [[ -z "$ANTHROPIC_KEY" ]] || printf '%s' "$ANTHROPIC_KEY" | rw variable set $(svc) --skip-deploys --stdin ANTHROPIC_API_KEY >/dev/null
  # Railway's default only restarts a crashed office a few times.
  rw environment edit -e "$ENVIRONMENT_ID" --service-config "$SERVICE_ID" deploy.restartPolicyType ALWAYS --json </dev/null >/dev/null 2>&1 ||
    warn "couldn't set the restart policy to ALWAYS"

  deploy
  say "Waiting for the office to answer over SSH"
  wait_healthy || die "the office didn't come up — check: deploy/railway.sh logs$NAME_FLAG"

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

  ok "Your office is running on Railway (reachable only through SSH)"
  echo
  echo "   Open it later:     deploy/railway.sh open$NAME_FLAG"
  echo "   Add a teammate:    the 👥 Invite button in the office, or deploy/railway.sh invite <their-github-username>$NAME_FLAG"
  echo "   Update it:         deploy/railway.sh update$NAME_FLAG"
  echo "   Tear it down:      deploy/railway.sh destroy$NAME_FLAG"
  echo
  [[ $NO_OPEN -eq 1 ]] && return
  open_office
}

cmd_open() {
  preflight
  require_office
  wait_healthy || die "the office isn't answering — check: deploy/railway.sh logs$NAME_FLAG"
  open_office
}

cmd_update() {
  preflight
  require_office
  deploy
  wait_healthy || die "the office didn't come back — check: deploy/railway.sh logs$NAME_FLAG"
  ok "Updated (workers that were running come back where they left off)"
}

cmd_restart() {
  preflight
  require_office
  local was
  was=$(started)
  rw restart $(svc) --yes --json </dev/null >/dev/null || die "couldn't restart the office"
  say "Restarting"
  wait_replaced "$was" || die "the office didn't come back — check: deploy/railway.sh logs$NAME_FLAG"
  ok "Restarted"
}

cmd_service() {
  preflight
  [[ ${#POSITIONAL[@]} -eq 1 && "${POSITIONAL[0]}" =~ ^[0-9]+$ && ${POSITIONAL[0]} -gt 0 && ${POSITIONAL[0]} -lt 65536 ]] ||
    die "usage: deploy/railway.sh service <port>   (a port from the office's 🌐 Services board)"
  [[ "${POSITIONAL[0]}" -ne $OFFICE_PORT ]] || die "$OFFICE_PORT is the office itself — use: deploy/railway.sh open"
  require_office
  service_tunnel "${POSITIONAL[0]}"
}

cmd_status() {
  preflight
  load_ids
  if [[ -z "$PROJECT_ID" ]]; then
    echo "No office named \"$NAME\" on Railway."
    return
  fi
  echo "office:     $NAME (Railway project $PROJECT_ID)"
  echo "deployment: $(deploy_status)"
  echo "ssh:        ${SSH_HOST:-none}:${SSH_PORT}  (open the office with: deploy/railway.sh open$NAME_FLAG)"
  if [[ -n "$SSH_HOST" && -f "$KEY_FILE" ]] && office_get /api/health >/dev/null 2>&1; then
    echo "volume:     $(remote "df -h /data | awk 'NR == 2 {print \$6 \", \" \$3 \" used of \" \$2}'")"
    echo "office:     up"
    local team
    team=$(team_members 2>/dev/null | awk '{printf "%s%s", sep, $1; sep=", "}')
    echo "team:       ${team:-nobody invited yet}"
  else
    echo "volume:     $(rw volume $(svc) list --json | json "j.volumes.filter((v) => v.serviceName === '$SERVICE_NAME').map((v) => v.mountPath + ', ' + Math.round(v.sizeMB / 1000) + ' GB').join('; ') || 'none'")"
    echo "office:     not answering"
  fi
}

cmd_invite() {
  preflight
  [[ ${#POSITIONAL[@]} -ge 1 && ${#POSITIONAL[@]} -le 2 ]] ||
    die "usage: deploy/railway.sh invite <github-username>   or   deploy/railway.sh invite <name> <public-key-file>"
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
  [[ ${#POSITIONAL[@]} -eq 1 ]] || die "usage: deploy/railway.sh uninvite <name>"
  local who="${POSITIONAL[0]}" out rc=0
  valid_member "$who"
  require_office
  out=$(remote "agent-office-team remove $who" 2>&1) || rc=$?
  [[ $rc -eq 66 ]] && die "$who isn't invited (see: deploy/railway.sh team$NAME_FLAG)"
  [[ $rc -eq 0 ]] || die "couldn't remove the keys: $out"
  ok "$who's keys are removed and open tunnels were dropped (other teammates just reconnect)"
  echo "   They still know the office password. To change it: deploy/railway.sh reset-password$NAME_FLAG"
}

cmd_team() {
  preflight
  require_office
  local list
  list=$(team_members)
  if [[ -z "$list" ]]; then
    echo "Nobody is invited yet. Add someone: deploy/railway.sh invite <github-username>$NAME_FLAG"
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

cmd_logs() {
  preflight
  require_office
  rw logs $(svc)
}

cmd_reset_password() {
  preflight
  require_office
  (umask 077 && random_token >"$CLAIM_FILE")
  say "Resetting the office password"
  rw variable set $(svc) --skip-deploys "AGENT_OFFICE_CLAIM_TOKEN=$(cat "$CLAIM_FILE")" >/dev/null || die "couldn't set the new claim token"
  local was
  was=$(started)
  remote "node /opt/agent-office/bin/agent-office.js --reset-password >/dev/null" || die "reset failed"
  # A redeploy, so the office starts with the new claim token (and makes the new password).
  rw redeploy $(svc) --yes --json </dev/null >/dev/null || die "couldn't redeploy the office"
  wait_replaced "$was" || die "the office didn't come back — check: deploy/railway.sh logs$NAME_FLAG"
  ok "Everyone has been signed out"
  open_office
}

cmd_down() {
  preflight
  load_ids
  if [[ -z "$PROJECT_ID" ]]; then
    echo "Nothing to delete for \"$NAME\"."
    rm -rf "$STATE_DIR"
    return
  fi
  # The state directory (this office's SSH key, claim token and IDs) goes only once the project has:
  # project_exists dies when Railway can't say, and a failed delete stops here.
  if project_exists; then
    say "This permanently deletes office \"$NAME\": Railway project $PROJECT_ID, its volume and everything on it."
    echo "   Anything in the office that isn't pushed to GitHub is lost."
    if [[ $YES -ne 1 ]]; then
      read -r -p "   Type the office name ($NAME) to confirm: " answer
      [[ "$answer" == "$NAME" ]] || die "cancelled"
    fi
    railway delete --project "$PROJECT_ID" --yes </dev/null >/dev/null ||
      die "couldn't delete the project (with 2FA on, run: railway delete --project $PROJECT_ID, then this again)"
    ok "Railway project deleted (the service, its volume and the TCP proxy go with it)"
  else
    ok "Railway project $PROJECT_ID is already deleted"
  fi
  rw unlink --yes </dev/null >/dev/null 2>&1 || true # forget the state directory's link in the CLI's config
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
  *) die "unknown command \"$CMD\" (see: deploy/railway.sh help)" ;;
esac
