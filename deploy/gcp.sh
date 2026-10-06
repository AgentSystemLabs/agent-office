#!/usr/bin/env bash
# Deploy your own Agent Office to Google Cloud with one command, using only the gcloud CLI.
#
#   deploy/gcp.sh up        create the VM, install and start the office, open it
#   deploy/gcp.sh open      tunnel to the office and open it in your browser
#   deploy/gcp.sh pause     stop the VM to save money (asks first)
#   deploy/gcp.sh resume    start it again
#   deploy/gcp.sh destroy   delete everything it created (asks first)
#
# Everything it makes is named agent-office (or agent-office-<name>): a VPC network of its own, one
# firewall rule, a static address and the VM. The office is never exposed to the internet: it listens
# on the VM's loopback and everyone reaches it through an SSH tunnel. Run `deploy/gcp.sh help` for all
# commands and options. It's deploy/aws.sh for Google Cloud: same commands, same deploy/provision.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="agent-office"
# 4 vCPU and 16 GiB, like the t3.xlarge deploy/aws.sh uses, for less. E2 has no CPU credits to run
# out of (the reason deploy/azure.sh avoids Azure's B-series); only e2-micro/small/medium share cores.
DEFAULT_TYPE="e2-standard-4"
TYPE="$DEFAULT_TYPE"
TYPE_SET=0
DISK_GB=50
ZONE_ARG=""
GCP_PROJECT_ARG=""
APP_REF="main"
APP_REPO=""
PROJECT="" # the GitHub repo of the first floor (--project owner/repo, as in deploy/aws.sh)
GH_TOKEN_ARG=""
NO_GH_TOKEN=0
CLAUDE_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"
ANTHROPIC_KEY=""
YES=0
NO_OPEN=0
EXTRA_ALLOW=()
SSH_USER="ubuntu"
TEAM_USER="office"   # teammates' keys log in as this user, which can only tunnel to the office
OFFICE_PORT=4600     # where the office listens on the VM (127.0.0.1 only)
LOCAL_PORT=4600
LOCAL_PORT_SET=0

usage() {
  cat <<'EOF'
Agent Office on Google Cloud — one command up, one command down.

Usage: deploy/gcp.sh <command> [options]

The office is never on the internet. It listens on the VM's loopback, the firewall only opens
SSH, and everyone reaches the office through an SSH tunnel on http://localhost:4600.

Commands
  up                 Create (or reuse) your office on a Compute Engine VM, install and start it, and
                     open it in your browser. The first page shows the office password ONCE — write it down.
  open               Tunnel to your office and open it in the browser (Ctrl-C closes the tunnel)
  pause              Stop the VM to save money (asks first). The disk, the address and everything
                     on it stay; only the disk and the address are billed while paused
  resume             Start a paused office again and open it in the browser
  destroy            Delete the VM, its disk, its address, its firewall rule and its network (asks
                     you to type the office name first). `down` does the same.
  connect            Let this computer manage an office made on another one: adds this
                     computer's SSH key to the VM and its IP to the firewall, and nothing else

  service <port>     Open a worker's web server from the office's 🌐 Services board on
                     http://localhost:<port> (through the office; Ctrl-C closes the tunnel)
  invite <gh-user>   Let a teammate tunnel in with the SSH keys on their GitHub account, and
                     print the one command to send them. Or: invite <name> <public-key-file>
  uninvite <name>    Remove a teammate's keys and drop open tunnels
  team               List who is invited
  status             Show the VM, whether the office is up and which IPs may SSH in
  allow <ip|me>      Let an IP (or CIDR) reach SSH. "me" = your current IP. "anywhere" opens SSH
                     to every IP — reasonable, since it only accepts your key and invited keys
  revoke <ip|me>     Take that access away again
  ssh                SSH into the VM
  logs               Follow the office's logs
  resize <type>      Change the machine type, e.g. e2-standard-8 (stops it for a minute or two;
                     the address stays the same). `up --machine-type <type>` does this too.
  update             Install the latest agent-office on the VM and restart it
  reset-password     Forget the password and show a new one once in your browser

Options
  --name <name>             Deployment name, lets you run several offices (default: agent-office).
                            Everything the office is made of is named after it
  --project <owner/repo>    Also clone this GitHub repo as the office's first floor. Without it
                            the office opens on its elevator, which lists every repo your GitHub
                            token can see: pick one there. Projects go in ~/workspace on the VM.
                            A value without a slash is taken as the Google Cloud project instead
  --gcp-project <id>        Google Cloud project to put the office in (default: the gcloud CLI's
                            current one). The office's other commands remember it
  --repo <owner/repo>       The first floor, spelled out (the same as --project owner/repo)
  --zone <zone>             Zone for a new office, e.g. europe-west1-b (default: your gcloud CLI's
                            default zone, else us-central1-a). An office stays in the zone it was
                            created in. --region <region> picks that region's first zone
  --machine-type <type>     Machine type (default: e2-standard-4 — 4 vCPU, 16 GiB). --size and
                            --instance-type work too
  --disk <GiB>              Boot disk size, balanced persistent disk (default: 50)
  --allow <ip|cidr>         With up or invite: also allow this IP to SSH in (repeatable).
                            Your own IP is always allowed.
  --port <n>                Local port for the tunnel (default: 4600, or the next free one)
  --app-repo <url>          agent-office repo to install (default: this checkout's GitHub origin)
  --app-ref <ref>           Branch or tag to install (default: main)
  --github-token <token>    GitHub token for private repos + the issue/PR boards
                            (default: your local `gh auth token`)
  --no-github-token         Don't put any GitHub token on the VM
  --claude-token <token>    Claude subscription token from `claude setup-token`
                            (default: $CLAUDE_CODE_OAUTH_TOKEN). Without one, log in from the
                            first worker's terminal in the office.
  --anthropic-api-key <key> Use an Anthropic API key instead
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

# The first word that isn't an option is the command; options can go before or after it.
CMD=""
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name | --project | --gcp-project | --repo | --zone | --region | --location | --machine-type | --size | --instance-type | \
      --disk | --allow | --port | --app-repo | --app-ref | --github-token | --claude-token | --anthropic-api-key)
      [[ $# -ge 2 ]] || die "$1 needs a value (see: deploy/gcp.sh help)" ;;
  esac
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    # Everyone on Google Cloud expects --project to be the project; the other deploy scripts use it
    # for the first floor's GitHub repo. A repo has a slash in it and a project ID can't, so both work.
    --project) if [[ "$2" == */* ]]; then PROJECT="$2"; else GCP_PROJECT_ARG="$2"; fi; shift 2 ;;
    --gcp-project) GCP_PROJECT_ARG="$2"; shift 2 ;;
    --repo) PROJECT="$2"; shift 2 ;;
    --zone | --region | --location) ZONE_ARG="$2"; shift 2 ;;
    --machine-type | --size | --instance-type) TYPE="$2"; TYPE_SET=1; shift 2 ;;
    --disk) DISK_GB="$2"; shift 2 ;;
    --allow) EXTRA_ALLOW+=("$2"); shift 2 ;;
    --port) LOCAL_PORT="$2"; LOCAL_PORT_SET=1; shift 2 ;;
    --app-repo) APP_REPO="$2"; shift 2 ;;
    --app-ref) APP_REF="$2"; shift 2 ;;
    --github-token) GH_TOKEN_ARG="$2"; shift 2 ;;
    --no-github-token) NO_GH_TOKEN=1; shift ;;
    --claude-token) CLAUDE_TOKEN="$2"; shift 2 ;;
    --anthropic-api-key) ANTHROPIC_KEY="$2"; shift 2 ;;
    --no-open) NO_OPEN=1; shift ;;
    -y | --yes) YES=1; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) die "unknown option $1 (see: deploy/gcp.sh help)" ;;
    *)
      if [[ -z "$CMD" ]]; then CMD="$1"; else POSITIONAL+=("$1"); fi
      shift
      ;;
  esac
done
CMD="${CMD:-help}"
# Compute Engine names and label values are lowercase, so the office's name is too.
NAME=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]')

# Resource names are built from it, and Compute Engine names can't start or end with a dash.
[[ "$NAME" =~ ^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$ ]] ||
  die "--name may only contain letters, numbers and dashes (not first or last), up to 40 of them"
[[ "$LOCAL_PORT" =~ ^[0-9]+$ && $LOCAL_PORT -gt 0 && $LOCAL_PORT -lt 65536 ]] || die "--port must be a port number"
[[ "$DISK_GB" =~ ^[0-9]+$ && $DISK_GB -ge 10 && $DISK_GB -le 65536 ]] || die "--disk must be a size in GiB, from 10 to 65536"
[[ "$TYPE" =~ ^[a-z0-9-]+$ ]] || die "not a machine type: $TYPE (e.g. $DEFAULT_TYPE)"
RESOURCE="agent-office-$NAME"
[[ "$NAME" == "agent-office" ]] && RESOURCE="agent-office"
VM="$RESOURCE"
ADDR="$RESOURCE"
NET="$RESOURCE-net"
FW="$RESOURCE-ssh"
TAG="$RESOURCE" # the network tag the firewall rule applies to
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/agent-office/gcp/$NAME"
NAME_FLAG=""
[[ "$NAME" != "agent-office" ]] && NAME_FLAG=" --name $NAME"
KEY_FILE="$STATE_DIR/id_ed25519"
KNOWN_HOSTS="$STATE_DIR/known_hosts"
CLAIM_FILE="$STATE_DIR/claim-token"
KEYS_FILE="$STATE_DIR/ssh-keys" # the VM's ssh-keys metadata, as last written
# The project `up` made the office in, so later commands look there without --gcp-project.
PROJECT_FILE="$STATE_DIR/project"
MADE_BY="Agent Office $NAME" # the description on everything the script makes, so it knows its own

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required (${2:-install it first})"; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# The gcloud CLI, pinned to one project, without prompts (--quiet also makes an expired sign-in
# fail instead of asking) and without warnings.
PROJECT_ARGS=()
gcc() { gcloud "$@" "${PROJECT_ARGS[@]+"${PROJECT_ARGS[@]}"}" --quiet --verbosity=error; }
# gcloud's tsv-like rows as space-separated words, with - for a missing value, so `read` keeps each in place.
words() { awk -F'\t' '{ for (i = 1; i <= NF; i++) { gsub(/ /, "", $i); if ($i == "") $i = "-" } $1 = $1; print }'; }

preflight() {
  need gcloud "https://cloud.google.com/sdk/docs/install"
  need ssh
  need curl
  ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)
  [[ -n "$ACCOUNT" ]] || die "the gcloud CLI isn't signed in (try: gcloud auth login)"
  # Fetching a token refreshes the sign-in, so an expired one fails here and not halfway through.
  gcloud auth print-access-token --quiet >/dev/null 2>&1 || die "the gcloud sign-in for $ACCOUNT has expired (try: gcloud auth login)"
  [[ -z "$GCP_PROJECT_ARG" && -s "$PROJECT_FILE" ]] && GCP_PROJECT_ARG=$(cat "$PROJECT_FILE")
  [[ -n "$GCP_PROJECT_ARG" ]] || GCP_PROJECT_ARG="${CLOUDSDK_CORE_PROJECT:-}"
  [[ -n "$GCP_PROJECT_ARG" ]] || GCP_PROJECT_ARG=$(gcloud config get-value project 2>/dev/null || true)
  [[ -n "$GCP_PROJECT_ARG" ]] || die "no Google Cloud project — pass --gcp-project <id>, or run: gcloud config set project <id>"
  local row state
  row=$(gcloud projects describe "$GCP_PROJECT_ARG" --format='value(projectId,lifecycleState)' --quiet --verbosity=error 2>/dev/null | words) ||
    die "couldn't read the Google Cloud project $GCP_PROJECT_ARG (does it exist, and can $ACCOUNT see it?)"
  read -r GCP_PROJECT state <<<"$row"
  [[ -n "$GCP_PROJECT" && "$GCP_PROJECT" != "-" ]] || die "no Google Cloud project named $GCP_PROJECT_ARG"
  [[ "$state" == "ACTIVE" ]] || die "the Google Cloud project $GCP_PROJECT is $state"
  PROJECT_ARGS=(--project "$GCP_PROJECT")
}

my_ip() {
  local ip
  ip=$(curl -4 -fsS --max-time 10 https://checkip.amazonaws.com 2>/dev/null || curl -4 -fsS --max-time 10 https://api.ipify.org) || return 1
  printf '%s' "$ip" | tr -d '[:space:]'
}

to_cidr() {
  local v="$1"
  [[ "$v" == "me" ]] && { v=$(my_ip) || die "couldn't detect your public IP"; }
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
  elif command -v cmd.exe >/dev/null 2>&1; then MSYS2_ARG_CONV_EXCL='*' cmd.exe /c start "" "$url" # Git Bash would make /c C:/
  fi
}

confirm() {
  [[ $YES -eq 1 ]] && return
  local answer
  read -r -p "   Continue? [y/N] " answer
  [[ "$answer" =~ ^[Yy] ]] || die "cancelled"
}

# --- Google Cloud lookups -------------------------------------------------------------------------

# Lists rather than `describe`, so that any other error stops the script instead of reading as
# "there's none": taking one for "missing" would re-create, and so reset, what's there. Names are
# matched whole (~^name$): gcloud's = also matches parts.

# "<zone> <status> <machine type> <label>" for the office's VM, or nothing when it has none.
find_vm() {
  gcc compute instances list --filter="name~^$VM\$" \
    --format='value(zone.basename(),status,machineType.basename(),labels.agent-office)' | words
}
# "<address> <region> <status> <description>" for its static address, or nothing.
find_addr() { gcc compute addresses list --filter="name~^$ADDR\$" --format='value(address,region.basename(),status,description)' | words; }
# The description of its firewall rule / network, or nothing.
find_fw() { gcc compute firewall-rules list --filter="name~^$FW\$" --format='value(name,description)' | words; }
find_net() { gcc compute networks list --filter="name~^$NET\$" --format='value(name,description)' | words; }

# Dies when a resource of the office's name wasn't made by this script, so it never takes over
# (or deletes) someone else's. $1 is what it is, $2 its description.
ours() {
  [[ "$2" == "$MADE_BY"* ]] ||
    die "the $1 $3 in project $GCP_PROJECT wasn't made by deploy/gcp.sh (its description isn't \"$MADE_BY\") — pick another --name"
}

# Sets ZONE, REGION, VM_STATUS and VM_TYPE from the office's VM ('' when there's none yet), after
# making sure this script made it.
load_office() {
  local row label
  ZONE="" REGION="" VM_STATUS="" VM_TYPE=""
  row=$(find_vm) || die "couldn't list the VMs in project $GCP_PROJECT (above)"
  [[ -n "$row" ]] || return 0
  read -r ZONE VM_STATUS VM_TYPE label <<<"$row"
  [[ "$label" == "$NAME" ]] ||
    die "the VM $VM in project $GCP_PROJECT wasn't made by deploy/gcp.sh (it has no agent-office=$NAME label) — pick another --name"
  REGION="${ZONE%-*}"
}

require_office() {
  load_office
  [[ -n "$ZONE" ]] || die "no office named \"$NAME\" in project $GCP_PROJECT — run: deploy/gcp.sh up$NAME_FLAG"
}

default_zone() {
  local z="${CLOUDSDK_COMPUTE_ZONE:-}"
  [[ -n "$z" ]] || z=$(gcloud config get-value compute/zone 2>/dev/null || true)
  echo "${z:-us-central1-a}"
}

# A zone as given (europe-west1-b), or a region's first zone (europe-west1 -> europe-west1-b; not
# every region has an "a").
resolve_zone() {
  local z
  z=$(lower "$1")
  [[ "$z" =~ ^[a-z]+-[a-z]+[0-9]+-[a-z]$ ]] && { echo "$z"; return; }
  [[ "$z" =~ ^[a-z]+-[a-z]+[0-9]+$ ]] || die "not a zone or region: $1 (see: gcloud compute zones list)"
  gcc compute regions describe "$z" --format='value(zones)' 2>/dev/null | tr ';' '\n' | head -1 | sed 's#.*/##' | grep . ||
    die "no region named $z in project $GCP_PROJECT (see: gcloud compute regions list)"
}

vm_status() { gcc compute instances describe "$VM" --zone "$ZONE" --format='value(status)' 2>/dev/null || true; }

# The VM's status once it's done changing (a start or stop in progress). Gives up after 10 minutes,
# or after 30 seconds of Google not saying.
settled_status() {
  local s="" i blank=0
  for ((i = 0; i < 120; i++)); do
    s=$(vm_status)
    case "$s" in
      PROVISIONING | STAGING | STOPPING | SUSPENDING | REPAIRING | PENDING | PENDING_STOP | DEPROVISIONING) ;;
      "")
        blank=$((blank + 1))
        [[ $blank -lt 6 ]] || break
        ;;
      *) break ;;
    esac
    [[ $i -eq 0 ]] && say "Waiting for the VM, which is $(lower "${s:-busy}")" >&2
    sleep 5
  done
  echo "$s"
}

paused_status() { [[ "$1" =~ ^(TERMINATED|STOPPED|SUSPENDED|STOPPING|SUSPENDING|PENDING_STOP)$ ]]; }

# Start a paused VM; a running one is left alone.
start_vm() {
  local s
  s=$(settled_status)
  [[ "$s" == "RUNNING" ]] && return 0
  say "Starting $VM"
  if [[ "$s" == "SUSPENDED" ]]; then gcc compute instances resume "$VM" --zone "$ZONE" >/dev/null
  else gcc compute instances start "$VM" --zone "$ZONE" >/dev/null; fi
}

public_ip() { find_addr | awk '$1 != "-" { print $1 }'; }

# "<arch> <vCPUs> <MiB> <shared cores>" for a machine type in $ZONE, or fails when the zone doesn't
# offer it. Arm types that don't say so are known by name.
type_row() {
  local row arch rest
  row=$(gcc compute machine-types describe "$1" --zone "$ZONE" --format='value(architecture,guestCpus,memoryMb,isSharedCpu)' 2>/dev/null | words) || return 1
  [[ -n "$row" ]] || return 1
  read -r arch rest <<<"$row"
  if [[ "$arch" != "ARM64" && "$arch" != "X86_64" ]]; then
    case "$1" in t2a-* | c4a-* | n4a-*) arch="ARM64" ;; *) arch="X86_64" ;; esac
  fi
  echo "$arch $rest"
}

# Sets TYPE_ARCH, TYPE_CPUS, TYPE_MEM and TYPE_SHARED for the type in $1 (see type_row).
type_info() {
  local row
  [[ "$1" =~ ^[a-z0-9-]+$ ]] || die "not a machine type: $1 (e.g. $DEFAULT_TYPE)"
  say "Checking that $1 is available in $ZONE"
  row=$(type_row "$1") || die "$1 isn't offered in $ZONE. Check the zone's name (gcloud compute zones list), or pick
   another --machine-type or --zone. The types there: gcloud compute machine-types list --zones $ZONE --filter='name~^e2-standard'"
  read -r TYPE_ARCH TYPE_CPUS TYPE_MEM TYPE_SHARED <<<"$row"
}

# What a machine type's boot disk can be: the newest families (C4, C4A, N4, …) only take Hyperdisk.
disk_type_for() {
  case "$1" in
    c4-* | c4a-* | c4d-* | n4-* | n4a-* | x4-* | h3-* | h4d-* | m4-*) echo "hyperdisk-balanced" ;;
    *) echo "pd-balanced" ;;
  esac
}

# Stop -> change type -> start. The disk, the address and everything on the VM stay. If Google
# can't start it as the new type (no room for that type in the zone just then), it goes back to
# the old one. A paused office stays paused, as the new type: then RESIZED_PAUSED is 1.
resize_vm() {
  local have was paused=0 h_arch
  RESIZED_PAUSED=0
  have="$VM_TYPE"
  was=$(settled_status)
  paused_status "$was" && paused=1
  if [[ "$have" == "$1" ]]; then
    ok "Already a $have"
    RESIZED_PAUSED=$paused
    return
  fi
  type_info "$1"
  h_arch=$(type_row "$have" | awk '{ print $1 }') || h_arch=""
  [[ -z "$h_arch" || "$h_arch" == "$TYPE_ARCH" ]] || die "can't switch CPU architecture ($have is $h_arch, $1 is $TYPE_ARCH) — use destroy + up instead"
  [[ "$(disk_type_for "$have")" == "$(disk_type_for "$1")" ]] ||
    die "$1 takes a different kind of boot disk than $have — use destroy + up instead"
  if [[ $paused -eq 1 ]]; then
    say "Resizing the paused $VM from $have to $1. It stays paused."
  else
    say "Resizing $VM from $have to $1. The office goes offline for a minute or two;"
    echo "   running workers stop and come back asleep (press R at their desk to resume)."
  fi
  confirm
  if [[ "$was" != "TERMINATED" ]]; then
    say "Stopping"
    gcc compute instances stop "$VM" --zone "$ZONE" >/dev/null
  fi
  if ! gcc compute instances set-machine-type "$VM" --zone "$ZONE" --machine-type "$1" >/dev/null; then
    warn "Google wouldn't make it a $1 (above)"
    [[ $paused -eq 1 ]] && die "the office is still a $have, and still paused"
    say "Starting it again as a $have"
    gcc compute instances start "$VM" --zone "$ZONE" >/dev/null || true
    die "the office is still a $have"
  fi
  if [[ $paused -eq 1 ]]; then
    RESIZED_PAUSED=1
    ok "Now a $1, and still paused"
    return
  fi
  say "Starting as $1"
  if ! gcc compute instances start "$VM" --zone "$ZONE" >/dev/null; then
    warn "Google couldn't start it as a $1 (above; often there's no room for that type in the zone just then)"
    say "Going back to $have"
    if gcc compute instances set-machine-type "$VM" --zone "$ZONE" --machine-type "$have" >/dev/null &&
      gcc compute instances start "$VM" --zone "$ZONE" >/dev/null; then
      die "the office is back up as a $have. Try $1 again later, or another type"
    fi
    die "…and that failed too (above). Try again with: deploy/gcp.sh resize $have$NAME_FLAG"
  fi
  ok "Now a $1"
}

# Commands that SSH in need the key `up` made. Checked first, since a failed ssh can be silenced.
require_key() {
  [[ -f "$KEY_FILE" ]] || die "the SSH key for office \"$NAME\" isn't on this computer ($KEY_FILE).
   Let this computer in with: deploy/gcp.sh connect$NAME_FLAG (or copy that folder over from the one that made the office)"
}

require_vm() {
  require_key
  require_office
  paused_status "$VM_STATUS" && die "the office is paused — start it with: deploy/gcp.sh resume$NAME_FLAG"
  IP=$(public_ip)
  [[ -n "$IP" ]] || die "the office has no static address ($ADDR) — run: deploy/gcp.sh up$NAME_FLAG"
}

SSH_OPTS=(-i "$KEY_FILE" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KNOWN_HOSTS"
  -o ConnectTimeout=8 -o ServerAliveInterval=15 -o LogLevel=ERROR)

remote() {
  require_key
  # shellcheck disable=SC2029 # the command is meant to expand here, then run there
  ssh "${SSH_OPTS[@]}" "$SSH_USER@$IP" "$@"
}

# The addresses allowed to reach SSH, one per line (none when the rule isn't there). Any other
# error stops the script: taken for an empty list, it would make the next change drop everyone
# else's address.
allowed_cidrs() {
  local out
  out=$(gcc compute firewall-rules list --filter="name~^$FW\$" --flatten='sourceRanges[]' --format='value(sourceRanges)') ||
    die "couldn't read the firewall rule $FW (above)"
  printf '%s\n' "$out" | sed '/^$/d'
}

# Makes the office's one firewall rule SSH (22) from exactly these addresses, on the VMs with its
# tag. Only SSH is ever opened; the office itself is reached through the tunnel. With no addresses
# the rule goes away, and SSH is closed to everyone (a rule with no source would mean everyone).
set_ssh_sources() {
  local have
  have=$(find_fw | awk '{ print $1 }') || die "couldn't list the firewall rules (above)"
  if [[ $# -eq 0 ]]; then
    [[ -z "$have" ]] || gcc compute firewall-rules delete "$FW" >/dev/null
  elif [[ -n "$have" ]]; then
    gcc compute firewall-rules update "$FW" --source-ranges "$(IFS=,; echo "$*")" >/dev/null
  else
    gcc compute firewall-rules create "$FW" --network "$NET" --direction INGRESS --action ALLOW --rules tcp:22 \
      --priority 1000 --source-ranges "$(IFS=,; echo "$*")" --target-tags "$TAG" \
      --description "$MADE_BY: SSH from allowed IPs only" >/dev/null
  fi
}

# Is this CIDR in the list (one per line)? 203.0.113.7 and 203.0.113.7/32 are the same.
has_cidr() { printf '%s\n' "$1" | awk -v c="${2%/32}" '{ sub(/\/32$/, "") } $0 == c { found = 1 } END { exit !found }'; }

# Adds the given CIDRs to (with - first: takes them off) the addresses that may SSH in.
change_ssh_sources() {
  local remove=0 have want c list=()
  [[ "${1:-}" == "-" ]] && { remove=1; shift; }
  have=$(allowed_cidrs)
  want="$have"
  for c in "$@"; do
    if [[ $remove -eq 1 ]]; then
      want=$(printf '%s\n' "$want" | awk -v c="${c%/32}" '{ x = $0; sub(/\/32$/, "", x) } x != c')
    elif ! has_cidr "$want" "$c"; then
      want=$(printf '%s\n%s' "$want" "$c")
    fi
  done
  [[ "$want" == "$have" ]] && return 0
  while IFS= read -r c; do
    if [[ -n "$c" ]]; then list+=("$c"); fi
  done <<<"$want"
  set_ssh_sources "${list[@]+"${list[@]}"}"
}

office_get() { remote "curl -fs --max-time 4 http://127.0.0.1:$OFFICE_PORT$1"; }

ip_int() {
  local IFS=.
  # shellcheck disable=SC2086 # split on the dots
  set -- $1
  echo $((($1 << 24) | ($2 << 16) | ($3 << 8) | $4))
}

# Whether IPv4 address $1 is in one of the CIDRs on stdin.
ip_allowed() {
  local ip c n bits mask
  ip=$(ip_int "$1")
  while IFS= read -r c; do
    [[ "$c" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]] || continue
    n=$(ip_int "${c%/*}")
    bits=${c#*/}
    mask=$((bits == 0 ? 0 : (0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF))
    if (((ip & mask) == (n & mask))); then return 0; fi
  done
  return 1
}

# SSH that won't connect: stop and say so when this computer's IP isn't one the firewall lets in.
ssh_blocked_hint() {
  local my list
  my=$(my_ip 2>/dev/null) || return 0
  [[ "$my" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 0
  list=$(allowed_cidrs 2>/dev/null) || return 0
  printf '%s\n' "$list" | ip_allowed "$my" && return 0
  die "SSH only answers the IPs you allowed, and this computer's ($my) isn't one of them. Let it in with: deploy/gcp.sh allow me$NAME_FLAG"
}

# Waits for SSH on a VM that's (re)starting.
wait_for_ssh() {
  local i
  say "Waiting for SSH"
  for ((i = 0; i < 60; i++)); do
    remote true 2>/dev/null && return 0
    [[ $i -eq 5 ]] && ssh_blocked_hint
    sleep 5
  done
  remote true || die "SSH never came up on $IP. If it says \"Permission denied (publickey)\", your organization may
   require OS Login (constraints/compute.requireOsLogin), which puts your keys where deploy/gcp.sh doesn't look.
   Check with: gcloud resource-manager org-policies describe compute.requireOsLogin --project $GCP_PROJECT --effective"
}

wait_healthy() {
  local i rc
  for ((i = 0; i < 30; i++)); do
    rc=0
    remote "for i in \$(seq 90); do curl -fs --max-time 4 http://127.0.0.1:$OFFICE_PORT/api/health >/dev/null && exit 0; sleep 2; done; exit 1" \
      2>/dev/null || rc=$?
    [[ $rc -eq 255 ]] || return "$rc" # 255: ssh itself failed, the VM is still booting…
    [[ $i -eq 0 ]] && ssh_blocked_hint # …or this computer's IP isn't allowed in
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

# Forward localhost:<port> to the office on the VM, open the browser, and hold until Ctrl-C.
tunnel() {
  local path="$1" port pid i up=0
  port=$(pick_port) || exit 1
  ssh "${SSH_OPTS[@]}" -N -o ExitOnForwardFailure=yes -L "$port:127.0.0.1:$OFFICE_PORT" "$SSH_USER@$IP" &
  pid=$!
  trap 'kill "$pid" 2>/dev/null; echo; ok "Tunnel closed"; exit 0' INT TERM
  for ((i = 0; i < 40; i++)); do
    kill -0 "$pid" 2>/dev/null || die "couldn't open the SSH tunnel to $IP"
    curl -fs --max-time 2 "http://localhost:$port/api/health" >/dev/null 2>&1 && { up=1; break; }
    sleep 0.5
  done
  if [[ $up -ne 1 ]]; then
    kill "$pid" 2>/dev/null
    die "the tunnel opened but the office didn't answer through it — check: deploy/gcp.sh logs$NAME_FLAG"
  fi
  ok "Your office: http://localhost:$port$path"
  echo "   (tunneled over SSH to $IP — keep this running while you use it; Ctrl-C closes it)"
  echo "   Workers' web servers open on this computer too, by themselves, with (in another terminal): agent-office tunnel http://localhost:$port"
  open_url "http://localhost:$port$path"
  wait "$pid" || true
  trap - INT TERM
  warn "The tunnel dropped — reopen it with: deploy/gcp.sh open$NAME_FLAG"
}

# A worker's server from the 🌐 Services board: localhost:<port> tunnels to the office, which
# relays it by that port (see src/server/relay.ts), so the local port must match the service's.
service_tunnel() {
  local port="$1" pid i up=0
  port_busy "$port" && die "localhost:$port is already in use on this computer — stop whatever runs there first"
  ssh "${SSH_OPTS[@]}" -N -o ExitOnForwardFailure=yes -L "$port:127.0.0.1:$OFFICE_PORT" "$SSH_USER@$IP" &
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
  warn "The tunnel dropped — reopen it with: deploy/gcp.sh service $port$NAME_FLAG"
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

# Teammates' keys are managed on the VM by agent-office-team (installed by provision.sh).
require_team() {
  remote "test -x /usr/local/bin/agent-office-team" 2>/dev/null || die "this office predates team access — run: deploy/gcp.sh up$NAME_FLAG"
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

# The Compute Engine API, on. Checked first: turning it on needs a permission that reading doesn't.
ensure_compute_api() {
  local on
  on=$(gcc services list --enabled --filter='config.name=compute.googleapis.com' --format='value(config.name)' 2>/dev/null || true)
  [[ -n "$on" ]] && return 0
  say "Turning the Compute Engine API on in $GCP_PROJECT — about a minute"
  gcc services enable compute.googleapis.com ||
    die "couldn't turn the Compute Engine API on (above). If it says billing, link a billing account to the project:
   gcloud billing projects link $GCP_PROJECT --billing-account <id>     (the ids: gcloud billing accounts list)"
}

# The organization policies that would make this deployment impossible, caught before anything
# is made. Skipped when this account can't read them.
check_org_policies() {
  local v
  v=$(gcc resource-manager org-policies describe compute.requireOsLogin --effective --format='value(booleanPolicy.enforced)' 2>/dev/null || true)
  [[ "$v" == "True" ]] &&
    die "project $GCP_PROJECT requires OS Login (the organization policy constraints/compute.requireOsLogin), which puts
   SSH keys where deploy/gcp.sh doesn't — use a project without it, or ask whoever runs your organization"
  v=$(gcc resource-manager org-policies describe compute.vmExternalIpAccess --effective --format='value(listPolicy.allValues)' 2>/dev/null || true)
  [[ "$v" == "DENY" ]] &&
    die "project $GCP_PROJECT forbids VMs with a public address (the organization policy constraints/compute.vmExternalIpAccess),
   and the office is reached through SSH to one — use a project without it"
  return 0
}

# Puts this computer's public key in the VM's ssh-keys metadata, keeping the keys already there
# (add-metadata replaces the whole value). The VM's guest agent then puts it on the ubuntu user.
add_key() {
  local have
  say "Adding this computer's SSH key to the VM"
  have=$(gcc compute instances describe "$VM" --zone "$ZONE" --flatten='metadata.items[]' --filter='metadata.items.key=ssh-keys' \
    --format='value(metadata.items.value)') || die "couldn't read the VM's SSH keys (above)"
  {
    [[ -z "$have" ]] || printf '%s\n' "$have"
    printf '%s:%s\n' "$SSH_USER" "$(cut -d' ' -f1,2 "$KEY_FILE.pub") $RESOURCE"
  } | awk 'NF && !seen[$0]++' >"$KEYS_FILE"
  gcc compute instances add-metadata "$VM" --zone "$ZONE" --metadata-from-file "ssh-keys=$KEYS_FILE" >/dev/null ||
    die "couldn't add the SSH key ($KEY_FILE.pub) to the VM (above)"
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

  local my a c
  my=$(my_ip) || die "couldn't detect your public IP"
  local cidrs=("$my/32")
  for a in "${EXTRA_ALLOW[@]+"${EXTRA_ALLOW[@]}"}"; do
    c=$(to_cidr "$a")
    cidrs+=("$c")
  done

  ensure_compute_api

  # Where: a new office goes in --zone; an existing one stays in its VM's zone.
  load_office
  local new_vm=0 machine resize=0
  if [[ -z "$ZONE" ]]; then
    new_vm=1
    check_org_policies
    ZONE=$(resolve_zone "${ZONE_ARG:-$(default_zone)}")
    REGION="${ZONE%-*}"
    [[ "$(gcc compute zones describe "$ZONE" --format='value(status)' 2>/dev/null || true)" == "UP" ]] ||
      die "not a zone in project $GCP_PROJECT: $ZONE (see: gcloud compute zones list)"
    type_info "$TYPE"
    [[ "$TYPE_SHARED" == "True" ]] && warn "$TYPE shares its cores with other VMs; workers will be slow. e2-standard-4 doesn't."
    machine="$TYPE, ${DISK_GB} GiB disk, Ubuntu 24.04"
  else
    [[ -z "$ZONE_ARG" || "$(resolve_zone "$ZONE_ARG")" == "$ZONE" ]] ||
      die "office \"$NAME\" is in $ZONE. To move it, destroy it first (or pick another --name)"
    machine="the existing VM ($VM_TYPE)"
    if [[ $TYPE_SET -eq 1 && "$VM_TYPE" != "$TYPE" ]]; then
      resize=1
      machine="the existing VM, resized from $VM_TYPE to $TYPE"
    fi
  fi

  say "Agent Office \"$NAME\" in $ZONE (project $GCP_PROJECT)"
  echo "   machine:  $machine"
  echo "   app:      $APP_REPO @ $APP_REF"
  echo "   projects: ${project_repo:+$project_repo, then }pick them in the office's elevator (cloned into ~/workspace)"
  echo "   access:   SSH tunnel only (the office is never exposed); SSH from ${cidrs[*]}"
  if [[ -n "$gh_token" ]]; then
    echo "   github:   your GitHub token goes on the VM (private clones, issue/PR boards, pushes)"
  else
    echo "   github:   no token — private repos and the boards won't work"
  fi
  if [[ -n "$CLAUDE_TOKEN" || -n "$ANTHROPIC_KEY" ]]; then
    echo "   claude:   signed in with the token you provided"
  else
    echo "   claude:   not signed in — log in from the first worker's terminal (or pass --claude-token)"
  fi

  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  echo "$GCP_PROJECT" >"$PROJECT_FILE"
  local new_key=0
  if [[ ! -f "$KEY_FILE" ]]; then
    ssh-keygen -q -t ed25519 -N '' -C "$RESOURCE" -f "$KEY_FILE"
    new_key=1
  fi

  # A network of the office's own. The default network lets SSH in from everywhere, on every VM in
  # it, and some organizations' projects don't have one at all.
  local row desc
  row=$(find_net) || die "couldn't list the networks in project $GCP_PROJECT (above)"
  if [[ -z "$row" ]]; then
    gcc compute networks create "$NET" --subnet-mode=auto --description "$MADE_BY" >/dev/null
    ok "Network $NET"
  else
    read -r _ desc <<<"$row"
    ours network "$desc" "$NET"
  fi

  # Firewall rule: only the allowed IPs can reach 22 (ssh), on the VMs with the office's tag.
  # Nothing else is open.
  row=$(find_fw) || die "couldn't list the firewall rules in project $GCP_PROJECT (above)"
  if [[ -n "$row" ]]; then
    read -r _ desc <<<"$row"
    ours "firewall rule" "$desc" "$FW"
  fi
  change_ssh_sources "${cidrs[@]}"
  ok "SSH allowed from ${cidrs[*]}"

  # A fixed address, so the office's address survives pauses and resizes.
  local addr_region
  row=$(find_addr) || die "couldn't list the addresses in project $GCP_PROJECT (above)"
  if [[ -z "$row" ]]; then
    gcc compute addresses create "$ADDR" --region "$REGION" --network-tier PREMIUM --description "$MADE_BY" >/dev/null
    row=$(find_addr)
  fi
  read -r IP addr_region _ desc <<<"$row"
  ours address "$desc" "$ADDR"
  [[ "$addr_region" == "$REGION" ]] || die "the office's address $ADDR is in $addr_region, not $REGION. Destroy the office first (or pick another --name)"
  [[ -n "$IP" && "$IP" != "-" ]] || die "the address $ADDR has no IP"
  ok "Static IP $IP"

  # The VM.
  if [[ $new_vm -eq 1 ]]; then
    local image="ubuntu-2404-lts-amd64" shielded=(--shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring)
    [[ "$TYPE_ARCH" == "ARM64" ]] && image="ubuntu-2404-lts-arm64"
    case "$TYPE" in t2a-*) shielded=() ;; esac # Tau T2A VMs can't be Shielded VMs
    printf '%s:%s\n' "$SSH_USER" "$(cut -d' ' -f1,2 "$KEY_FILE.pub") $RESOURCE" >"$KEYS_FILE"
    say "Creating the VM ($TYPE) — a minute or two"
    # No service account: the office needs no Google API, and it keeps a cloud credential off a
    # machine that runs agents. OS Login off, project-wide keys blocked: only this key gets in.
    gcc compute instances create "$VM" --zone "$ZONE" --machine-type "$TYPE" \
      --image-family "$image" --image-project ubuntu-os-cloud \
      --boot-disk-size "${DISK_GB}GB" --boot-disk-type "$(disk_type_for "$TYPE")" --boot-disk-auto-delete \
      "${shielded[@]+"${shielded[@]}"}" \
      --network "$NET" --address "$IP" --network-tier PREMIUM --stack-type IPV4_ONLY \
      --tags "$TAG" --labels "agent-office=$NAME" --description "$MADE_BY" \
      --metadata enable-oslogin=FALSE,block-project-ssh-keys=TRUE --metadata-from-file "ssh-keys=$KEYS_FILE" \
      --no-service-account --no-scopes >/dev/null ||
      die "couldn't create the VM (Google's reason is above). If it's a quota (\"Quota 'CPUS' exceeded\"), ask for more
   in the console under IAM & Admin → Quotas, for $REGION, or run up again with a smaller --machine-type. If it names
   constraints/compute.vmExternalIpAccess, your organization forbids public addresses in this project."
    VM_TYPE="$TYPE"
  elif [[ $resize -eq 1 ]]; then
    resize_vm "$TYPE"
    if [[ $RESIZED_PAUSED -eq 1 ]]; then start_vm; fi
  elif [[ "$(settled_status)" != "RUNNING" ]]; then
    start_vm
  else
    say "Reusing $VM ($VM_TYPE)"
  fi
  ok "VM $VM is running at $IP"

  # An office made on another computer (or whose key was lost): give this computer's key to it too.
  if [[ $new_key -eq 1 && $new_vm -eq 0 ]]; then add_key; fi
  wait_for_ssh

  [[ -f "$CLAIM_FILE" ]] || (umask 077 && random_token >"$CLAIM_FILE")

  say "Provisioning (Node, git, gh, Claude Code, agent-office) — a few minutes on first run"
  local git_name git_email
  git_name=$(git config user.name 2>/dev/null || true)
  git_email=$(git config user.email 2>/dev/null || true)
  {
    printf 'export APP_REPO=%q APP_REF=%q PROJECT_REPO=%q\n' "$APP_REPO" "$APP_REF" "$project_repo"
    printf 'export CLAIM_TOKEN=%q PUBLIC_HOST=%q GH_TOKEN=%q CLAUDE_CODE_OAUTH_TOKEN=%q ANTHROPIC_API_KEY=%q\n' "$(cat "$CLAIM_FILE")" "$IP" "$gh_token" "$CLAUDE_TOKEN" "$ANTHROPIC_KEY"
    # How the office names this script in the commands it suggests (with --name for a second office).
    printf 'export GIT_NAME=%q GIT_EMAIL=%q DEPLOY_SCRIPT=%q\n' "$git_name" "$git_email" "deploy/gcp.sh$NAME_FLAG"
    cat "$SCRIPT_DIR/provision.sh"
  } | remote 'bash -s' || die "provisioning failed (re-run \"deploy/gcp.sh up$NAME_FLAG\" to retry; it picks up where it left off)"

  say "Waiting for the office to answer"
  wait_healthy || die "the office didn't come up — check: deploy/gcp.sh logs$NAME_FLAG"
  ok "Your office is running on $IP (reachable only through SSH)"
  echo
  echo "   Open it later:     deploy/gcp.sh open$NAME_FLAG"
  echo "   Add a teammate:    the 👥 Invite button in the office, or deploy/gcp.sh invite <their-github-username>$NAME_FLAG"
  echo "   Pause / resume:    deploy/gcp.sh pause$NAME_FLAG   /   deploy/gcp.sh resume$NAME_FLAG"
  echo "   Tear it down:      deploy/gcp.sh destroy$NAME_FLAG"
  echo
  [[ $NO_OPEN -eq 1 ]] && return
  open_office
}

# An office made on another computer: this one gets a key on the VM and its IP in the firewall.
# Unlike up, it doesn't provision, so the office keeps its GitHub and Claude sign-ins.
cmd_connect() {
  preflight
  need ssh-keygen
  require_office
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  echo "$GCP_PROJECT" >"$PROJECT_FILE"
  local my
  my=$(my_ip) || die "couldn't detect your public IP"
  change_ssh_sources "$my/32"
  ok "SSH allowed from $my/32"
  start_vm # the guest agent that adds the key only runs on a running VM
  IP=$(public_ip)
  [[ -n "$IP" ]] || die "the office has no static address ($ADDR) — run: deploy/gcp.sh up$NAME_FLAG"
  if [[ -f "$KEY_FILE" ]] && remote true 2>/dev/null; then
    ok "This computer could already SSH in"
  else
    [[ -f "$KEY_FILE" ]] || ssh-keygen -q -t ed25519 -N '' -C "$RESOURCE" -f "$KEY_FILE"
    add_key
    wait_for_ssh
  fi
  ok "Connected to office \"$NAME\" at $IP — open it with: deploy/gcp.sh open$NAME_FLAG"
}

cmd_open() {
  preflight
  require_vm
  wait_healthy || die "the office isn't answering — check: deploy/gcp.sh logs$NAME_FLAG"
  open_office
}

cmd_service() {
  preflight
  [[ ${#POSITIONAL[@]} -eq 1 && "${POSITIONAL[0]}" =~ ^[0-9]+$ && ${POSITIONAL[0]} -gt 0 && ${POSITIONAL[0]} -lt 65536 ]] ||
    die "usage: deploy/gcp.sh service <port>   (a port from the office's 🌐 Services board)"
  [[ "${POSITIONAL[0]}" -ne $OFFICE_PORT ]] || die "$OFFICE_PORT is the office itself — use: deploy/gcp.sh open"
  require_vm
  service_tunnel "${POSITIONAL[0]}"
}

cmd_status() {
  preflight
  load_office
  if [[ -z "$ZONE" ]]; then
    echo "No office named \"$NAME\" in project $GCP_PROJECT."
    return
  fi
  IP=$(public_ip)
  echo "office:    $NAME ($ZONE, project $GCP_PROJECT)"
  echo "vm:        $VM $VM_TYPE $(lower "$VM_STATUS")"
  echo "address:   ${IP:-none}  (open the office with: deploy/gcp.sh open$NAME_FLAG)"
  if paused_status "$VM_STATUS"; then
    echo "office:    paused (start it with: deploy/gcp.sh resume$NAME_FLAG)"
  elif [[ -n "$IP" && -f "$KEY_FILE" ]] && office_get /api/health >/dev/null 2>&1; then
    echo "office:    up"
    local team
    team=$(team_members 2>/dev/null | awk '{printf "%s%s", sep, $1; sep=", "}') || team="(couldn't list it)"
    echo "team:      ${team:-nobody invited yet}"
  else
    echo "office:    not answering"
  fi
  local from
  from=$(allowed_cidrs 2>/dev/null | tr '\n' ' ') || from="(couldn't read the firewall)"
  echo "ssh from:  ${from:-nobody}"
}

cmd_allow() {
  preflight
  [[ ${#POSITIONAL[@]} -gt 0 ]] || die "usage: deploy/gcp.sh allow <ip|cidr|me> [...]"
  require_office
  local c cidrs=()
  for c in "${POSITIONAL[@]}"; do
    c=$(to_cidr "$c")
    cidrs+=("$c")
  done
  change_ssh_sources "${cidrs[@]}"
  for c in "${cidrs[@]}"; do ok "Allowed $c"; done
}

cmd_revoke() {
  preflight
  [[ ${#POSITIONAL[@]} -gt 0 ]] || die "usage: deploy/gcp.sh revoke <ip|cidr|me> [...]"
  require_office
  local c cidrs=()
  for c in "${POSITIONAL[@]}"; do
    c=$(to_cidr "$c")
    cidrs+=("$c")
  done
  change_ssh_sources - "${cidrs[@]}"
  for c in "${cidrs[@]}"; do ok "Revoked $c"; done
  [[ -n "$(allowed_cidrs)" ]] || warn "No IP may SSH in now, you included. Let yours back in with: deploy/gcp.sh allow me$NAME_FLAG"
}

cmd_invite() {
  preflight
  [[ ${#POSITIONAL[@]} -ge 1 && ${#POSITIONAL[@]} -le 2 ]] ||
    die "usage: deploy/gcp.sh invite <github-username>   or   deploy/gcp.sh invite <name> <public-key-file>"
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
  require_vm
  require_team
  local n
  # The VM keeps only valid keys and restricts each one to opening the tunnel.
  n=$(printf '%s\n' "$raw" | remote "agent-office-team add $who") || die "couldn't add $who's keys from $src"
  ok "$who is invited ($n key(s) from $src)"

  local a cidrs=() fp
  for a in "${EXTRA_ALLOW[@]+"${EXTRA_ALLOW[@]}"}"; do
    a=$(to_cidr "$a")
    cidrs+=("$a")
  done
  if [[ ${#cidrs[@]} -gt 0 ]]; then
    change_ssh_sources "${cidrs[@]}"
    ok "SSH allowed from ${cidrs[*]}"
  fi
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
  if ! has_cidr "$(allowed_cidrs)" "0.0.0.0/0"; then
    echo "   SSH only answers allowed IPs, so also run: deploy/gcp.sh allow <their-ip>$NAME_FLAG"
    echo "   (or \"allow anywhere\" — SSH only accepts your key and invited keys)"
  fi
}

cmd_uninvite() {
  preflight
  [[ ${#POSITIONAL[@]} -eq 1 ]] || die "usage: deploy/gcp.sh uninvite <name>"
  local who="${POSITIONAL[0]}" out rc=0
  valid_member "$who"
  require_vm
  require_team
  out=$(remote "agent-office-team remove $who" 2>&1) || rc=$?
  [[ $rc -eq 66 ]] && die "$who isn't invited (see: deploy/gcp.sh team$NAME_FLAG)"
  [[ $rc -eq 0 ]] || die "couldn't remove the keys: $out"
  ok "$who's keys are removed and open tunnels were dropped (other teammates just reconnect)"
  echo "   They still know the office password. To change it: deploy/gcp.sh reset-password$NAME_FLAG"
}

cmd_team() {
  preflight
  require_vm
  require_team
  local list
  list=$(team_members)
  if [[ -z "$list" ]]; then
    echo "Nobody is invited yet. Add someone: deploy/gcp.sh invite <github-username>$NAME_FLAG"
    return
  fi
  echo "$list" | awk '{printf "%s  (%d key%s)\n", $1, $2, ($2 == 1 ? "" : "s")}'
}

cmd_ssh() {
  preflight
  require_vm
  exec ssh "${SSH_OPTS[@]}" -t "$SSH_USER@$IP" "${POSITIONAL[@]+"${POSITIONAL[@]}"}"
}

cmd_logs() {
  preflight
  require_vm
  exec ssh "${SSH_OPTS[@]}" -t "$SSH_USER@$IP" 'sudo journalctl -u agent-office -n 100 -f'
}

cmd_resize() {
  preflight
  [[ ${#POSITIONAL[@]} -eq 1 ]] || die "usage: deploy/gcp.sh resize <machine-type>   (e.g. e2-standard-8, n2-standard-4)"
  require_key
  require_office
  resize_vm "$(lower "${POSITIONAL[0]}")"
  if [[ $RESIZED_PAUSED -eq 1 ]]; then
    echo "   Start it with: deploy/gcp.sh resume$NAME_FLAG"
    return
  fi
  IP=$(public_ip)
  say "Waiting for the office to answer"
  wait_healthy || die "the office didn't come back — check: deploy/gcp.sh logs$NAME_FLAG"
  ok "Your office is back — open it with: deploy/gcp.sh open$NAME_FLAG"
}

cmd_pause() {
  preflight
  require_office
  local state
  state=$(settled_status)
  if [[ "$state" != "TERMINATED" ]]; then
    say "Pausing office \"$NAME\" ($VM). Running workers stop and come back asleep"
    echo "   when you resume (press R at their desk). Open tunnels, teammates' too, are dropped."
    confirm
    say "Stopping"
    gcc compute instances stop "$VM" --zone "$ZONE" >/dev/null
  fi
  ok "Paused. The disk and the address stay (and are all that's billed until you resume)"
  echo "   Start it again with: deploy/gcp.sh resume$NAME_FLAG"
}

cmd_resume() {
  preflight
  require_key
  require_office
  start_vm
  IP=$(public_ip)
  [[ -n "$IP" ]] || die "the office has no static address ($ADDR) — run: deploy/gcp.sh up$NAME_FLAG"
  say "Waiting for the office to answer"
  wait_healthy || die "the office didn't come back — check: deploy/gcp.sh logs$NAME_FLAG"
  ok "Your office is back (workers pick up where they left off)"
  [[ $NO_OPEN -eq 1 ]] && return
  open_office
}

cmd_update() {
  preflight
  require_vm
  say "Updating agent-office on $IP"
  remote "set -e
    ref=\$(git -C /opt/agent-office rev-parse --abbrev-ref HEAD)
    git -C /opt/agent-office fetch --depth 1 origin \"\$ref\" -q
    git -C /opt/agent-office reset --hard FETCH_HEAD -q
    echo \"   at \$(git -C /opt/agent-office log -1 --format='%h %s')\"
    cd /opt/agent-office && npm install --no-audit --no-fund --loglevel=error >/dev/null
    sudo systemctl restart agent-office" || die "update failed"
  wait_healthy || die "the office didn't come back — check: deploy/gcp.sh logs$NAME_FLAG"
  ok "Updated and restarted (workers carry on through it)"
}

cmd_reset_password() {
  preflight
  require_vm
  (umask 077 && random_token >"$CLAIM_FILE")
  say "Resetting the office password"
  remote "set -e
    sudo sed -i 's/^AGENT_OFFICE_CLAIM_TOKEN=.*/AGENT_OFFICE_CLAIM_TOKEN=\"$(cat "$CLAIM_FILE")\"/' /etc/agent-office/env
    sudo systemctl stop agent-office
    node /opt/agent-office/bin/agent-office.js --home \"\$(cat /etc/agent-office/home)\" --reset-password >/dev/null
    sudo systemctl start agent-office" || die "reset failed"
  wait_healthy || die "the office didn't come back — check: deploy/gcp.sh logs$NAME_FLAG"
  ok "Everyone has been signed out"
  open_office
}

# Drops this computer's files for the office (SSH key, claim link), unless they're for an office of
# the same name in another project.
forget_office() {
  if [[ -s "$PROJECT_FILE" && "$(cat "$PROJECT_FILE")" != "$GCP_PROJECT" ]]; then
    echo "(This computer's files for \"$NAME\", in $STATE_DIR, are for project $(cat "$PROJECT_FILE"), so they stay.)"
    return
  fi
  rm -rf "$STATE_DIR"
}

cmd_down() {
  preflight
  load_office
  local addr_row fw_row net_row disk_zone="" addr_region="" desc
  addr_row=$(find_addr) || die "couldn't list the addresses (above)"
  fw_row=$(find_fw) || die "couldn't list the firewall rules (above)"
  net_row=$(find_net) || die "couldn't list the networks (above)"
  # A boot disk left behind (the VM deleted some other way, without it).
  disk_zone=$(gcc compute disks list --filter="name~^$RESOURCE\$" --format='value(zone.basename())' 2>/dev/null | head -1 || true)
  if [[ -n "$addr_row" ]]; then
    read -r _ addr_region _ desc <<<"$addr_row"
    ours address "$desc" "$ADDR"
  fi
  if [[ -n "$fw_row" ]]; then
    read -r _ desc <<<"$fw_row"
    ours "firewall rule" "$desc" "$FW"
  fi
  if [[ -n "$net_row" ]]; then
    read -r _ desc <<<"$net_row"
    ours network "$desc" "$NET"
  fi
  if [[ -z "$ZONE" && -z "$addr_row" && -z "$fw_row" && -z "$net_row" && -z "$disk_zone" ]]; then
    echo "Nothing to delete for \"$NAME\" in project $GCP_PROJECT."
    forget_office
    return
  fi
  say "This permanently deletes office \"$NAME\" in project $GCP_PROJECT:"
  [[ -z "$ZONE" ]] || echo "     $VM  VM in $ZONE, with its disk"
  [[ -z "$disk_zone" || -n "$ZONE" ]] || echo "     $RESOURCE  disk in $disk_zone"
  [[ -z "$addr_row" ]] || echo "     $ADDR  static address in $addr_region"
  [[ -z "$fw_row" ]] || echo "     $FW  firewall rule"
  [[ -z "$net_row" ]] || echo "     $NET  network"
  echo "   Anything on the VM that isn't pushed to GitHub is lost."
  if [[ $YES -ne 1 ]]; then
    local answer
    read -r -p "   Type the office name ($NAME) to confirm: " answer
    [[ "$answer" == "$NAME" ]] || die "cancelled"
  fi
  if [[ -n "$ZONE" ]]; then
    say "Deleting the VM — a minute or two"
    gcc compute instances delete "$VM" --zone "$ZONE" --delete-disks boot >/dev/null || die "couldn't delete the VM (above) — run destroy again in a minute"
    ok "VM deleted (its disk goes with it)"
  elif [[ -n "$disk_zone" ]]; then
    gcc compute disks delete "$RESOURCE" --zone "$disk_zone" >/dev/null || die "couldn't delete the disk (above)"
    ok "Disk deleted"
  fi
  if [[ -n "$addr_row" ]]; then
    gcc compute addresses delete "$ADDR" --region "$addr_region" >/dev/null || die "couldn't release the address (above) — run destroy again in a minute"
    ok "Static address released"
  fi
  if [[ -n "$fw_row" ]]; then
    gcc compute firewall-rules delete "$FW" >/dev/null || die "couldn't delete the firewall rule (above)"
    ok "Firewall rule deleted"
  fi
  if [[ -n "$net_row" ]]; then
    gcc compute networks delete "$NET" >/dev/null || die "couldn't delete the network (above) — run destroy again in a minute"
    ok "Network deleted"
  fi
  forget_office
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
  connect) cmd_connect ;;
  help | -h | --help) usage ;;
  *) die "unknown command \"$CMD\" (see: deploy/gcp.sh help)" ;;
esac
