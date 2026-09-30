#!/usr/bin/env bash
# Deploy your own Agent Office to AWS with one command, using only the AWS CLI.
#
#   deploy/aws.sh up        create the machine, install and start the office, open it
#   deploy/aws.sh open      tunnel to the office and open it in your browser
#   deploy/aws.sh pause     stop the machine to save money (asks first)
#   deploy/aws.sh resume    start it again
#   deploy/aws.sh destroy   delete everything it created (asks first)
#
# The office is never exposed to the internet: it listens on the box's loopback and everyone
# reaches it through an SSH tunnel, or with `up --tailscale`, on your Tailscale network at
# https://agent-office.<your-tailnet>.ts.net. Run `deploy/aws.sh help` for all commands and options.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="agent-office"
INSTANCE_TYPE="t3.xlarge"
INSTANCE_TYPE_SET=0
DISK_GB=50
APP_REF="main"
APP_REPO=""
PROJECT=""
GH_TOKEN_ARG=""
NO_GH_TOKEN=0
CLAUDE_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"
ANTHROPIC_KEY=""
YES=0
NO_OPEN=0
EXTRA_ALLOW=()
SSH_USER="ubuntu"
TEAM_USER="office"   # teammates' keys log in as this user, which can only tunnel to the office
OFFICE_PORT=4600     # where the office listens on the box (127.0.0.1 only)
LOCAL_PORT=4600
LOCAL_PORT_SET=0
TAILSCALE=0
TS_KEY="${TS_AUTHKEY:-}"
TAILSCALE_ADMIN="https://login.tailscale.com/admin"

usage() {
  cat <<'EOF'
Agent Office on AWS — one command up, one command down.

Usage: deploy/aws.sh <command> [options]

The office is never on the internet. It listens on the machine's loopback, the firewall only
opens SSH, and everyone reaches the office through an SSH tunnel on http://localhost:4600 — or,
with `up --tailscale`, on your Tailscale network at https://agent-office.<your-tailnet>.ts.net,
with nothing to run.

Commands
  up                 Create (or reuse) your office on EC2, install and start it, and open it in
                     your browser. The first page shows the office password ONCE — write it down.
  open               Open your office in the browser: on your tailnet if it's on one and this
                     computer is too, else through an SSH tunnel (Ctrl-C closes the tunnel)
  pause              Stop the machine to save money (asks first). The disk, the address and
                     everything on it stay; only the disk and the address are billed while paused
  resume             Start a paused office again and open it in the browser
  destroy            Terminate the machine and delete everything this script created (asks you
                     to type the office name first). `down` does the same.

  service <port>     Open a worker's web server from the office's 🌐 Services board on
                     http://localhost:<port> (through the office; Ctrl-C closes the tunnel)
  invite <gh-user>   Let a teammate tunnel in with the SSH keys on their GitHub account, and
                     print the one command to send them. Or: invite <name> <public-key-file>.
                     On a Tailscale office, plain `invite` says how to share it there instead
  uninvite <name>    Remove a teammate's keys and drop open tunnels
  team               List who is invited
  status             Show the instance, whether the office is up and which IPs may SSH in
  allow <ip|me>      Let an IP (or CIDR) reach SSH. "me" = your current IP. "anywhere" opens SSH
                     to every IP — reasonable, since it only accepts your key and invited keys
  revoke <ip|me>     Take that access away again
  ssh                SSH into the machine
  logs               Follow the office's logs
  resize <type>      Change the machine size, e.g. t3.2xlarge (stops it for ~1-2 minutes;
                     the address stays the same). `up --instance-type <type>` does this too.
  update             Install the latest agent-office on the machine and restart it
  reset-password     Forget the password and show a new one once in your browser

Options
  --name <name>             Deployment name, lets you run several offices (default: agent-office)
  --region <region>         AWS region (default: your AWS CLI region, else us-east-1)
  --profile <profile>       AWS CLI profile
  --instance-type <type>    EC2 instance type (default: t3.xlarge — 4 vCPU, 16 GiB)
  --disk <GiB>              Root disk size (default: 50)
  --allow <ip|cidr>         With up or invite: also allow this IP to SSH in (repeatable).
                            Your own IP is always allowed.
  --port <n>                Local port for the tunnel (default: 4600, or the next free one)
  --project <owner/repo>    Also clone this GitHub repo as the office's first floor. Without it
                            the office opens on its elevator, which lists every repo your GitHub
                            token can see: pick one there. Projects go in ~/workspace on the box
  --app-repo <url>          agent-office repo to install (default: this checkout's GitHub origin)
  --app-ref <ref>           Branch or tag to install (default: main)
  --github-token <token>    GitHub token for private repos + the issue/PR boards
                            (default: your local `gh auth token`)
  --no-github-token         Don't put any GitHub token on the machine
  --claude-token <token>    Claude subscription token from `claude setup-token`
                            (default: $CLAUDE_CODE_OAUTH_TOKEN). Without one, log in from the
                            first worker's terminal in the office.
  --anthropic-api-key <key> Use an Anthropic API key instead
  --tailscale               With up: also put the office on your Tailscale network, at
                            https://<name>.<your-tailnet>.ts.net. Everyone on the tailnet opens it
                            there: no tunnel, no SSH keys, no IPs to allow. Needs MagicDNS and HTTPS
                            Certificates on in Tailscale (it opens the page to turn them on)
  --tailscale-auth-key <key>
                            Add the machine with this Tailscale auth key (default: $TS_AUTHKEY).
                            Without one, up opens Tailscale's page to add it. Implies --tailscale
  --no-open                 Don't open the browser (up, resume: don't open the tunnel either)
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

CMD="${1:-help}"
[[ $# -gt 0 ]] && shift
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --region) export AWS_REGION="$2" AWS_DEFAULT_REGION="$2"; shift 2 ;;
    --profile) export AWS_PROFILE="$2"; shift 2 ;;
    --instance-type) INSTANCE_TYPE="$2"; INSTANCE_TYPE_SET=1; shift 2 ;;
    --disk) DISK_GB="$2"; shift 2 ;;
    --allow) EXTRA_ALLOW+=("$2"); shift 2 ;;
    --port) LOCAL_PORT="$2"; LOCAL_PORT_SET=1; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --app-repo) APP_REPO="$2"; shift 2 ;;
    --app-ref) APP_REF="$2"; shift 2 ;;
    --github-token) GH_TOKEN_ARG="$2"; shift 2 ;;
    --no-github-token) NO_GH_TOKEN=1; shift ;;
    --claude-token) CLAUDE_TOKEN="$2"; shift 2 ;;
    --anthropic-api-key) ANTHROPIC_KEY="$2"; shift 2 ;;
    --tailscale) TAILSCALE=1; shift ;;
    --tailscale-auth-key) TS_KEY="$2"; TAILSCALE=1; shift 2 ;;
    --no-open) NO_OPEN=1; shift ;;
    -y | --yes) YES=1; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) die "unknown option $1 (see: deploy/aws.sh help)" ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

[[ "$NAME" =~ ^[a-zA-Z0-9-]+$ ]] || die "--name may only contain letters, numbers and dashes"
[[ "$LOCAL_PORT" =~ ^[0-9]+$ && $LOCAL_PORT -gt 0 && $LOCAL_PORT -lt 65536 ]] || die "--port must be a port number"
RESOURCE="agent-office-$NAME"
[[ "$NAME" == "agent-office" ]] && RESOURCE="agent-office"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/agent-office/aws/$NAME"
NAME_FLAG=""
[[ "$NAME" != "agent-office" ]] && NAME_FLAG=" --name $NAME"
KEY_FILE="$STATE_DIR/id_ed25519"
KNOWN_HOSTS="$STATE_DIR/known_hosts"
CLAIM_FILE="$STATE_DIR/claim-token"

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required (${2:-install it first})"; }
# Its machine name on the tailnet: agent-office, or agent-office-<name>.
ts_name() { printf '%s' "$RESOURCE" | tr '[:upper:]' '[:lower:]' | cut -c1-63; }
aws_() { aws --output text "$@"; }

preflight() {
  need aws "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  need ssh
  need curl
  if [[ -z "${AWS_REGION:-}" ]]; then
    local r
    r=$(aws configure get region 2>/dev/null || true)
    export AWS_REGION="${r:-us-east-1}" AWS_DEFAULT_REGION="${r:-us-east-1}"
  fi
  ACCOUNT=$(aws_ sts get-caller-identity --query Account 2>/dev/null) || die "the AWS CLI isn't logged in (try: aws configure / aws sso login)"
}

my_ip() { curl -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]'; }

to_cidr() {
  local v="$1"
  [[ "$v" == "me" ]] && v=$(my_ip)
  [[ "$v" == "anywhere" ]] && v="0.0.0.0/0"
  [[ "$v" == */* ]] || v="$v/32"
  [[ "$v" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]] || die "not an IPv4 address or CIDR: $1"
  echo "$v"
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

# --- AWS lookups --------------------------------------------------------------------------------

find_instance() {
  aws_ ec2 describe-instances \
    --filters "Name=tag:agent-office,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[0].InstanceId | [0]' | sed 's/^None$//'
}

instance_field() { aws_ ec2 describe-instances --instance-ids "$1" --query "Reservations[0].Instances[0].$2" | sed 's/^None$//'; }

find_sg() {
  aws_ ec2 describe-security-groups --filters "Name=group-name,Values=$RESOURCE" "Name=tag:agent-office,Values=$NAME" \
    --query 'SecurityGroups[0].GroupId' 2>/dev/null | sed 's/^None$//'
}

find_eip() {
  # prints: <allocation-id> <association-id|None> <public-ip>
  aws_ ec2 describe-addresses --filters "Name=tag:agent-office,Values=$NAME" \
    --query 'Addresses[0].[AllocationId,AssociationId,PublicIp]' 2>/dev/null | sed 's/^None$//'
}

# A fixed address, so the office URL survives stops, starts and resizes.
ensure_eip() {
  local inst="$1" alloc assoc ip current
  read -r alloc assoc ip <<<"$(find_eip)"
  if [[ -z "$alloc" || "$alloc" == "None" ]]; then
    read -r alloc ip <<<"$(aws_ ec2 allocate-address --domain vpc \
      --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=agent-office,Value=$NAME},{Key=Name,Value=$RESOURCE}]" \
      --query '[AllocationId,PublicIp]')"
    ok "Elastic IP $ip"
  fi
  current=$(aws_ ec2 describe-addresses --allocation-ids "$alloc" --query 'Addresses[0].InstanceId' | sed 's/^None$//')
  if [[ "$current" != "$inst" ]]; then
    aws ec2 associate-address --allocation-id "$alloc" --instance-id "$inst" --allow-reassociation >/dev/null
  fi
  IP="$ip"
}

type_arch() {
  aws_ ec2 describe-instance-types --instance-types "$1" --query 'InstanceTypes[0].ProcessorInfo.SupportedArchitectures[0]' 2>/dev/null |
    sed 's/^None$//'
}

# Stop -> change type -> start. The disk, the address and everything on the machine stay.
resize_instance() {
  local inst="$1" want="$2" have want_arch have_arch
  have=$(instance_field "$inst" InstanceType)
  [[ "$have" == "$want" ]] && { ok "Already a $want"; return; }
  want_arch=$(type_arch "$want" || true)
  [[ -n "$want_arch" ]] || die "unknown instance type $want"
  have_arch=$(type_arch "$have" || true)
  [[ "$want_arch" == "$have_arch" ]] || die "can't switch CPU architecture ($have is $have_arch, $want is $want_arch) — use destroy + up instead"
  say "Resizing $inst from $have to $want. The office goes offline for a minute or two;"
  echo "   running workers stop and come back asleep (press R at their desk to resume)."
  if [[ $YES -ne 1 ]]; then
    read -r -p "   Continue? [y/N] " answer
    [[ "$answer" =~ ^[Yy] ]] || die "cancelled"
  fi
  if [[ "$(instance_field "$inst" State.Name)" != "stopped" ]]; then
    aws ec2 stop-instances --instance-ids "$inst" >/dev/null
    say "Stopping"
    aws ec2 wait instance-stopped --instance-ids "$inst"
  fi
  aws ec2 modify-instance-attribute --instance-id "$inst" --instance-type "Value=$want"
  aws ec2 start-instances --instance-ids "$inst" >/dev/null
  say "Starting as $want"
  aws ec2 wait instance-running --instance-ids "$inst"
  ok "Now a $want"
}

# Start a stopped (or stopping) instance; a running one is left alone.
start_instance() {
  local inst="$1"
  [[ "$(instance_field "$inst" State.Name)" =~ ^(stopped|stopping)$ ]] || return 0
  say "Starting $inst"
  aws ec2 wait instance-stopped --instance-ids "$inst"
  aws ec2 start-instances --instance-ids "$inst" >/dev/null
}

require_instance() {
  INSTANCE_ID=$(find_instance)
  [[ -n "$INSTANCE_ID" ]] || die "no office named \"$NAME\" in $AWS_REGION — run: deploy/aws.sh up"
  [[ "$(instance_field "$INSTANCE_ID" State.Name)" =~ ^(stopped|stopping)$ ]] &&
    die "the office is paused — start it with: deploy/aws.sh resume$NAME_FLAG"
  IP=$(instance_field "$INSTANCE_ID" PublicIpAddress)
  [[ -n "$IP" ]] || die "the instance $INSTANCE_ID has no public IP (is it stopped?)"
}

ssh_opts() {
  echo -i "$KEY_FILE" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KNOWN_HOSTS" \
    -o ConnectTimeout=8 -o ServerAliveInterval=15 -o LogLevel=ERROR
}

remote() {
  [[ -f "$KEY_FILE" ]] || die "the SSH key for this office isn't on this machine ($KEY_FILE)"
  # shellcheck disable=SC2046
  ssh $(ssh_opts) "$SSH_USER@$IP" "$@"
}

# Only SSH is ever opened; the office itself is reached through the tunnel.
allow_cidr() {
  local sg="$1" cidr="$2" out
  if ! out=$(aws ec2 authorize-security-group-ingress --group-id "$sg" \
    --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$cidr,Description=agent-office}]" 2>&1); then
    [[ "$out" == *InvalidPermission.Duplicate* ]] || die "could not allow $cidr: $out"
  fi
}

revoke_cidr() {
  aws ec2 revoke-security-group-ingress --group-id "$1" --protocol tcp --port 22 --cidr "$2" >/dev/null 2>&1 || true
}

allowed_cidrs() {
  aws_ ec2 describe-security-groups --group-ids "$1" \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`${2:-22}\`].IpRanges[].CidrIp" | tr '\t' '\n' | sed '/^$/d;/^None$/d'
}

office_get() { remote "curl -fs --max-time 4 http://127.0.0.1:$OFFICE_PORT$1"; }

# The office's name on your tailnet (agent-office.tail1234.ts.net), if it's on one.
tailnet_host() { remote "cat /etc/agent-office/tailscale 2>/dev/null" 2>/dev/null | tr -d '[:space:]' || true; }

# Can this computer reach it there? (Tailscale on, signed in to the same tailnet.)
tailnet_reachable() { curl -fs -o /dev/null --max-time 20 "https://$1/api/health" 2>/dev/null; }

# Prints the provisioning output, and opens the pages Tailscale asks you to visit (to add the
# machine, or to turn HTTPS certificates on) in your browser.
open_tailscale_links() {
  local line url opened=" "
  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s\n' "$line"
    [[ "$line" =~ (https://login\.tailscale\.com/[^[:space:]]+) ]] || continue
    url="${BASH_REMATCH[1]}"
    [[ "$opened" == *" $url "* ]] && continue
    opened+="$url "
    open_url "$url"
  done
  return 0
}

tailnet_invite() {
  local ts="$1"
  echo "   Your office is on your Tailscale network: https://$ts"
  echo
  echo "   Everyone on your tailnet can open it: send them the link. For someone who isn't:"
  echo "     - share just this machine: $TAILSCALE_ADMIN/machines -> ${ts%%.*} -> Share..."
  echo "       They accept it in their own Tailscale, then open the link. They reach this machine"
  echo "       and nothing else of yours."
  echo "     - or add them to your tailnet: $TAILSCALE_ADMIN/users"
  echo
  echo "   Then they sign in with the office password, or an account link from 🔑 Accounts."
}

wait_healthy() {
  local i rc
  for ((i = 0; i < 30; i++)); do
    rc=0
    remote "for i in \$(seq 90); do curl -fs --max-time 4 http://127.0.0.1:$OFFICE_PORT/api/health >/dev/null && exit 0; sleep 2; done; exit 1" \
      2>/dev/null || rc=$?
    [[ $rc -eq 255 ]] || return "$rc" # 255: ssh itself failed, the machine is still booting
    sleep 5
  done
  return 1
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

# Forward localhost:<port> to the office on the box, open the browser, and hold until Ctrl-C.
tunnel() {
  local path="$1" port pid i up=0
  port=$(pick_port) || exit 1
  # shellcheck disable=SC2046
  ssh $(ssh_opts) -N -o ExitOnForwardFailure=yes -L "$port:127.0.0.1:$OFFICE_PORT" "$SSH_USER@$IP" &
  pid=$!
  trap 'kill "$pid" 2>/dev/null; echo; ok "Tunnel closed"; exit 0' INT TERM
  for ((i = 0; i < 40; i++)); do
    kill -0 "$pid" 2>/dev/null || die "couldn't open the SSH tunnel to $IP"
    curl -fs --max-time 2 "http://localhost:$port/api/health" >/dev/null 2>&1 && { up=1; break; }
    sleep 0.5
  done
  if [[ $up -ne 1 ]]; then
    kill "$pid" 2>/dev/null
    die "the tunnel opened but the office didn't answer through it — check: deploy/aws.sh logs$NAME_FLAG"
  fi
  ok "Your office: http://localhost:$port$path"
  echo "   (tunneled over SSH to $IP — keep this running while you use it; Ctrl-C closes it)"
  open_url "http://localhost:$port$path"
  wait "$pid" || true
  trap - INT TERM
  warn "The tunnel dropped — reopen it with: deploy/aws.sh open$NAME_FLAG"
}

# A worker's server from the 🌐 Services board: localhost:<port> tunnels to the office, which
# relays it by that port (see src/server/relay.ts), so the local port must match the service's.
service_tunnel() {
  local port="$1" pid i up=0
  port_busy "$port" && die "localhost:$port is already in use on this computer — stop whatever runs there first"
  # shellcheck disable=SC2046
  ssh $(ssh_opts) -N -o ExitOnForwardFailure=yes -L "$port:127.0.0.1:$OFFICE_PORT" "$SSH_USER@$IP" &
  pid=$!
  trap 'kill "$pid" 2>/dev/null; echo; ok "Tunnel closed"; exit 0' INT TERM
  for ((i = 0; i < 40; i++)); do
    kill -0 "$pid" 2>/dev/null || die "couldn't open the SSH tunnel to $IP"
    port_busy "$port" && { up=1; break; }
    sleep 0.5
  done
  [[ $up -eq 1 ]] || { kill "$pid" 2>/dev/null; die "the tunnel didn't come up"; }
  ok "The worker's server: http://localhost:$port"
  echo "   (through the office on $IP — sign in with the office password if it asks; Ctrl-C closes it)"
  open_url "http://localhost:$port"
  wait "$pid" || true
  trap - INT TERM
  warn "The tunnel dropped — reopen it with: deploy/aws.sh service $port$NAME_FLAG"
}

open_office() {
  local claimable path="/" ts
  claimable=$(office_get /api/claim 2>/dev/null || true)
  if [[ "$claimable" == *'"claimable":true'* && -f "$CLAIM_FILE" ]]; then
    path="/claim?t=$(cat "$CLAIM_FILE")"
    say "Opening the one-time password page — write the password down, it is never shown again"
  fi
  ts=$(tailnet_host)
  if [[ -n "$ts" ]]; then
    if tailnet_reachable "$ts"; then
      ok "Your office: https://$ts$path"
      echo "   (on your Tailscale network: nothing to keep running)"
      open_url "https://$ts$path"
      return
    fi
    warn "This computer can't reach https://$ts — is Tailscale running here, signed in to the same tailnet?"
    warn "Opening it through an SSH tunnel instead."
  fi
  tunnel "$path"
}

valid_member() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$ ]] || die "names are letters, numbers, dots, dashes and underscores: $1"; }

# Teammates' keys are managed on the box by agent-office-team (installed by provision.sh).
require_team() {
  remote "test -x /usr/local/bin/agent-office-team" 2>/dev/null || die "this office predates team access — run: deploy/aws.sh up$NAME_FLAG"
}

team_members() { remote "agent-office-team list"; } # "<name> <number of keys>" per line

# --- commands --------------------------------------------------------------------------------------

github_https() {
  # git@github.com:owner/repo(.git) | https://github.com/owner/repo(.git) | owner/repo -> https URL
  local v="$1"
  v="${v%.git}"
  v="${v#git@github.com:}"
  v="${v#https://github.com/}"
  v="${v#ssh://git@github.com/}"
  [[ "$v" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || return 1
  echo "https://github.com/$v"
}

cmd_up() {
  preflight
  need ssh-keygen

  # What to install. The office starts with no project (never the checkout this script is in):
  # everyone picks theirs in its elevator, unless --project names a first one.
  if [[ -z "$APP_REPO" ]]; then
    APP_REPO=$(github_https "$(git -C "$SCRIPT_DIR/.." remote get-url origin 2>/dev/null || true)" || echo "https://github.com/AgentSystemLabs/agent-office")
  fi
  local project_repo=""
  if [[ -n "$PROJECT" ]]; then
    project_repo=$(github_https "$PROJECT") || die "--project must be a GitHub repo (owner/name or URL), got: $PROJECT"
  fi

  local gh_token="$GH_TOKEN_ARG"
  if [[ -z "$gh_token" && $NO_GH_TOKEN -eq 0 ]] && command -v gh >/dev/null 2>&1; then
    gh_token=$(gh auth token 2>/dev/null || true)
  fi
  [[ $NO_GH_TOKEN -eq 1 ]] && gh_token=""

  local my
  my=$(my_ip) || die "couldn't detect your public IP"
  local cidrs=("$my/32")
  local a
  for a in "${EXTRA_ALLOW[@]+"${EXTRA_ALLOW[@]}"}"; do cidrs+=("$(to_cidr "$a")"); done

  say "Agent Office \"$NAME\" in $AWS_REGION (account $ACCOUNT)"
  echo "   machine:  $INSTANCE_TYPE, ${DISK_GB} GiB disk, Ubuntu 24.04"
  echo "   app:      $APP_REPO @ $APP_REF"
  echo "   projects: ${project_repo:+$project_repo, then }pick them in the office's elevator (cloned into ~/workspace)"
  if [[ $TAILSCALE -eq 1 ]]; then
    echo "   access:   your Tailscale network, https://$(ts_name).<your-tailnet>.ts.net (the office is never"
    echo "             exposed); SSH from ${cidrs[*]}, for this script"
  else
    echo "   access:   SSH tunnel only (the office is never exposed); SSH from ${cidrs[*]}"
  fi
  if [[ -n "$gh_token" ]]; then
    echo "   github:   your GitHub token goes on the machine (private clones, issue/PR boards, pushes)"
  else
    echo "   github:   no token — private repos and the boards won't work"
  fi
  if [[ -n "$CLAUDE_TOKEN" || -n "$ANTHROPIC_KEY" ]]; then
    echo "   claude:   signed in with the token you provided"
  else
    echo "   claude:   not signed in — log in from the first worker's terminal (or pass --claude-token)"
  fi
  echo "   others:   only Claude Code is provisioned; install and sign in to OpenCode, Codex"
  echo "             or DeepSeek Harness (dsh) on the box yourself to hire those workers"

  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"

  # SSH key pair (ed25519), kept locally.
  if [[ ! -f "$KEY_FILE" ]]; then
    if aws ec2 describe-key-pairs --key-names "$RESOURCE" >/dev/null 2>&1; then
      [[ -n "$(find_instance)" ]] && die "key pair $RESOURCE exists in AWS but its private key isn't here ($KEY_FILE)"
      aws ec2 delete-key-pair --key-name "$RESOURCE" >/dev/null
    fi
    ssh-keygen -q -t ed25519 -N '' -C "$RESOURCE" -f "$KEY_FILE"
  fi
  if ! aws ec2 describe-key-pairs --key-names "$RESOURCE" >/dev/null 2>&1; then
    aws ec2 import-key-pair --key-name "$RESOURCE" --public-key-material "fileb://$KEY_FILE.pub" \
      --tag-specifications "ResourceType=key-pair,Tags=[{Key=agent-office,Value=$NAME}]" >/dev/null
    ok "SSH key pair $RESOURCE"
  fi

  # Security group: only the allowed IPs can reach 22 (ssh). Nothing else is open.
  local vpc sg
  vpc=$(aws_ ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' | sed 's/^None$//')
  [[ -n "$vpc" ]] || die "no default VPC in $AWS_REGION (create one with: aws ec2 create-default-vpc)"
  sg=$(find_sg)
  if [[ -z "$sg" ]]; then
    sg=$(aws_ ec2 create-security-group --group-name "$RESOURCE" --vpc-id "$vpc" \
      --description "Agent Office $NAME - SSH from allowed IPs only" \
      --tag-specifications "ResourceType=security-group,Tags=[{Key=agent-office,Value=$NAME},{Key=Name,Value=$RESOURCE}]" \
      --query GroupId)
    ok "Security group $sg"
  fi
  local c
  for c in "${cidrs[@]}"; do allow_cidr "$sg" "$c"; done
  # Offices from before the SSH tunnel served https on 443 to the allowed IPs; close that.
  for c in $(allowed_cidrs "$sg" 443); do
    aws ec2 revoke-security-group-ingress --group-id "$sg" --protocol tcp --port 443 --cidr "$c" >/dev/null 2>&1 || true
  done
  ok "SSH allowed from ${cidrs[*]}"

  # The machine.
  INSTANCE_ID=$(find_instance)
  if [[ -z "$INSTANCE_ID" ]]; then
    local arch ami
    arch=$(aws_ ec2 describe-instance-types --instance-types "$INSTANCE_TYPE" --query 'InstanceTypes[0].ProcessorInfo.SupportedArchitectures[0]') ||
      die "unknown instance type $INSTANCE_TYPE"
    [[ "$arch" == "x86_64" ]] && arch="amd64"
    ami=$(aws_ ssm get-parameter --name "/aws/service/canonical/ubuntu/server/24.04/stable/current/$arch/hvm/ebs-gp3/ami-id" --query Parameter.Value)
    say "Launching $INSTANCE_TYPE ($ami)"
    INSTANCE_ID=$(aws_ ec2 run-instances --image-id "$ami" --instance-type "$INSTANCE_TYPE" \
      --key-name "$RESOURCE" --security-group-ids "$sg" \
      --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$DISK_GB,VolumeType=gp3,DeleteOnTermination=true}" \
      --metadata-options "HttpTokens=required,HttpEndpoint=enabled" \
      --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$RESOURCE},{Key=agent-office,Value=$NAME}]" \
      "ResourceType=volume,Tags=[{Key=Name,Value=$RESOURCE},{Key=agent-office,Value=$NAME}]" \
      --query 'Instances[0].InstanceId')
  elif [[ $INSTANCE_TYPE_SET -eq 1 && "$(instance_field "$INSTANCE_ID" InstanceType)" != "$INSTANCE_TYPE" ]]; then
    resize_instance "$INSTANCE_ID" "$INSTANCE_TYPE"
  elif [[ "$(instance_field "$INSTANCE_ID" State.Name)" =~ ^(stopped|stopping)$ ]]; then
    start_instance "$INSTANCE_ID"
  else
    say "Reusing $INSTANCE_ID ($(instance_field "$INSTANCE_ID" InstanceType))"
  fi
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  ensure_eip "$INSTANCE_ID"
  ok "Instance $INSTANCE_ID is running at $IP"

  say "Waiting for SSH"
  local i
  for ((i = 0; i < 60; i++)); do
    remote true 2>/dev/null && break
    sleep 5
  done
  remote true || die "SSH never came up on $IP"

  [[ -f "$CLAIM_FILE" ]] || (umask 077 && random_token >"$CLAIM_FILE")

  say "Provisioning (Node, git, gh, Claude Code, agent-office) — a few minutes on first run"
  local git_name git_email
  git_name=$(git config user.name 2>/dev/null || true)
  git_email=$(git config user.email 2>/dev/null || true)
  {
    printf 'export APP_REPO=%q APP_REF=%q PROJECT_REPO=%q\n' "$APP_REPO" "$APP_REF" "$project_repo"
    printf 'export CLAIM_TOKEN=%q PUBLIC_HOST=%q GH_TOKEN=%q CLAUDE_CODE_OAUTH_TOKEN=%q ANTHROPIC_API_KEY=%q\n' "$(cat "$CLAIM_FILE")" "$IP" "$gh_token" "$CLAUDE_TOKEN" "$ANTHROPIC_KEY"
    printf 'export GIT_NAME=%q GIT_EMAIL=%q\n' "$git_name" "$git_email"
    [[ $TAILSCALE -eq 1 ]] && printf 'export TAILSCALE=1 TAILSCALE_AUTH_KEY=%q TAILSCALE_HOSTNAME=%q\n' "$TS_KEY" "$(ts_name)"
    cat "$SCRIPT_DIR/provision.sh"
  } | remote 'bash -s' | open_tailscale_links || die "provisioning failed (re-run \"deploy/aws.sh up\" to retry; it picks up where it left off)"

  say "Waiting for the office to answer"
  wait_healthy || die "the office didn't come up — check: deploy/aws.sh logs"
  local ts
  ts=$(tailnet_host)
  if [[ -n "$ts" ]]; then
    ok "Your office is running on your Tailscale network: https://$ts"
  else
    ok "Your office is running on $IP (reachable only through SSH)"
  fi
  echo
  echo "   Open it later:     deploy/aws.sh open$NAME_FLAG"
  if [[ -n "$ts" ]]; then
    echo "   Add a teammate:    share it on Tailscale — deploy/aws.sh invite$NAME_FLAG says how"
    echo "   Key expiry:        Tailscale expires the machine's key in 180 days. Turn that off on"
    echo "                      $TAILSCALE_ADMIN/machines (${ts%%.*} -> Disable key expiry)"
  else
    echo "   Add a teammate:    the 👥 Invite button in the office, or deploy/aws.sh invite <their-github-username>$NAME_FLAG"
  fi
  echo "   Pause / resume:    deploy/aws.sh pause$NAME_FLAG   /   deploy/aws.sh resume$NAME_FLAG"
  echo "   Tear it down:      deploy/aws.sh destroy$NAME_FLAG"
  echo
  [[ $NO_OPEN -eq 1 ]] && return
  open_office
}

cmd_open() {
  preflight
  require_instance
  wait_healthy || die "the office isn't answering — check: deploy/aws.sh logs$NAME_FLAG"
  open_office
}

cmd_service() {
  preflight
  [[ ${#POSITIONAL[@]} -eq 1 && "${POSITIONAL[0]}" =~ ^[0-9]+$ && ${POSITIONAL[0]} -gt 0 && ${POSITIONAL[0]} -lt 65536 ]] ||
    die "usage: deploy/aws.sh service <port>   (a port from the office's 🌐 Services board)"
  [[ "${POSITIONAL[0]}" -ne $OFFICE_PORT ]] || die "$OFFICE_PORT is the office itself — use: deploy/aws.sh open"
  require_instance
  local ts port="${POSITIONAL[0]}"
  ts=$(tailnet_host)
  # On the tailnet, each worker's server has its own https://<office>.ts.net:<port>.
  if [[ -n "$ts" && "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$ts:$port/" 2>/dev/null)" != 000 ]]; then
    ok "The worker's server: https://$ts:$port"
    echo "   (on your Tailscale network — sign in with the office password if it asks)"
    open_url "https://$ts:$port"
    return
  fi
  service_tunnel "$port"
}

cmd_status() {
  preflight
  INSTANCE_ID=$(find_instance)
  if [[ -z "$INSTANCE_ID" ]]; then
    echo "No office named \"$NAME\" in $AWS_REGION."
    return
  fi
  local sg state
  sg=$(find_sg)
  state=$(instance_field "$INSTANCE_ID" State.Name)
  IP=$(instance_field "$INSTANCE_ID" PublicIpAddress)
  echo "office:    $NAME ($AWS_REGION)"
  echo "instance:  $INSTANCE_ID $(instance_field "$INSTANCE_ID" InstanceType) $state"
  echo "address:   ${IP:-none}  (open the office with: deploy/aws.sh open$NAME_FLAG)"
  if [[ "$state" =~ ^(stopped|stopping)$ ]]; then
    echo "office:    paused (start it with: deploy/aws.sh resume$NAME_FLAG)"
  elif [[ -n "$IP" && -f "$KEY_FILE" ]] && office_get /api/health >/dev/null 2>&1; then
    echo "office:    up"
    local ts
    ts=$(tailnet_host)
    [[ -z "$ts" ]] || echo "tailnet:   https://$ts"
    local team
    team=$(team_members 2>/dev/null | awk '{printf "%s%s", sep, $1; sep=", "}')
    echo "team:      ${team:-nobody invited yet}"
  else
    echo "office:    not answering"
  fi
  echo "ssh from:  $(allowed_cidrs "$sg" | tr '\n' ' ')"
}

cmd_allow() {
  preflight
  [[ ${#POSITIONAL[@]} -gt 0 ]] || die "usage: deploy/aws.sh allow <ip|cidr|me> [...]"
  local sg c
  sg=$(find_sg)
  [[ -n "$sg" ]] || die "no office named \"$NAME\" — run: deploy/aws.sh up"
  for c in "${POSITIONAL[@]}"; do
    c=$(to_cidr "$c")
    allow_cidr "$sg" "$c"
    ok "Allowed $c"
  done
}

cmd_revoke() {
  preflight
  [[ ${#POSITIONAL[@]} -gt 0 ]] || die "usage: deploy/aws.sh revoke <ip|cidr|me> [...]"
  local sg c
  sg=$(find_sg)
  [[ -n "$sg" ]] || die "no office named \"$NAME\""
  for c in "${POSITIONAL[@]}"; do
    c=$(to_cidr "$c")
    revoke_cidr "$sg" "$c"
    ok "Revoked $c"
  done
}

cmd_invite() {
  preflight
  if [[ ${#POSITIONAL[@]} -eq 0 ]]; then
    require_instance
    local ts
    ts=$(tailnet_host)
    [[ -n "$ts" ]] || die "usage: deploy/aws.sh invite <github-username>   or   deploy/aws.sh invite <name> <public-key-file>"
    tailnet_invite "$ts"
    return
  fi
  [[ ${#POSITIONAL[@]} -le 2 ]] ||
    die "usage: deploy/aws.sh invite <github-username>   or   deploy/aws.sh invite <name> <public-key-file>"
  local who="${POSITIONAL[0]}" src raw keys
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
  require_instance
  require_team
  local n
  # The box keeps only valid keys and restricts each one to opening the tunnel.
  n=$(printf '%s\n' "$raw" | remote "agent-office-team add $who") || die "couldn't add $who's keys from $src"
  ok "$who is invited ($n key(s) from $src)"

  local sg a fp
  sg=$(find_sg)
  for a in "${EXTRA_ALLOW[@]+"${EXTRA_ALLOW[@]}"}"; do
    a=$(to_cidr "$a")
    allow_cidr "$sg" "$a"
    ok "SSH allowed from $a"
  done
  fp=$(remote "ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub" | awk '{print $2}')
  echo
  echo "   Send $who this:"
  echo
  echo "     ssh -L 4600:localhost:$OFFICE_PORT $TEAM_USER@$IP"
  echo
  echo "     Leave it running, open http://localhost:4600 and sign in with the office password."
  echo "     The first time, ssh asks you to trust the server. Only say yes if it shows"
  echo "     ED25519 key fingerprint $fp"
  echo
  if ! allowed_cidrs "$sg" | grep -qx '0.0.0.0/0'; then
    echo "   SSH only answers allowed IPs, so also run: deploy/aws.sh allow <their-ip>$NAME_FLAG"
    echo "   (or \"allow anywhere\" — SSH only accepts your key and invited keys)"
  fi
}

cmd_uninvite() {
  preflight
  [[ ${#POSITIONAL[@]} -eq 1 ]] || die "usage: deploy/aws.sh uninvite <name>"
  local who="${POSITIONAL[0]}" out rc=0
  valid_member "$who"
  require_instance
  require_team
  out=$(remote "agent-office-team remove $who" 2>&1) || rc=$?
  [[ $rc -eq 66 ]] && die "$who isn't invited (see: deploy/aws.sh team$NAME_FLAG)"
  [[ $rc -eq 0 ]] || die "couldn't remove the keys: $out"
  ok "$who's keys are removed and open tunnels were dropped (other teammates just reconnect)"
  echo "   They still know the office password. To change it: deploy/aws.sh reset-password$NAME_FLAG"
}

cmd_team() {
  preflight
  require_instance
  require_team
  local list
  list=$(team_members)
  if [[ -z "$list" ]]; then
    echo "Nobody is invited yet. Add someone: deploy/aws.sh invite <github-username>$NAME_FLAG"
    return
  fi
  echo "$list" | awk '{printf "%s  (%d key%s)\n", $1, $2, ($2 == 1 ? "" : "s")}'
}

cmd_ssh() {
  preflight
  require_instance
  # shellcheck disable=SC2046
  exec ssh $(ssh_opts) -t "$SSH_USER@$IP" "${POSITIONAL[@]+"${POSITIONAL[@]}"}"
}

cmd_logs() {
  preflight
  require_instance
  # shellcheck disable=SC2046
  exec ssh $(ssh_opts) -t "$SSH_USER@$IP" 'sudo journalctl -u agent-office -n 100 -f'
}

cmd_resize() {
  preflight
  [[ ${#POSITIONAL[@]} -eq 1 ]] || die "usage: deploy/aws.sh resize <instance-type>   (e.g. t3.2xlarge, m7i.xlarge)"
  INSTANCE_ID=$(find_instance)
  [[ -n "$INSTANCE_ID" ]] || die "no office named \"$NAME\" in $AWS_REGION — run: deploy/aws.sh up"
  resize_instance "$INSTANCE_ID" "${POSITIONAL[0]}"
  ensure_eip "$INSTANCE_ID"
  say "Waiting for the office to answer"
  wait_healthy || die "the office didn't come back — check: deploy/aws.sh logs"
  ok "Your office is back — open it with: deploy/aws.sh open$NAME_FLAG"
}

cmd_pause() {
  preflight
  INSTANCE_ID=$(find_instance)
  [[ -n "$INSTANCE_ID" ]] || die "no office named \"$NAME\" in $AWS_REGION"
  local state
  state=$(instance_field "$INSTANCE_ID" State.Name)
  if [[ "$state" != "stopped" ]]; then
    say "Pausing office \"$NAME\" ($INSTANCE_ID). Running workers stop and come back asleep"
    echo "   when you resume (press R at their desk). Open tunnels, teammates' too, are dropped."
    if [[ $YES -ne 1 ]]; then
      read -r -p "   Continue? [y/N] " answer
      [[ "$answer" =~ ^[Yy] ]] || die "cancelled"
    fi
    [[ "$state" == "pending" ]] && aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
    [[ "$state" != "stopping" ]] && aws ec2 stop-instances --instance-ids "$INSTANCE_ID" >/dev/null
    say "Stopping"
    aws ec2 wait instance-stopped --instance-ids "$INSTANCE_ID"
  fi
  ok "Paused. The disk and the address stay (and are all that's billed until you resume)"
  echo "   Start it again with: deploy/aws.sh resume$NAME_FLAG"
}

cmd_resume() {
  preflight
  INSTANCE_ID=$(find_instance)
  [[ -n "$INSTANCE_ID" ]] || die "no office named \"$NAME\" in $AWS_REGION — run: deploy/aws.sh up"
  start_instance "$INSTANCE_ID"
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  ensure_eip "$INSTANCE_ID"
  say "Waiting for the office to answer"
  wait_healthy || die "the office didn't come back — check: deploy/aws.sh logs$NAME_FLAG"
  ok "Your office is back (workers pick up where they left off)"
  [[ $NO_OPEN -eq 1 ]] && return
  open_office
}

cmd_update() {
  preflight
  require_instance
  say "Updating agent-office on $IP"
  remote "set -e
    ref=\$(git -C /opt/agent-office rev-parse --abbrev-ref HEAD)
    git -C /opt/agent-office fetch --depth 1 origin \"\$ref\" -q
    git -C /opt/agent-office reset --hard FETCH_HEAD -q
    echo \"   at \$(git -C /opt/agent-office log -1 --format='%h %s')\"
    cd /opt/agent-office && npm install --no-audit --no-fund --loglevel=error >/dev/null
    # Offices provisioned before KillMode=process: without it the restart stops every worker too.
    if [ \"\$(systemctl show --property=KillMode --value agent-office)\" != process ]; then
      sudo mkdir -p /etc/systemd/system/agent-office.service.d
      printf '[Service]\nKillMode=process\n' | sudo tee /etc/systemd/system/agent-office.service.d/keep-workers.conf >/dev/null
      sudo systemctl daemon-reload
    fi
    sudo systemctl restart agent-office" || die "update failed"
  wait_healthy || die "the office didn't come back — check: deploy/aws.sh logs"
  ok "Updated and restarted (workers carry on through it)"
}

cmd_reset_password() {
  preflight
  require_instance
  (umask 077 && random_token >"$CLAIM_FILE")
  say "Resetting the office password"
  remote "set -e
    # An office from before ~/agent-office keeps its data in its project (/etc/agent-office/dir).
    if [ -f /etc/agent-office/dir ]; then set -- \"\$(cat /etc/agent-office/dir)\"; else set -- --home \"\$(cat /etc/agent-office/home)\"; fi
    sudo sed -i 's/^AGENT_OFFICE_CLAIM_TOKEN=.*/AGENT_OFFICE_CLAIM_TOKEN=\"$(cat "$CLAIM_FILE")\"/' /etc/agent-office/env
    sudo systemctl stop agent-office
    node /opt/agent-office/bin/agent-office.js \"\$@\" --reset-password >/dev/null
    sudo systemctl start agent-office" || die "reset failed"
  wait_healthy || die "the office didn't come back — check: deploy/aws.sh logs"
  ok "Everyone has been signed out"
  open_office
}

cmd_down() {
  preflight
  local inst sg
  inst=$(find_instance)
  sg=$(find_sg)
  local eip_alloc
  eip_alloc=$(find_eip | awk '{print $1}')
  if [[ -z "$inst" && -z "$sg" && ( -z "$eip_alloc" || "$eip_alloc" == "None" ) ]] && ! aws ec2 describe-key-pairs --key-names "$RESOURCE" >/dev/null 2>&1; then
    echo "Nothing to delete for \"$NAME\" in $AWS_REGION."
    rm -rf "$STATE_DIR"
    return
  fi
  say "This permanently deletes office \"$NAME\" in $AWS_REGION: ${inst:-no instance}${sg:+, $sg}, its Elastic IP and key pair $RESOURCE."
  echo "   Anything on the machine that isn't pushed to GitHub is lost."
  if [[ $YES -ne 1 ]]; then
    read -r -p "   Type the office name ($NAME) to confirm: " answer
    [[ "$answer" == "$NAME" ]] || die "cancelled"
  fi
  if [[ -n "$inst" ]]; then
    local ts=""
    if [[ "$(instance_field "$inst" State.Name)" == running && -f "$KEY_FILE" ]]; then
      IP=$(instance_field "$inst" PublicIpAddress)
      [[ -n "$IP" ]] && ts=$(tailnet_host)
    fi
    if [[ -n "$ts" ]]; then
      remote "sudo tailscale logout" >/dev/null 2>&1 || true
      ok "Signed $ts out of your tailnet (if it's still listed on $TAILSCALE_ADMIN/machines, remove it there)"
    fi
    aws ec2 terminate-instances --instance-ids "$inst" >/dev/null
    say "Terminating $inst"
    aws ec2 wait instance-terminated --instance-ids "$inst"
    ok "Instance terminated (its disk goes with it)"
  fi
  if [[ -n "$sg" ]]; then
    local i
    for ((i = 0; i < 30; i++)); do
      aws ec2 delete-security-group --group-id "$sg" >/dev/null 2>&1 && break
      sleep 5
    done
    aws ec2 describe-security-groups --group-ids "$sg" >/dev/null 2>&1 && die "couldn't delete $sg yet — run destroy again in a minute"
    ok "Security group deleted"
  fi
  local alloc assoc eip
  read -r alloc assoc eip <<<"$(find_eip)"
  if [[ -n "$alloc" && "$alloc" != "None" ]]; then
    aws ec2 release-address --allocation-id "$alloc" >/dev/null
    ok "Elastic IP $eip released"
  fi
  aws ec2 delete-key-pair --key-name "$RESOURCE" >/dev/null 2>&1 || true
  ok "Key pair deleted"
  rm -rf "$STATE_DIR"
  ok "All gone"
}

case "$CMD" in
  up) cmd_up ;;
  open) cmd_open ;;
  service) cmd_service ;;
  status) cmd_status ;;
  invite) cmd_invite ;;
  uninvite) cmd_uninvite ;;
  team) cmd_team ;;
  allow) cmd_allow ;;
  revoke) cmd_revoke ;;
  ssh) cmd_ssh ;;
  logs) cmd_logs ;;
  resize) cmd_resize ;;
  pause) cmd_pause ;;
  resume) cmd_resume ;;
  update) cmd_update ;;
  reset-password) cmd_reset_password ;;
  destroy | down) cmd_down ;;
  help | -h | --help) usage ;;
  *) die "unknown command \"$CMD\" (see: deploy/aws.sh help)" ;;
esac
