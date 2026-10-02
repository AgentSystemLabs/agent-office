#!/usr/bin/env bash
# Deploy your own Agent Office to Azure with one command, using only the Azure CLI.
#
#   deploy/azure.sh up        create the VM, install and start the office, open it
#   deploy/azure.sh open      tunnel to the office and open it in your browser
#   deploy/azure.sh pause     deallocate the VM to save money (asks first)
#   deploy/azure.sh resume    start it again
#   deploy/azure.sh destroy   delete everything it created (asks first)
#
# Everything goes in one resource group of its own (agent-office, or agent-office-<name>), so
# destroy is a single `az group delete`. The office is never exposed to the internet: it listens on
# the VM's loopback and everyone reaches it through an SSH tunnel. Run `deploy/azure.sh help` for all
# commands and options. It's deploy/aws.sh for Azure: same commands, same deploy/provision.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="agent-office"
# 4 vCPU and 16 GiB, like the t3.xlarge deploy/aws.sh uses, at about its price. Not the burstable
# B4s_v2: a t3 on AWS bursts without limit by default, while a B-series VM that runs out of CPU
# credits (under an hour of busy workers) slows to 40%.
DEFAULT_SIZE="Standard_D4as_v5"
SIZE="$DEFAULT_SIZE"
SIZE_SET=0
DISK_GB=64 # Premium SSD is billed by tier, and anything from 33 to 64 GiB is the same P6 tier
LOCATION_ARG=""
SUBSCRIPTION_ARG=""
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
SSH_USER="azureuser"
TEAM_USER="office"   # teammates' keys log in as this user, which can only tunnel to the office
OFFICE_PORT=4600     # where the office listens on the VM (127.0.0.1 only)
LOCAL_PORT=4600
LOCAL_PORT_SET=0
SSH_RULE="agent-office-ssh" # the network security group's one inbound rule

usage() {
  cat <<'EOF'
Agent Office on Azure — one command up, one command down.

Usage: deploy/azure.sh <command> [options]

The office is never on the internet. It listens on the VM's loopback, the firewall only opens
SSH, and everyone reaches the office through an SSH tunnel on http://localhost:4600.

Commands
  up                 Create (or reuse) your office on an Azure VM, install and start it, and open
                     it in your browser. The first page shows the office password ONCE — write it down.
  open               Tunnel to your office and open it in the browser (Ctrl-C closes the tunnel)
  pause              Deallocate the VM to save money (asks first). The disk, the address and
                     everything on it stay; only the disk and the address are billed while paused
  resume             Start a paused office again and open it in the browser
  destroy            Delete the office's resource group and everything in it (asks you to type
                     the office name first). `down` does the same.
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
  resize <size>      Change the VM size, e.g. Standard_D8as_v5 (stops it for a few minutes; the
                     address stays the same). `up --size <size>` does this too.
  update             Install the latest agent-office on the VM and restart it
  reset-password     Forget the password and show a new one once in your browser

Options
  --name <name>             Deployment name, lets you run several offices (default: agent-office).
                            Each goes in a resource group of its own: agent-office-<name>
  --location <region>       Azure region for a new office, e.g. westeurope (default: your az CLI's
                            default location, else eastus). An office stays in the region it was
                            created in. --region works too
  --subscription <id|name>  Azure subscription (default: the az CLI's current one)
  --size <vm-size>          VM size (default: Standard_D4as_v5 — 4 vCPU, 16 GiB). --instance-type
                            works too
  --disk <GiB>              OS disk size, Premium SSD (default: 64)
  --allow <ip|cidr>         With up or invite: also allow this IP to SSH in (repeatable).
                            Your own IP is always allowed.
  --port <n>                Local port for the tunnel (default: 4600, or the next free one)
  --project <owner/repo>    Also clone this GitHub repo as the office's first floor. Without it
                            the office opens on its elevator, which lists every repo your GitHub
                            token can see: pick one there. Projects go in ~/workspace on the VM
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
    --name | --location | --region | --subscription | --size | --instance-type | --disk | --allow | --port | --project | \
      --app-repo | --app-ref | --github-token | --claude-token | --anthropic-api-key)
      [[ $# -ge 2 ]] || die "$1 needs a value (see: deploy/azure.sh help)" ;;
  esac
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --location | --region) LOCATION_ARG="$2"; shift 2 ;;
    --subscription) SUBSCRIPTION_ARG="$2"; shift 2 ;;
    --size | --instance-type) SIZE="$2"; SIZE_SET=1; shift 2 ;;
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
    --no-open) NO_OPEN=1; shift ;;
    -y | --yes) YES=1; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) die "unknown option $1 (see: deploy/azure.sh help)" ;;
    *)
      if [[ -z "$CMD" ]]; then CMD="$1"; else POSITIONAL+=("$1"); fi
      shift
      ;;
  esac
done
CMD="${CMD:-help}"
# Azure's resource group names ignore case, so the office's name does too.
NAME=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]')

# Resource names are built from it, and a Linux VM's name can't start or end with a dash.
[[ "$NAME" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,38}[a-zA-Z0-9])?$ ]] ||
  die "--name may only contain letters, numbers and dashes (not first or last), up to 40 of them"
[[ "$LOCAL_PORT" =~ ^[0-9]+$ && $LOCAL_PORT -gt 0 && $LOCAL_PORT -lt 65536 ]] || die "--port must be a port number"
[[ "$DISK_GB" =~ ^[0-9]+$ && $DISK_GB -ge 30 && $DISK_GB -le 4095 ]] || die "--disk must be a size in GiB, from 30 to 4095"
[[ "$SIZE" =~ ^[A-Za-z0-9_]+$ ]] || die "not a VM size: $SIZE (e.g. $DEFAULT_SIZE)"
RESOURCE="agent-office-$NAME"
[[ "$NAME" == "agent-office" ]] && RESOURCE="agent-office"
RG="$RESOURCE"
VM="$RESOURCE"
NSG="$RESOURCE-nsg"
PIP="$RESOURCE-ip"
VNET="$RESOURCE-vnet"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/agent-office/azure/$NAME"
NAME_FLAG=""
[[ "$NAME" != "agent-office" ]] && NAME_FLAG=" --name $NAME"
# RSA, which every Azure path takes (ED25519 support is newer, and not everywhere).
KEY_FILE="$STATE_DIR/id_rsa"
KNOWN_HOSTS="$STATE_DIR/known_hosts"
CLAIM_FILE="$STATE_DIR/claim-token"
# The subscription `up` made the office in, so later commands look there without --subscription.
SUB_FILE="$STATE_DIR/subscription"

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required (${2:-install it first})"; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# The Azure CLI, pinned to one subscription, without warnings, and without the \r it prints on
# Windows. Not for `az account list-locations` or `az config`, which don't take --subscription.
SUB_ARGS=()
azc() { az "$@" "${SUB_ARGS[@]+"${SUB_ARGS[@]}"}" --only-show-errors | tr -d '\r'; }
# One value. az prints None for a missing one in a list, and nothing for a missing one on its own.
azv() { azc "$@" -o tsv | sed 's/^None$//'; }
# az's tsv rows as space-separated words, with - for a missing value, so `read` keeps each in place.
words() { awk -F'\t' '{ for (i = 1; i <= NF; i++) { gsub(/ /, "", $i); if ($i == "" || $i == "None") $i = "-" } $1 = $1; print }'; }

preflight() {
  need az "https://learn.microsoft.com/cli/azure/install-azure-cli"
  need ssh
  need curl
  [[ -z "$SUBSCRIPTION_ARG" && -s "$SUB_FILE" ]] && SUBSCRIPTION_ARG=$(cat "$SUB_FILE")
  [[ -n "$SUBSCRIPTION_ARG" ]] && SUB_ARGS=(--subscription "$SUBSCRIPTION_ARG")
  # Fetching a token refreshes the sign-in, so an expired one fails here and not halfway through.
  azc account get-access-token -o none 2>/dev/null ||
    die "the Azure CLI isn't signed in${SUBSCRIPTION_ARG:+ to subscription $SUBSCRIPTION_ARG} (try: az login)"
  local row
  row=$(azc account show --query '[[id, name]]' -o tsv 2>/dev/null) || die "couldn't read your Azure subscription (try: az login)"
  SUB_ID="${row%%$'\t'*}"
  SUB_NAME="${row#*$'\t'}"
  # By ID from here on, so every call hits the same subscription even if the default changes.
  SUB_ARGS=(--subscription "$SUB_ID")
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

# --- Azure lookups ------------------------------------------------------------------------------

# Sets LOCATION to the region of the office's resource group ('' when there's none yet), after
# making sure this script made it: destroy deletes the whole group.
load_group() {
  local exists row tag
  LOCATION=""
  exists=$(azv group exists -n "$RG") || die "couldn't look up the resource group $RG (above)"
  [[ "$exists" == "true" ]] || return 0
  row=$(azc group show -n "$RG" --query '[[location, tags."agent-office"]]' -o tsv | words) ||
    die "couldn't read the resource group $RG (above)"
  read -r LOCATION tag <<<"$row"
  [[ "$tag" == "$NAME" ]] ||
    die "the resource group $RG wasn't made by deploy/azure.sh (it has no agent-office=$NAME tag) — pick another --name"
}

require_group() {
  load_group
  [[ -n "$LOCATION" ]] || die "no office named \"$NAME\" in subscription $SUB_NAME — run: deploy/azure.sh up$NAME_FLAG"
}

default_location() {
  local l="${AZURE_DEFAULTS_LOCATION:-}"
  [[ -n "$l" ]] || l=$(az config get defaults.location --query value -o tsv 2>/dev/null | tr -d '\r' || true)
  echo "${l:-eastus}"
}

# "West Europe" and "westeurope" are the same region; Azure's name for it is the second.
normalize_location() { lower "$1" | tr -d ' '; }

# The office's VM ID, or nothing when it has none. A list rather than `vm show`, so that any other
# error stops the script instead of reading as "no VM".
find_vm() { azv vm list -g "$RG" --query "[?name=='$VM'].id | [0]"; }
vm_size() { azv vm show -g "$RG" -n "$VM" --query hardwareProfile.vmSize; }

require_vm_exists() {
  VM_ID=$(find_vm)
  [[ -n "$VM_ID" ]] || die "office \"$NAME\" has no VM — run: deploy/azure.sh up$NAME_FLAG"
}

# A network resource of the office's, by kind (nsg, public-ip) and name: its ID, or nothing. Here
# too an error stops the script: taking one for "missing" would re-create, and so reset, what's there.
find_resource() { azv network "$1" list -g "$RG" --query "[?name=='$2'].id | [0]"; }

# running, starting, stopping, stopped (off, still billed), deallocating or deallocated (paused).
vm_power() {
  azv vm get-instance-view -g "$RG" -n "$VM" --query "instanceView.statuses[?starts_with(code, 'PowerState/')].code | [0]" 2>/dev/null |
    sed 's#^PowerState/##' || true
}

# The power state once it's done changing (a start, stop or deallocate in progress). Gives up
# after 10 minutes, or after 30 seconds of Azure not saying.
settled_power() {
  local p="" i blank=0
  for ((i = 0; i < 120; i++)); do
    p=$(vm_power)
    case "$p" in
      starting | stopping | deallocating) ;;
      "")
        blank=$((blank + 1))
        [[ $blank -lt 6 ]] || break
        ;;
      *) break ;;
    esac
    [[ $i -eq 0 ]] && say "Waiting for the VM, which is ${p:-busy}" >&2
    sleep 5
  done
  echo "$p"
}

# Start a paused (deallocated or stopped) VM; a running one is left alone.
start_vm() {
  [[ "$(settled_power)" == "running" ]] && return 0
  say "Starting $VM"
  azc vm start -g "$RG" -n "$VM" -o none
}

public_ip() { azv network public-ip show -g "$RG" -n "$PIP" --query ipAddress 2>/dev/null || true; }

# "<name> <arch> <generations> <no Trusted Launch> <premium SSD> <temp disk MB> <disk controllers>"
# for a size this subscription can use in $LOCATION (- where Azure doesn't say), or nothing when it
# can't. Fails when Azure can't list the sizes at all.
size_row() {
  local q="[].[name" c out
  for c in CpuArchitectureType HyperVGenerations TrustedLaunchDisabled PremiumIO MaxResourceVolumeMB DiskControllerTypes; do
    q+=", capabilities[?name=='$c'] | [0].value"
  done
  out=$(azc vm list-skus -l "$LOCATION" --resource-type virtualMachines --size "$1" -o tsv --query "$q]") || return 1
  printf '%s\n' "$out" | awk -F'\t' -v w="$1" 'tolower($1) == tolower(w) { print; exit }' | words
}

# Sets SIZE to the size's own spelling, and SIZE_ARCH, SIZE_GENS, SIZE_NO_TL, SIZE_PREMIUM, SIZE_TEMP
# and SIZE_CONTROLLERS to what it has (see size_row).
size_info() {
  local want="$1" row
  [[ "$want" =~ ^[A-Za-z0-9_]+$ ]] || die "not a VM size: $want (e.g. $DEFAULT_SIZE)"
  say "Checking that $want is available in $LOCATION"
  row=$(size_row "$want") || die "couldn't list the VM sizes in $LOCATION (above)"
  [[ -n "$row" ]] || die "$want isn't available to your subscription in $LOCATION. Check the region's name
   (az account list-locations -o table), or pick another --size or --location. The sizes there:
   az vm list-skus -l $LOCATION --resource-type virtualMachines --size Standard_D4 -o table"
  read -r SIZE SIZE_ARCH SIZE_GENS SIZE_NO_TL SIZE_PREMIUM SIZE_TEMP SIZE_CONTROLLERS <<<"$row"
}

# Whether a size has a local temp disk: Azure only resizes between sizes that both do or both don't.
temp_disk() { [[ "$1" != "-" && "$1" != "0" ]]; }

# Whether the size in SIZE takes a disk controller (SCSI or NVMe). Sizes that don't say take SCSI.
size_takes() {
  if [[ "$SIZE_CONTROLLERS" == "-" ]]; then [[ "$1" == "SCSI" ]]; else [[ ",$SIZE_CONTROLLERS," == *",$1,"* ]]; fi
}

# Deallocate -> change size -> start. The disk, the address and everything on the VM stay. The
# changes Azure is known to refuse are caught before anything stops, and if Azure can't start it as
# the new size (no room for that size in the region just then), it goes back to the old one. A
# paused office stays paused, as the new size: then RESIZED_PAUSED is 1.
resize_vm() {
  local have was paused=0 image security disk controller h_arch h_temp had_temp=0 has_temp=0
  RESIZED_PAUSED=0
  have=$(vm_size)
  was=$(settled_power)
  if [[ "$was" == "deallocated" || "$was" == "stopped" ]]; then paused=1; fi
  if [[ "$(lower "$have")" == "$(lower "$1")" ]]; then
    ok "Already a $have"
    RESIZED_PAUSED=$paused
    return
  fi
  size_info "$1"
  read -r image security disk controller <<<"$(azc vm show -g "$RG" -n "$VM" -o tsv --query \
    '[[storageProfile.imageReference.sku, securityProfile.securityType, storageProfile.osDisk.managedDisk.storageAccountType, storageProfile.diskControllerType]]' |
    words)"
  case "$image" in
    *arm64*) h_arch=Arm64 ;;
    *) h_arch=x64 ;;
  esac
  [[ "$SIZE_ARCH" == "$h_arch" ]] || die "can't switch CPU architecture ($have is $h_arch, $SIZE is $SIZE_ARCH) — use destroy + up instead"
  if [[ "$image" == *gen1* ]]; then
    [[ "$SIZE_GENS" == *V1* ]] || die "$SIZE can't run this VM's Gen1 image — use destroy + up instead"
  else
    [[ "$SIZE_GENS" == *V2* ]] || die "$SIZE can't run this VM's Gen2 image — use destroy + up instead"
  fi
  [[ "$security" == "TrustedLaunch" && "$SIZE_NO_TL" == "True" ]] &&
    die "$SIZE doesn't support Trusted Launch, which this VM uses — pick another size, or destroy + up"
  [[ "$disk" == Premium* && "$SIZE_PREMIUM" != "True" ]] &&
    die "$SIZE can't take this VM's Premium SSD — pick a size with an s after the number, like $DEFAULT_SIZE"
  [[ "$controller" == "-" ]] && controller="SCSI"
  size_takes "$controller" || die "$SIZE doesn't take this VM's $controller disk controller — pick another size, or destroy + up"
  h_temp=$(size_row "$have" | awk '{ print $6 }') || h_temp=""
  if [[ -n "$h_temp" ]]; then
    temp_disk "$h_temp" && had_temp=1
    temp_disk "$SIZE_TEMP" && has_temp=1
    [[ $had_temp -eq $has_temp ]] ||
      die "Azure only resizes between sizes that both have a local temp disk or both don't, and only one of $have and $SIZE has one — pick another size, or destroy + up"
  fi
  if [[ $paused -eq 1 ]]; then
    say "Resizing the paused $VM from $have to $SIZE. It stays paused."
  else
    say "Resizing $VM from $have to $SIZE. The office goes offline for a few minutes;"
    echo "   running workers stop and come back asleep (press R at their desk to resume)."
  fi
  confirm
  if [[ "$was" != "deallocated" ]]; then
    say "Stopping"
    azc vm deallocate -g "$RG" -n "$VM" -o none
  fi
  if ! azc vm resize -g "$RG" -n "$VM" --size "$SIZE" -o none; then
    warn "Azure wouldn't make it a $SIZE (above)"
    [[ $paused -eq 1 ]] && die "the office is still a $have, and still paused"
    say "Starting it again as a $have"
    azc vm start -g "$RG" -n "$VM" -o none || true
    die "the office is still a $have"
  fi
  if [[ $paused -eq 1 ]]; then
    RESIZED_PAUSED=1
    ok "Now a $SIZE, and still paused"
    return
  fi
  say "Starting as $SIZE"
  if ! azc vm start -g "$RG" -n "$VM" -o none; then
    warn "Azure couldn't start it as a $SIZE (above; often there's no room for that size in the region just then)"
    say "Going back to $have"
    azc vm deallocate -g "$RG" -n "$VM" -o none || true
    if azc vm resize -g "$RG" -n "$VM" --size "$have" -o none && azc vm start -g "$RG" -n "$VM" -o none; then
      die "the office is back up as a $have. Try $SIZE again later, or another size"
    fi
    die "…and that failed too (above). Try again with: deploy/azure.sh resize $have$NAME_FLAG"
  fi
  ok "Now a $SIZE"
}

# Commands that SSH in need the key `up` made. Checked first, since a failed ssh can be silenced.
require_key() {
  [[ -f "$KEY_FILE" ]] || die "the SSH key for office \"$NAME\" isn't on this computer ($KEY_FILE).
   Let this computer in with: deploy/azure.sh connect$NAME_FLAG (or copy that folder over from the one that made the office)"
}

require_vm() {
  require_key
  require_group
  require_vm_exists
  case "$(vm_power)" in
    stopped | stopping | deallocated | deallocating) die "the office is paused — start it with: deploy/azure.sh resume$NAME_FLAG" ;;
  esac
  IP=$(public_ip)
  [[ -n "$IP" ]] || die "the office's VM has no public IP ($PIP) — run: deploy/azure.sh up$NAME_FLAG"
}

SSH_OPTS=(-i "$KEY_FILE" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KNOWN_HOSTS"
  -o ConnectTimeout=8 -o ServerAliveInterval=15 -o LogLevel=ERROR)

remote() {
  require_key
  # shellcheck disable=SC2029 # the command is meant to expand here, then run there
  ssh "${SSH_OPTS[@]}" "$SSH_USER@$IP" "$@"
}

# The addresses allowed to reach SSH, one per line (none when the rule isn't there). Azure keeps a
# single one in sourceAddressPrefix and several in sourceAddressPrefixes. Any other error stops the
# script: taken for an empty list, it would make the next change drop everyone else's address.
allowed_cidrs() {
  local out
  out=$(azc network nsg show -g "$RG" -n "$NSG" -o tsv \
    --query "securityRules[?name=='$SSH_RULE'] | [0].[sourceAddressPrefix, sourceAddressPrefixes][]") ||
    die "couldn't read the firewall rules of $NSG (above)"
  printf '%s\n' "$out" | sed '/^$/d;/^None$/d'
}

# Makes the NSG's one inbound rule SSH (22) from exactly these addresses. Only SSH is ever opened;
# the office itself is reached through the tunnel. With no addresses, SSH is closed to everyone.
set_ssh_sources() {
  if [[ $# -eq 0 ]]; then
    azc network nsg rule delete -g "$RG" --nsg-name "$NSG" -n "$SSH_RULE" -o none
  else
    # create is a PUT: it writes the whole rule whether or not it's there yet.
    azc network nsg rule create -g "$RG" --nsg-name "$NSG" -n "$SSH_RULE" --priority 1000 \
      --direction Inbound --access Allow --protocol Tcp --source-address-prefixes "$@" --source-port-ranges '*' \
      --destination-address-prefixes '*' --destination-port-ranges 22 \
      --description "Agent Office: SSH from allowed IPs only" -o none
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
    if [[ "$c" == "*" || "$c" == "Internet" ]]; then return 0; fi
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
  die "SSH only answers the IPs you allowed, and this computer's ($my) isn't one of them. Let it in with: deploy/azure.sh allow me$NAME_FLAG"
}

# Waits for SSH on a VM that's (re)starting.
wait_for_ssh() {
  local i
  say "Waiting for SSH"
  for ((i = 0; i < 60; i++)); do
    remote true 2>/dev/null && return 0
    sleep 5
  done
  remote true || die "SSH never came up on $IP"
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
    die "the tunnel opened but the office didn't answer through it — check: deploy/azure.sh logs$NAME_FLAG"
  fi
  ok "Your office: http://localhost:$port$path"
  echo "   (tunneled over SSH to $IP — keep this running while you use it; Ctrl-C closes it)"
  echo "   Workers' web servers open on this computer too, by themselves, with (in another terminal): agent-office tunnel http://localhost:$port"
  open_url "http://localhost:$port$path"
  wait "$pid" || true
  trap - INT TERM
  warn "The tunnel dropped — reopen it with: deploy/azure.sh open$NAME_FLAG"
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
  warn "The tunnel dropped — reopen it with: deploy/azure.sh service $port$NAME_FLAG"
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
  remote "test -x /usr/local/bin/agent-office-team" 2>/dev/null || die "this office predates team access — run: deploy/azure.sh up$NAME_FLAG"
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

  local my a c
  my=$(my_ip) || die "couldn't detect your public IP"
  local cidrs=("$my/32")
  for a in "${EXTRA_ALLOW[@]+"${EXTRA_ALLOW[@]}"}"; do
    c=$(to_cidr "$a")
    cidrs+=("$c")
  done

  # Where: a new office goes in --location; an existing one stays in its resource group's region.
  load_group
  local new_group=0
  if [[ -z "$LOCATION" ]]; then
    new_group=1
    LOCATION=$(normalize_location "${LOCATION_ARG:-$(default_location)}")
    [[ "$LOCATION" =~ ^[a-z0-9]+$ ]] || die "not an Azure region: $LOCATION (see: az account list-locations -o table)"
  elif [[ -n "$LOCATION_ARG" && "$(normalize_location "$LOCATION_ARG")" != "$LOCATION" ]]; then
    die "office \"$NAME\" is in $LOCATION. To move it, destroy it first (or pick another --name)"
  fi

  VM_ID=""
  if [[ $new_group -eq 0 ]]; then VM_ID=$(find_vm); fi
  local have_size="" resize=0 machine
  if [[ -z "$VM_ID" ]]; then
    size_info "$SIZE"
    # The az CLI turns Trusted Launch on for Azure's Gen2 Ubuntu images (Arm ones included), so a
    # size without it needs the Gen1 image, and the Ampere Arm sizes (Bpsv2) have none.
    if [[ "$SIZE_NO_TL" == "True" && "$SIZE_GENS" != *V1* ]]; then
      [[ "$SIZE_ARCH" == "Arm64" ]] && die "$SIZE is an Arm size without Trusted Launch. For Arm, pick a Cobalt size like Standard_D4ps_v6"
      die "$SIZE supports neither Trusted Launch nor Gen1 images — pick another size, like the default $DEFAULT_SIZE"
    fi
    machine="$SIZE, ${DISK_GB} GiB disk, Ubuntu 24.04"
  else
    have_size=$(vm_size)
    machine="the existing VM ($have_size)"
    if [[ $SIZE_SET -eq 1 && "$(lower "$have_size")" != "$(lower "$SIZE")" ]]; then
      resize=1
      machine="the existing VM, resized from $have_size to $SIZE"
    fi
  fi

  say "Agent Office \"$NAME\" in $LOCATION (subscription $SUB_NAME)"
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
  echo "$SUB_ID" >"$SUB_FILE"
  local new_key=0
  if [[ ! -f "$KEY_FILE" ]]; then
    ssh-keygen -q -t rsa -b 4096 -N '' -C "$RESOURCE" -f "$KEY_FILE"
    new_key=1
  fi

  # One resource group holds everything, tagged so destroy knows it's the office's to delete.
  if [[ $new_group -eq 1 ]]; then
    azc group create -n "$RG" -l "$LOCATION" --tags "agent-office=$NAME" -o none
    ok "Resource group $RG"
  fi

  # Network security group: only the allowed IPs can reach 22 (ssh). Nothing else is open.
  local nsg_id pip_id
  nsg_id=$(find_resource nsg "$NSG")
  if [[ -z "$nsg_id" ]]; then
    azc network nsg create -g "$RG" -n "$NSG" -l "$LOCATION" --tags "agent-office=$NAME" -o none
    ok "Network security group $NSG"
  fi
  change_ssh_sources "${cidrs[@]}"
  ok "SSH allowed from ${cidrs[*]}"

  # A fixed address, so the office's address survives pauses and resizes.
  pip_id=$(find_resource public-ip "$PIP")
  if [[ -z "$pip_id" ]]; then
    # Azure drops a connection that's quiet for --idle-timeout minutes (4 by default), and a
    # teammate's tunnel doesn't send keepalives.
    azc network public-ip create -g "$RG" -n "$PIP" -l "$LOCATION" --sku Standard --allocation-method Static --version IPv4 \
      --idle-timeout 30 --tags "agent-office=$NAME" -o none
  fi
  IP=$(public_ip)
  [[ -n "$IP" ]] || die "the public IP $PIP has no address"
  ok "Static IP $IP"

  # The VM.
  if [[ -z "$VM_ID" ]]; then
    # Ubuntu 24.04. The az CLI turns Trusted Launch (secure boot + vTPM) on for Gen2 x64 images by
    # itself. Sizes without it (or without Gen2) take the Gen1 image, and Arm sizes the Arm one.
    local image="Canonical:ubuntu-24_04-lts:server:latest" disk_sku="Premium_LRS"
    if [[ "$SIZE_ARCH" == "Arm64" ]]; then
      image="Canonical:ubuntu-24_04-lts:server-arm64:latest"
    elif [[ "$SIZE_GENS" != *V2* || ("$SIZE_NO_TL" == "True" && "$SIZE_GENS" == *V1*) ]]; then
      image="Canonical:ubuntu-24_04-lts:server-gen1:latest"
    fi
    [[ "$SIZE_PREMIUM" == "True" ]] || disk_sku="StandardSSD_LRS"
    say "Creating the VM ($SIZE) — a minute or two"
    azc vm create -g "$RG" -n "$VM" -l "$LOCATION" --image "$image" --size "$SIZE" \
      --admin-username "$SSH_USER" --authentication-type ssh --ssh-key-values "$KEY_FILE.pub" \
      --vnet-name "$VNET" --subnet default --nsg "$NSG" --nsg-rule NONE --public-ip-address "$PIP" \
      --os-disk-size-gb "$DISK_GB" --storage-sku "$disk_sku" --tags "agent-office=$NAME" -o none ||
      die "couldn't create the VM (Azure's reason is above). If it's a quota, ask for more vCPUs for that
   size's family (Azure portal → Quotas → Compute), or run up again with another --size. Another region
   (--location) needs a fresh start: deploy/azure.sh destroy$NAME_FLAG first"
  elif [[ $resize -eq 1 ]]; then
    resize_vm "$SIZE"
    if [[ $RESIZED_PAUSED -eq 1 ]]; then start_vm; fi
  elif [[ "$(settled_power)" != "running" ]]; then
    start_vm
  else
    say "Reusing $VM ($have_size)"
  fi
  ok "VM $VM is running at $IP"

  # An office made on another computer (or whose key was lost): give this computer's key to it too.
  if [[ $new_key -eq 1 && -n "$VM_ID" ]]; then add_key; fi
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
    printf 'export GIT_NAME=%q GIT_EMAIL=%q DEPLOY_SCRIPT=%q\n' "$git_name" "$git_email" "deploy/azure.sh$NAME_FLAG"
    cat "$SCRIPT_DIR/provision.sh"
  } | remote 'bash -s' || die "provisioning failed (re-run \"deploy/azure.sh up$NAME_FLAG\" to retry; it picks up where it left off)"

  say "Waiting for the office to answer"
  wait_healthy || die "the office didn't come up — check: deploy/azure.sh logs$NAME_FLAG"
  ok "Your office is running on $IP (reachable only through SSH)"
  echo
  echo "   Open it later:     deploy/azure.sh open$NAME_FLAG"
  echo "   Add a teammate:    the 👥 Invite button in the office, or deploy/azure.sh invite <their-github-username>$NAME_FLAG"
  echo "   Pause / resume:    deploy/azure.sh pause$NAME_FLAG   /   deploy/azure.sh resume$NAME_FLAG"
  echo "   Tear it down:      deploy/azure.sh destroy$NAME_FLAG"
  echo
  [[ $NO_OPEN -eq 1 ]] && return
  open_office
}

# Puts this computer's public key on the VM (through Azure's VM agent, so no SSH needed).
add_key() {
  say "Adding this computer's SSH key to the VM"
  azc vm user update -g "$RG" -n "$VM" --username "$SSH_USER" --ssh-key-value "$KEY_FILE.pub" -o none ||
    die "couldn't add the SSH key ($KEY_FILE.pub) to the VM (above)"
}

# An office made on another computer: this one gets a key on the VM and its IP in the firewall.
# Unlike up, it doesn't provision, so the office keeps its GitHub and Claude sign-ins.
cmd_connect() {
  preflight
  need ssh-keygen
  require_group
  require_vm_exists
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  echo "$SUB_ID" >"$SUB_FILE"
  local my
  my=$(my_ip) || die "couldn't detect your public IP"
  change_ssh_sources "$my/32"
  ok "SSH allowed from $my/32"
  start_vm # the VM agent that adds the key only runs on a running VM
  IP=$(public_ip)
  [[ -n "$IP" ]] || die "the office's VM has no public IP ($PIP) — run: deploy/azure.sh up$NAME_FLAG"
  if [[ -f "$KEY_FILE" ]] && remote true 2>/dev/null; then
    ok "This computer could already SSH in"
  else
    [[ -f "$KEY_FILE" ]] || ssh-keygen -q -t rsa -b 4096 -N '' -C "$RESOURCE" -f "$KEY_FILE"
    add_key
    wait_for_ssh
  fi
  ok "Connected to office \"$NAME\" at $IP — open it with: deploy/azure.sh open$NAME_FLAG"
}

cmd_open() {
  preflight
  require_vm
  wait_healthy || die "the office isn't answering — check: deploy/azure.sh logs$NAME_FLAG"
  open_office
}

cmd_service() {
  preflight
  [[ ${#POSITIONAL[@]} -eq 1 && "${POSITIONAL[0]}" =~ ^[0-9]+$ && ${POSITIONAL[0]} -gt 0 && ${POSITIONAL[0]} -lt 65536 ]] ||
    die "usage: deploy/azure.sh service <port>   (a port from the office's 🌐 Services board)"
  [[ "${POSITIONAL[0]}" -ne $OFFICE_PORT ]] || die "$OFFICE_PORT is the office itself — use: deploy/azure.sh open"
  require_vm
  service_tunnel "${POSITIONAL[0]}"
}

cmd_status() {
  preflight
  load_group
  if [[ -z "$LOCATION" ]]; then
    echo "No office named \"$NAME\" in subscription $SUB_NAME."
    return
  fi
  echo "office:    $NAME ($LOCATION, resource group $RG)"
  VM_ID=$(find_vm)
  if [[ -z "$VM_ID" ]]; then
    echo "vm:        none yet (create it with: deploy/azure.sh up$NAME_FLAG)"
    return
  fi
  local state
  state=$(vm_power)
  IP=$(public_ip)
  echo "vm:        $VM $(vm_size) ${state:-unknown}"
  echo "address:   ${IP:-none}  (open the office with: deploy/azure.sh open$NAME_FLAG)"
  if [[ "$state" =~ ^(stopped|stopping)$ ]]; then
    echo "office:    shut down, but Azure still bills a stopped VM (deploy/azure.sh pause$NAME_FLAG deallocates it; resume starts it)"
  elif [[ "$state" =~ ^(deallocated|deallocating)$ ]]; then
    echo "office:    paused (start it with: deploy/azure.sh resume$NAME_FLAG)"
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
  [[ ${#POSITIONAL[@]} -gt 0 ]] || die "usage: deploy/azure.sh allow <ip|cidr|me> [...]"
  require_group
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
  [[ ${#POSITIONAL[@]} -gt 0 ]] || die "usage: deploy/azure.sh revoke <ip|cidr|me> [...]"
  require_group
  local c cidrs=()
  for c in "${POSITIONAL[@]}"; do
    c=$(to_cidr "$c")
    cidrs+=("$c")
  done
  change_ssh_sources - "${cidrs[@]}"
  for c in "${cidrs[@]}"; do ok "Revoked $c"; done
  [[ -n "$(allowed_cidrs)" ]] || warn "No IP may SSH in now, you included. Let yours back in with: deploy/azure.sh allow me$NAME_FLAG"
}

cmd_invite() {
  preflight
  [[ ${#POSITIONAL[@]} -ge 1 && ${#POSITIONAL[@]} -le 2 ]] ||
    die "usage: deploy/azure.sh invite <github-username>   or   deploy/azure.sh invite <name> <public-key-file>"
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
    echo "   SSH only answers allowed IPs, so also run: deploy/azure.sh allow <their-ip>$NAME_FLAG"
    echo "   (or \"allow anywhere\" — SSH only accepts your key and invited keys)"
  fi
}

cmd_uninvite() {
  preflight
  [[ ${#POSITIONAL[@]} -eq 1 ]] || die "usage: deploy/azure.sh uninvite <name>"
  local who="${POSITIONAL[0]}" out rc=0
  valid_member "$who"
  require_vm
  require_team
  out=$(remote "agent-office-team remove $who" 2>&1) || rc=$?
  [[ $rc -eq 66 ]] && die "$who isn't invited (see: deploy/azure.sh team$NAME_FLAG)"
  [[ $rc -eq 0 ]] || die "couldn't remove the keys: $out"
  ok "$who's keys are removed and open tunnels were dropped (other teammates just reconnect)"
  echo "   They still know the office password. To change it: deploy/azure.sh reset-password$NAME_FLAG"
}

cmd_team() {
  preflight
  require_vm
  require_team
  local list
  list=$(team_members)
  if [[ -z "$list" ]]; then
    echo "Nobody is invited yet. Add someone: deploy/azure.sh invite <github-username>$NAME_FLAG"
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
  [[ ${#POSITIONAL[@]} -eq 1 ]] || die "usage: deploy/azure.sh resize <vm-size>   (e.g. Standard_D8as_v5, Standard_B4s_v2)"
  require_key
  require_group
  require_vm_exists
  resize_vm "${POSITIONAL[0]}"
  if [[ $RESIZED_PAUSED -eq 1 ]]; then
    echo "   Start it with: deploy/azure.sh resume$NAME_FLAG"
    return
  fi
  IP=$(public_ip)
  say "Waiting for the office to answer"
  wait_healthy || die "the office didn't come back — check: deploy/azure.sh logs$NAME_FLAG"
  ok "Your office is back — open it with: deploy/azure.sh open$NAME_FLAG"
}

cmd_pause() {
  preflight
  require_group
  require_vm_exists
  local state
  state=$(settled_power)
  if [[ "$state" != "deallocated" ]]; then
    say "Pausing office \"$NAME\" ($VM). Running workers stop and come back asleep"
    echo "   when you resume (press R at their desk). Open tunnels, teammates' too, are dropped."
    confirm
    # Deallocate, not just stop: a stopped VM keeps its hardware, and Azure keeps billing for it.
    say "Deallocating"
    azc vm deallocate -g "$RG" -n "$VM" -o none
  fi
  ok "Paused. The disk and the address stay (and are all that's billed until you resume)"
  echo "   Start it again with: deploy/azure.sh resume$NAME_FLAG"
}

cmd_resume() {
  preflight
  require_key
  require_group
  require_vm_exists
  start_vm
  IP=$(public_ip)
  [[ -n "$IP" ]] || die "the office's VM has no public IP ($PIP) — run: deploy/azure.sh up$NAME_FLAG"
  say "Waiting for the office to answer"
  wait_healthy || die "the office didn't come back — check: deploy/azure.sh logs$NAME_FLAG"
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
  wait_healthy || die "the office didn't come back — check: deploy/azure.sh logs$NAME_FLAG"
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
  wait_healthy || die "the office didn't come back — check: deploy/azure.sh logs$NAME_FLAG"
  ok "Everyone has been signed out"
  open_office
}

# Drops this computer's files for the office (SSH key, claim link), unless they're for an office of
# the same name in another subscription.
forget_office() {
  if [[ -s "$SUB_FILE" && "$(cat "$SUB_FILE")" != "$SUB_ID" ]]; then
    echo "(This computer's files for \"$NAME\", in $STATE_DIR, are for subscription $(cat "$SUB_FILE"), so they stay.)"
    return
  fi
  rm -rf "$STATE_DIR"
}

cmd_down() {
  preflight
  load_group
  if [[ -z "$LOCATION" ]]; then
    echo "Nothing to delete for \"$NAME\" in subscription $SUB_NAME."
    forget_office
    return
  fi
  say "This permanently deletes office \"$NAME\": the resource group $RG in $LOCATION (subscription $SUB_NAME)"
  echo "   and everything in it:"
  azc resource list -g "$RG" -o tsv --query '[].[type, name]' | awk -F'\t' '{ printf "     %s  %s\n", $2, $1 }' || true
  echo "   Anything on the VM that isn't pushed to GitHub is lost."
  if [[ $YES -ne 1 ]]; then
    local answer
    read -r -p "   Type the office name ($NAME) to confirm: " answer
    [[ "$answer" == "$NAME" ]] || die "cancelled"
  fi
  say "Deleting $RG — this takes a few minutes"
  azc group delete -n "$RG" --yes -o none || die "couldn't delete $RG (above) — run destroy again in a minute"
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
  *) die "unknown command \"$CMD\" (see: deploy/azure.sh help)" ;;
esac
