#!/usr/bin/env bash
# Deploy your own Agent Office to Fly.io with one command, using flyctl.
#
#   deploy/fly.sh up        create the app, build and start the office, open it
#   deploy/fly.sh open      tunnel to the office and open it in your browser
#   deploy/fly.sh destroy   delete the app, its volume and everything on it (asks first)
#
# The office is never on the internet: it listens on 127.0.0.1 in its Fly Machine, and everyone
# reaches it through an SSH tunnel to the machine's sshd, on the app's dedicated IPv4 address. What
# it keeps (accounts, floors, projects, sign-ins, teammates' keys, the SSH host key) is on a Fly
# volume at /data, so restarts and redeploys lose none of it. The image is the one deploy/railway.sh
# runs, deploy/container/Dockerfile, built from this checkout. Run `deploy/fly.sh help` for all
# commands and options.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NAME="agent-office"
APP_ARG=""
ORG_ARG=""
REGION_ARG=""
VM_SIZE_ARG=""
MEMORY_ARG=""
DISK=50
GH_TOKEN_ARG=""
NO_GH_TOKEN=0
CLAUDE_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"
ANTHROPIC_KEY=""
YES=0
NO_OPEN=0
DOCKERFILE="deploy/container/Dockerfile"
SSH_USER="agentoffice" # your key's shell in the machine: the user that runs the office
TEAM_USER="office"     # teammates' keys log in as this user, which can only tunnel to the office
OFFICE_PORT=4600       # where the office listens in the machine (127.0.0.1 only)
SSHD_PORT=2222         # the machine's sshd: Fly's own (`fly ssh console`) has port 22 there
DEFAULT_VM_SIZE="shared-cpu-4x"
DEFAULT_MEMORY_MB=8192
LOCAL_PORT=4600
LOCAL_PORT_SET=0

usage() {
  cat <<'EOF'
Agent Office on Fly.io — one command up, one command down.

Usage: deploy/fly.sh <command> [options]

The office is never on the internet. It listens on 127.0.0.1 in its Fly Machine, and everyone
reaches it through an SSH tunnel on http://localhost:4600, to the machine's sshd on the app's own
IPv4 address. Accounts, floors, projects, sign-ins and teammates' keys live on a volume, so they
survive restarts and redeploys.

Commands
  up                 Create (or reuse) the Fly app, build this checkout and start the office, then
                     open it in your browser. The first page shows the office password ONCE.
  open               Tunnel to your office and open it in the browser (Ctrl-C closes the tunnel)
  update             Build this checkout again and redeploy it (running workers stop, and come back
                     where they left off)
  restart            Restart the office's machine without rebuilding it
  resize <size> [memory]
                     Change the machine, e.g. resize performance-2x or resize shared-cpu-8x 16gb
                     (sizes: fly platform vm-sizes). Memory stays the same unless you give it
  pause              Stop the machine, and with it the bill for its CPU and memory
  resume             Start it again and open it
  destroy            Delete the Fly app: the office, its volume and everything on it (asks you to
                     type the office name first). `down` does the same.

  service <port>     Open a worker's web server from the office's 🌐 Services board on
                     http://localhost:<port> (through the office; Ctrl-C closes the tunnel)
  invite <gh-user>   Let a teammate tunnel in with the SSH keys on their GitHub account, and
                     print the one command to send them. Or: invite <name> <public-key-file>
  uninvite <name>    Remove a teammate's keys and drop open tunnels
  team               List who is invited
  status             Show the app, the machine, the SSH address and whether the office is up
  ssh                A shell in the machine, as the user that runs the office
  logs               Follow the office's logs
  reset-password     Forget the password and show a new one once in your browser

Options
  --name <name>             Office name (default: agent-office). Several offices = several apps
  --app <name>              Fly app name for a new office. App names are unique across all of
                            Fly.io (default: the office name plus a random suffix)
  --org <slug>              Fly organization for a new office (needed if you're in more than one)
  --region <code>           Fly region for a new office (default: the one nearest you; see: fly
                            platform regions). Its volume stays there
  --vm-size <size>          Machine size (default: shared-cpu-4x)
  --memory <size>           Machine memory, like 8gb or 16384 (MB) (default: 8gb)
  --disk <GB>               Volume size for a new office (default: 50)
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
# suggests `deploy/fly.sh --name <name> service <port>`).
CMD=""
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name | --app | --org | --region | --vm-size | --memory | --disk | --port | --github-token | --claude-token | --anthropic-api-key)
      [[ $# -ge 2 ]] || die "$1 needs a value (see: deploy/fly.sh help)" ;;
  esac
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --app) APP_ARG="$2"; shift 2 ;;
    --org) ORG_ARG="$2"; shift 2 ;;
    --region) REGION_ARG="$2"; shift 2 ;;
    --vm-size) VM_SIZE_ARG="$2"; shift 2 ;;
    --memory) MEMORY_ARG="$2"; shift 2 ;;
    --disk) DISK="$2"; shift 2 ;;
    --port) LOCAL_PORT="$2"; LOCAL_PORT_SET=1; shift 2 ;;
    --github-token) GH_TOKEN_ARG="$2"; shift 2 ;;
    --no-github-token) NO_GH_TOKEN=1; shift ;;
    --claude-token) CLAUDE_TOKEN="$2"; shift 2 ;;
    --anthropic-api-key) ANTHROPIC_KEY="$2"; shift 2 ;;
    --no-open) NO_OPEN=1; shift ;;
    -y | --yes) YES=1; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) die "unknown option $1 (see: deploy/fly.sh help)" ;;
    *)
      if [[ -z "$CMD" ]]; then CMD="$1"; else POSITIONAL+=("$1"); fi
      shift
      ;;
  esac
done
CMD="${CMD:-help}"

# 8gb, 16g, 8192mb or 8192 → megabytes
memory_mb() {
  local m
  m=$(tr '[:upper:]' '[:lower:]' <<<"$1")
  m=${m%b}
  case "$m" in
    *g) m=${m%g}; [[ "$m" =~ ^[0-9]+$ ]] && echo $((m * 1024)) ;;
    *m) m=${m%m}; [[ "$m" =~ ^[0-9]+$ ]] && echo "$m" ;;
    *) [[ "$m" =~ ^[0-9]+$ ]] && echo "$m" ;;
  esac
}

[[ "$NAME" =~ ^[a-zA-Z0-9-]+$ ]] || die "--name may only contain letters, numbers and dashes"
[[ -z "$APP_ARG" || "$APP_ARG" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]] || die "--app may only contain lowercase letters, numbers and dashes"
[[ -z "$ORG_ARG" || "$ORG_ARG" =~ ^[a-zA-Z0-9_-]+$ ]] || die "--org takes an organization's slug (see: fly orgs list)"
[[ -z "$REGION_ARG" || "$REGION_ARG" =~ ^[a-z]{3}$ ]] || die "--region takes a three-letter region code (see: fly platform regions)"
[[ -z "$VM_SIZE_ARG" || "$VM_SIZE_ARG" =~ ^[a-z0-9-]+$ ]] || die "--vm-size takes a size like shared-cpu-4x (see: fly platform vm-sizes)"
[[ -z "$MEMORY_ARG" || $(memory_mb "$MEMORY_ARG") -ge 256 ]] 2>/dev/null || die "--memory takes a size like 8gb or 16384 (MB)"
[[ "$DISK" =~ ^[0-9]+$ && $DISK -ge 1 && $DISK -le 500 ]] || die "--disk must be a size in GB, 1 to 500"
[[ "$LOCAL_PORT" =~ ^[0-9]+$ && $LOCAL_PORT -gt 0 && $LOCAL_PORT -lt 65536 ]] || die "--port must be a port number"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/agent-office/fly/$NAME"
NAME_FLAG=""
[[ "$NAME" != "agent-office" ]] && NAME_FLAG=" --name $NAME"
KEY_FILE="$STATE_DIR/id_ed25519"
KNOWN_HOSTS="$STATE_DIR/known_hosts"
CLAIM_FILE="$STATE_DIR/claim-token"
TOML="$STATE_DIR/fly.toml"          # written from the settings below before each deploy
IDS_FILE="$STATE_DIR/fly.env"        # APP ORG REGION VM_SIZE VM_MEMORY SSH_HOST SSH_PORT
APP="" ORG="" REGION="" VM_SIZE="" VM_MEMORY="" SSH_HOST="" SSH_PORT=""
FLYCTL=""

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required (${2:-install it first})"; }

# Evaluates a JavaScript expression over the JSON on stdin (as j) and prints the result: json 'j.id'
json() {
  node -e 'let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const v = new Function("j", `return (${process.argv[1]})`)(JSON.parse(s));
      if (v !== undefined && v !== null) console.log(typeof v === "object" ? JSON.stringify(v) : String(v));
    });' "$1"
}

# flyctl, run in the state directory: it reads the fly.toml there, never one in your current directory.
fl() {
  (
    cd "$STATE_DIR" 2>/dev/null || cd /
    "$FLYCTL" "$@"
  )
}

preflight() {
  # Homebrew and Fly's installer put both names on PATH; Concourse CI's CLI is also called `fly`.
  FLYCTL=$(command -v flyctl || command -v fly) || die "flyctl is required (https://fly.io/docs/flyctl/install/)"
  export FLY_NO_UPDATE_CHECK=1
  need ssh
  need curl
  need node "https://nodejs.org"
  "$FLYCTL" auth whoami >/dev/null 2>&1 </dev/null || die "flyctl isn't logged in (run: fly auth login)"
}

load_ids() {
  # shellcheck disable=SC1090
  [[ -f "$IDS_FILE" ]] && source "$IDS_FILE"
  return 0
}

save_ids() {
  printf 'APP=%q ORG=%q REGION=%q VM_SIZE=%q VM_MEMORY=%q SSH_HOST=%q SSH_PORT=%q\n' \
    "$APP" "$ORG" "$REGION" "$VM_SIZE" "$VM_MEMORY" "$SSH_HOST" "$SSH_PORT" >"$IDS_FILE"
}

require_office() {
  load_ids
  [[ -n "$APP" && -n "$SSH_HOST" ]] || die "no office named \"$NAME\" on Fly.io — run: deploy/fly.sh up$NAME_FLAG"
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

# --- Fly.io ----------------------------------------------------------------------------------------

# Whether $APP is still on Fly.io. Only a listing that worked can say it's gone: when Fly can't be
# asked (network, expired login), this dies, so nothing gets made again or forgotten over an app
# that's still running.
app_exists() {
  local list found
  list=$(fl apps list --json </dev/null) ||
    die "couldn't list your Fly.io apps, so can't tell whether \"$NAME\" ($APP) is still there — check: fly auth whoami"
  found=$(json "Array.isArray(j) ? j.some((a) => (a.Name ?? a.name) === '$APP') : j === null ? false : 'unreadable'" <<<"$list" 2>/dev/null) || found=""
  [[ "$found" == true || "$found" == false ]] ||
    die "couldn't read Fly.io's list of apps (fly apps list --json), so can't tell whether \"$NAME\" ($APP) is still there"
  [[ "$found" == true ]]
}

# The Fly region nearest this computer: the one Fly's edge answers from.
nearest_region() {
  curl -fsSI --max-time 5 https://debug.fly.dev 2>/dev/null | tr -d '\r' | tr '[:upper:]' '[:lower:]' |
    sed -n 's/^fly-region: *\([a-z]\{3\}\)$/\1/p' | head -n 1
}

# Decides the app, organization, region and machine size, remembered in $IDS_FILE; makes nothing.
# A new office gets a new app name, a region and the default size; an existing one keeps its own,
# except for the size and memory you pass.
resolve_settings() {
  load_ids
  if [[ -n "$APP" ]] && ! app_exists; then
    if [[ -n "$SSH_HOST" ]]; then
      warn "the Fly app for \"$NAME\" ($APP) is gone; making a new one"
      rm -f "$KNOWN_HOSTS" # a new machine, with a new host key
    fi
    SSH_HOST="" SSH_PORT=""
    [[ -z "$APP_ARG" ]] || APP="" # named below
    [[ -z "$ORG_ARG" ]] || ORG="$ORG_ARG"
    [[ -z "$REGION_ARG" ]] || REGION="$REGION_ARG"
  elif [[ -n "$APP" ]]; then
    [[ -z "$APP_ARG" || "$APP_ARG" == "$APP" ]] || die "office \"$NAME\" is already the Fly app $APP (--app only names a new one)"
    [[ -z "$REGION_ARG" || "$REGION_ARG" == "$REGION" ]] || warn "office \"$NAME\" stays in $REGION: its volume is there"
  fi
  if [[ -z "$APP" ]]; then
    APP="${APP_ARG:-$(tr '[:upper:]' '[:lower:]' <<<"$NAME")-$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')}"
    # Never an app that's already there: the office would take it over, and `destroy` delete it.
    ! app_exists || die "you already have a Fly app called $APP — give this office a new one with --app <name>"
  fi
  if [[ -z "$ORG" ]]; then
    ORG="$ORG_ARG"
    if [[ -z "$ORG" ]]; then
      local orgs
      orgs=$(fl orgs list --json </dev/null | json 'Object.keys(j).join("\n")') || orgs=""
      [[ -n "$orgs" ]] || die "couldn't list your Fly.io organizations (fly orgs list)"
      [[ $(wc -l <<<"$orgs") -eq 1 ]] || die "you're in several Fly.io organizations; pick one with --org:
$(sed 's/^/   /' <<<"$orgs")"
      ORG="$orgs"
    fi
  fi
  if [[ -z "$REGION" ]]; then
    REGION="${REGION_ARG:-$(nearest_region)}"
    REGION="${REGION:-iad}"
  fi
  [[ -z "$VM_SIZE_ARG" ]] || VM_SIZE="$VM_SIZE_ARG"
  [[ -z "$MEMORY_ARG" ]] || VM_MEMORY=$(memory_mb "$MEMORY_ARG")
  VM_SIZE="${VM_SIZE:-$DEFAULT_VM_SIZE}"
  VM_MEMORY="${VM_MEMORY:-$DEFAULT_MEMORY_MB}"
  # The public SSH port: a random one, like Railway's TCP proxy, so the scanners that knock on
  # port 22 of every address all day don't fill the office's logs.
  SSH_PORT="${SSH_PORT:-$((20000 + RANDOM % 40000))}"
  save_ids
}

# The app itself. Its name is saved before it's made (resolve_settings checked it's a new one), so a
# failure here never makes the next `up` create a second app (or `destroy` miss the first).
ensure_app() {
  app_exists && return
  fl apps create "$APP" --org "$ORG" </dev/null >/dev/null 2>"$STATE_DIR/fly.log" ||
    die "couldn't create the Fly app $APP: $(tail -n 3 "$STATE_DIR/fly.log") (app names are unique across Fly.io: pick another with --app <name>)"
  ok "Fly app $APP ($ORG)"
}

# Everything the office keeps goes on this volume (see deploy/container/start.sh).
ensure_volume() {
  local list have
  list=$(fl volumes list -a "$APP" --json </dev/null) || die "couldn't list the app's volumes"
  have=$(json "(j || []).filter((v) => v.name === 'data' && !/destroy/.test(v.state)).length" <<<"$list")
  if [[ "${have:-0}" -eq 0 ]]; then
    fl volumes create data -a "$APP" --region "$REGION" --size "$DISK" --yes </dev/null >/dev/null 2>"$STATE_DIR/fly.log" ||
      die "couldn't create the volume in $REGION: $(tail -n 3 "$STATE_DIR/fly.log") (another region: --region <code>, see: fly platform regions)"
    ok "Volume on /data ($DISK GB in $REGION)"
  fi
}

# The app's dedicated IPv4 address, or nothing; dies when Fly can't say.
dedicated_ipv4() {
  local list
  list=$(fl ips list -a "$APP" --json </dev/null) || die "couldn't list the app's IP addresses"
  json "((j || []).find((i) => (i.Type ?? i.type) === 'v4') || {}).Address" <<<"$list"
}

# SSH is the only way in, on an address of the app's own: Fly's shared IPv4 addresses carry only
# HTTP and TLS.
ensure_ip() {
  SSH_HOST=$(dedicated_ipv4)
  if [[ -z "$SSH_HOST" ]]; then
    fl ips allocate-v4 -a "$APP" --yes </dev/null >/dev/null 2>"$STATE_DIR/fly.log" ||
      die "couldn't get the app an IPv4 address: $(tail -n 3 "$STATE_DIR/fly.log")"
    SSH_HOST=$(dedicated_ipv4)
    [[ -n "$SSH_HOST" ]] || die "the app has no IPv4 address yet (run this again to retry)"
  fi
  save_ids
  ok "SSH at $SSH_HOST:$SSH_PORT"
}

# The app's configuration, from the settings in $IDS_FILE. Your key gets a shell in the machine, and
# the office's panels suggest this script's commands.
write_toml() {
  cat >"$TOML" <<EOF
# Written by deploy/fly.sh for office "$NAME". It writes this file again before every deploy: change
# the machine with \`deploy/fly.sh resize\`, and settings with \`fly secrets set\`.
app = "$APP"
primary_region = "$REGION"
kill_signal = "SIGTERM"
kill_timeout = 30

[env]
  AGENT_OFFICE_ADMIN_KEYS = "$(cat "$KEY_FILE.pub")"
  AGENT_OFFICE_DEPLOY_SCRIPT = "deploy/fly.sh$NAME_FLAG"
  AGENT_OFFICE_PUBLIC_HOST = "$SSH_HOST:$SSH_PORT"
  AGENT_OFFICE_SSHD_PORT = "$SSHD_PORT"
  # Fly's init is PID 1, so tini reaps what workers leave behind as a subreaper instead.
  TINI_SUBREAPER = "1"

[[mounts]]
  source = "data"
  destination = "/data"

# SSH and nothing else: the app's IPv4 address on port $SSH_PORT, to the machine's sshd. The machine
# always runs; only \`deploy/fly.sh pause\` stops it, and nothing but \`resume\` starts it again.
[[services]]
  protocol = "tcp"
  internal_port = $SSHD_PORT
  auto_stop_machines = "off"
  auto_start_machines = false

  [[services.ports]]
    port = $SSH_PORT

[[restart]]
  policy = "always"

[[vm]]
  size = "$VM_SIZE"
  memory = "${VM_MEMORY}mb"
EOF
}

# The office's machine, as "<id> <state>" (started, stopped, …), or nothing before the first deploy.
machine() {
  local list
  list=$(fl machine list -a "$APP" --json </dev/null) || die "couldn't list the app's machines"
  json "(j || []).filter((m) => !/destroy/.test(m.state)).map((m) => m.id + ' ' + m.state)[0]" <<<"$list"
}

machine_id() {
  local m
  m=$(machine)
  [[ -n "$m" ]] || die "office \"$NAME\" has no machine — run: deploy/fly.sh update$NAME_FLAG"
  echo "${m%% *}"
}

require_running() {
  local m
  m=$(machine)
  [[ "${m#* }" != stopped && "${m#* }" != suspended ]] || die "office \"$NAME\" is paused — start it with: deploy/fly.sh resume$NAME_FLAG"
}

# Builds this checkout with deploy/container/Dockerfile on Fly's builders and deploys it.
deploy() {
  local log="$STATE_DIR/deploy.log" what
  what=$(git -C "$REPO_DIR" log -1 --format='%h %s' 2>/dev/null || echo 'not a git checkout')
  [[ -z "$(git -C "$REPO_DIR" status --porcelain 2>/dev/null)" ]] || what+=", with your uncommitted changes"
  say "Building and deploying this checkout ($what) — a few minutes"
  write_toml
  # One machine (--ha=false): the volume can only be on one. The IP address is ensure_ip's.
  if ! fl deploy "$REPO_DIR" --config "$TOML" --dockerfile "$REPO_DIR/$DOCKERFILE" \
    --ignorefile "$REPO_DIR/$DOCKERFILE.dockerignore" --remote-only --ha=false --no-public-ips \
    --wait-timeout 10m --yes </dev/null >"$log" 2>&1; then
    tail -n 40 "$log" >&2
    die "the deploy failed (the whole log: $log)"
  fi
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
    [[ $rc -eq 255 ]] || return "$rc" # 255: ssh itself failed, the machine is still starting
    sleep 5
  done
  return 1
}

# When the machine's first process started: it changes when the machine restarts.
started() { remote 'stat -c %Y /proc/1' 2>/dev/null || true; }

# After a restart or redeploy: waits for the restarted machine, then for the office on it.
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

# Forward localhost:<port> to the office in the machine, open the browser, and hold until Ctrl-C.
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
    die "the tunnel opened but the office didn't answer through it — check: deploy/fly.sh logs$NAME_FLAG"
  fi
  ok "Your office: http://localhost:$port$path"
  echo "   (tunneled over SSH to $SSH_HOST:$SSH_PORT — keep this running while you use it; Ctrl-C closes it)"
  open_url "http://localhost:$port$path"
  wait "$pid" || true
  trap - INT TERM
  warn "The tunnel dropped — reopen it with: deploy/fly.sh open$NAME_FLAG"
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
  warn "The tunnel dropped — reopen it with: deploy/fly.sh service $port$NAME_FLAG"
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

  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  resolve_settings

  say "Agent Office \"$NAME\" on Fly.io ($("$FLYCTL" auth whoami 2>/dev/null </dev/null | tail -n 1))"
  echo "   app:      this checkout, built with $DOCKERFILE, as the Fly app $APP ($ORG, $REGION)"
  echo "   machine:  $VM_SIZE with $((VM_MEMORY / 1024)) GB (change it with: deploy/fly.sh resize <size>)"
  echo "   data:     a volume on /data: accounts, floors, projects (~/workspace), sign-ins, team keys"
  echo "   access:   SSH tunnel only (the office is never exposed), on a dedicated IPv4 address"
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

  ensure_app
  ensure_volume
  ensure_ip

  # Secrets, read from stdin so no token is in a command line. The claim link shows the generated
  # password once; the deploy puts them all in the machine.
  {
    printf 'AGENT_OFFICE_CLAIM_TOKEN=%s\n' "$(cat "$CLAIM_FILE")"
    [[ -z "$CLAUDE_TOKEN" ]] || printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$CLAUDE_TOKEN"
    [[ -z "$ANTHROPIC_KEY" ]] || printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_KEY"
  } | fl secrets import --stage -a "$APP" >/dev/null || die "couldn't set the app's secrets"

  deploy
  say "Waiting for the office to answer over SSH"
  wait_healthy || die "the office didn't come up — check: deploy/fly.sh logs$NAME_FLAG"

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

  ok "Your office is running on Fly.io (reachable only through SSH)"
  echo
  echo "   Open it later:     deploy/fly.sh open$NAME_FLAG"
  echo "   Add a teammate:    the 👥 Invite button in the office, or deploy/fly.sh invite <their-github-username>$NAME_FLAG"
  echo "   Update it:         deploy/fly.sh update$NAME_FLAG"
  echo "   Stop paying:       deploy/fly.sh pause$NAME_FLAG (or destroy$NAME_FLAG)"
  echo
  [[ $NO_OPEN -eq 1 ]] && return
  open_office
}

cmd_open() {
  preflight
  require_office
  require_running
  wait_healthy || die "the office isn't answering — check: deploy/fly.sh logs$NAME_FLAG"
  open_office
}

cmd_update() {
  preflight
  require_office
  require_running
  deploy
  wait_healthy || die "the office didn't come back — check: deploy/fly.sh logs$NAME_FLAG"
  ok "Updated (workers that were running come back where they left off)"
}

cmd_restart() {
  preflight
  require_office
  require_running
  local was id
  id=$(machine_id)
  was=$(started)
  say "Restarting"
  fl machine restart "$id" -a "$APP" </dev/null >/dev/null || die "couldn't restart the office"
  wait_replaced "$was" || die "the office didn't come back — check: deploy/fly.sh logs$NAME_FLAG"
  ok "Restarted"
}

cmd_resize() {
  preflight
  [[ ${#POSITIONAL[@]} -ge 1 && ${#POSITIONAL[@]} -le 2 && "${POSITIONAL[0]}" =~ ^[a-z0-9-]+$ ]] ||
    die "usage: deploy/fly.sh resize <size> [memory]   (e.g. resize performance-2x, resize shared-cpu-8x 16gb; sizes: fly platform vm-sizes)"
  local mem was
  require_office
  require_running
  mem="$VM_MEMORY"
  if [[ ${#POSITIONAL[@]} -eq 2 ]]; then
    mem=$(memory_mb "${POSITIONAL[1]}")
    [[ -n "$mem" && $mem -ge 256 ]] || die "memory is a size like 8gb or 16384 (MB)"
  fi
  was=$(started)
  say "Resizing to ${POSITIONAL[0]} with $((mem / 1024)) GB (the office restarts)"
  fl scale vm "${POSITIONAL[0]}" --vm-memory "$mem" -a "$APP" </dev/null >"$STATE_DIR/fly.log" 2>&1 ||
    die "couldn't resize: $(tail -n 3 "$STATE_DIR/fly.log")"
  VM_SIZE="${POSITIONAL[0]}" VM_MEMORY="$mem"
  save_ids # and so in fly.toml at the next deploy
  wait_replaced "$was" || die "the office didn't come back — check: deploy/fly.sh logs$NAME_FLAG"
  ok "Now $VM_SIZE with $((VM_MEMORY / 1024)) GB"
}

cmd_pause() {
  preflight
  require_office
  local m
  m=$(machine)
  [[ -n "$m" ]] || die "office \"$NAME\" has no machine"
  if [[ "${m#* }" == stopped ]]; then
    ok "Office \"$NAME\" is already paused"
    return
  fi
  fl machine stop "${m%% *}" -a "$APP" </dev/null >/dev/null || die "couldn't stop the machine"
  ok "Paused: Fly stops billing its CPU and memory (the volume and the IP address still are). Start it again with: deploy/fly.sh resume$NAME_FLAG"
}

cmd_resume() {
  preflight
  require_office
  local m
  m=$(machine)
  [[ -n "$m" ]] || die "office \"$NAME\" has no machine — run: deploy/fly.sh update$NAME_FLAG"
  if [[ "${m#* }" != started ]]; then
    say "Starting the machine"
    fl machine start "${m%% *}" -a "$APP" </dev/null >/dev/null || die "couldn't start the machine"
  fi
  wait_healthy || die "the office didn't come up — check: deploy/fly.sh logs$NAME_FLAG"
  ok "Running"
  [[ $NO_OPEN -eq 1 ]] && return
  open_office
}

cmd_service() {
  preflight
  [[ ${#POSITIONAL[@]} -eq 1 && "${POSITIONAL[0]}" =~ ^[0-9]+$ && ${POSITIONAL[0]} -gt 0 && ${POSITIONAL[0]} -lt 65536 ]] ||
    die "usage: deploy/fly.sh service <port>   (a port from the office's 🌐 Services board)"
  [[ "${POSITIONAL[0]}" -ne $OFFICE_PORT ]] || die "$OFFICE_PORT is the office itself — use: deploy/fly.sh open"
  require_office
  service_tunnel "${POSITIONAL[0]}"
}

cmd_status() {
  preflight
  load_ids
  if [[ -z "$APP" ]]; then
    echo "No office named \"$NAME\" on Fly.io."
    return
  fi
  local m
  m=$(machine)
  echo "office:     $NAME (Fly app $APP, $ORG, $REGION)"
  echo "machine:    ${m:-none} — $VM_SIZE with $((VM_MEMORY / 1024)) GB"
  echo "ssh:        ${SSH_HOST:-none}:${SSH_PORT}  (open the office with: deploy/fly.sh open$NAME_FLAG)"
  if [[ -n "$SSH_HOST" && -f "$KEY_FILE" && "${m#* }" == started ]] && office_get /api/health >/dev/null 2>&1; then
    echo "volume:     $(remote "df -h /data | awk 'NR == 2 {print \$6 \", \" \$3 \" used of \" \$2}'")"
    echo "office:     up"
    local team
    team=$(team_members 2>/dev/null | awk '{printf "%s%s", sep, $1; sep=", "}')
    echo "team:       ${team:-nobody invited yet}"
  else
    echo "volume:     $(fl volumes list -a "$APP" --json </dev/null | json "(j || []).filter((v) => !/destroy/.test(v.state)).map((v) => '/data, ' + v.size_gb + ' GB').join('; ') || 'none'")"
    if [[ "${m#* }" == stopped ]]; then echo "office:     paused (deploy/fly.sh resume$NAME_FLAG)"; else echo "office:     not answering"; fi
  fi
}

cmd_invite() {
  preflight
  [[ ${#POSITIONAL[@]} -ge 1 && ${#POSITIONAL[@]} -le 2 ]] ||
    die "usage: deploy/fly.sh invite <github-username>   or   deploy/fly.sh invite <name> <public-key-file>"
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
  # The machine keeps only valid keys and restricts each one to opening the tunnel.
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
  [[ ${#POSITIONAL[@]} -eq 1 ]] || die "usage: deploy/fly.sh uninvite <name>"
  local who="${POSITIONAL[0]}" out rc=0
  valid_member "$who"
  require_office
  out=$(remote "agent-office-team remove $who" 2>&1) || rc=$?
  [[ $rc -eq 66 ]] && die "$who isn't invited (see: deploy/fly.sh team$NAME_FLAG)"
  [[ $rc -eq 0 ]] || die "couldn't remove the keys: $out"
  ok "$who's keys are removed and open tunnels were dropped (other teammates just reconnect)"
  echo "   They still know the office password. To change it: deploy/fly.sh reset-password$NAME_FLAG"
}

cmd_team() {
  preflight
  require_office
  local list
  list=$(team_members)
  if [[ -z "$list" ]]; then
    echo "Nobody is invited yet. Add someone: deploy/fly.sh invite <github-username>$NAME_FLAG"
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
  fl logs -a "$APP"
}

cmd_reset_password() {
  preflight
  require_office
  require_running
  (umask 077 && random_token >"$CLAIM_FILE")
  say "Resetting the office password"
  local was
  was=$(started)
  remote "node /opt/agent-office/bin/agent-office.js --reset-password >/dev/null" || die "reset failed"
  # Setting the secret restarts the machine, so the office starts with the new claim token (and
  # makes the new password).
  printf 'AGENT_OFFICE_CLAIM_TOKEN=%s\n' "$(cat "$CLAIM_FILE")" | fl secrets import -a "$APP" >/dev/null ||
    die "couldn't set the new claim token"
  wait_replaced "$was" || die "the office didn't come back — check: deploy/fly.sh logs$NAME_FLAG"
  ok "Everyone has been signed out"
  open_office
}

cmd_down() {
  preflight
  load_ids
  if [[ -z "$APP" ]]; then
    echo "Nothing to delete for \"$NAME\"."
    rm -rf "$STATE_DIR"
    return
  fi
  # The state directory (this office's SSH key, claim token and settings) goes only once the app
  # has: app_exists dies when Fly can't say, and a failed delete stops here.
  if app_exists; then
    say "This permanently deletes office \"$NAME\": Fly app $APP, its volume and everything on it."
    echo "   Anything in the office that isn't pushed to GitHub is lost."
    if [[ $YES -ne 1 ]]; then
      read -r -p "   Type the office name ($NAME) to confirm: " answer
      [[ "$answer" == "$NAME" ]] || die "cancelled"
    fi
    fl apps destroy "$APP" --yes </dev/null >/dev/null || die "couldn't delete the app (try: fly apps destroy $APP)"
    ok "Fly app deleted (its machine, volume and IP address go with it)"
  else
    ok "Fly app $APP is gone already"
  fi
  rm -rf "$STATE_DIR"
  ok "All gone"
}

case "$CMD" in
  up) cmd_up ;;
  open) cmd_open ;;
  update) cmd_update ;;
  restart) cmd_restart ;;
  resize) cmd_resize ;;
  pause) cmd_pause ;;
  resume) cmd_resume ;;
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
  *) die "unknown command \"$CMD\" (see: deploy/fly.sh help)" ;;
esac
