#!/usr/bin/env bash
# Deploy your own Agent Office to AWS with one command, using only the AWS CLI.
#
#   deploy/aws.sh up        create everything, install, open the office in your browser
#   deploy/aws.sh down      delete everything it created
#
# Run `deploy/aws.sh help` for all commands and options.
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

usage() {
  cat <<'EOF'
Agent Office on AWS — one command up, one command down.

Usage: deploy/aws.sh <command> [options]

Commands
  up                 Create (or reuse) your office on EC2, install everything, and open it in
                     your browser. The first page shows the office password ONCE — write it down.
  open               Open your office in the browser
  status             Show the instance, its URL and which IPs may reach it
  allow <ip|me>      Let an IP (or CIDR) reach the office and SSH. "me" = your current IP
  revoke <ip|me>     Take that access away again
  ssh                SSH into the machine
  logs               Follow the office's logs
  resize <type>      Change the machine size, e.g. t3.2xlarge (stops it for ~1-2 minutes;
                     the address stays the same). `up --instance-type <type>` does this too.
  update             Install the latest agent-office on the machine and restart it
  reset-password     Forget the password and show a new one once in your browser
  down               Terminate the machine and delete everything this script created

Options
  --name <name>             Deployment name, lets you run several offices (default: agent-office)
  --region <region>         AWS region (default: your AWS CLI region, else us-east-1)
  --profile <profile>       AWS CLI profile
  --instance-type <type>    EC2 instance type (default: t3.xlarge — 4 vCPU, 16 GiB)
  --disk <GiB>              Root disk size (default: 50)
  --allow <ip|cidr>         Also allow this IP at creation (repeatable). Your IP is always allowed.
  --project <owner/repo>    GitHub repo the office works on (default: this directory's GitHub
                            origin; otherwise an empty project)
  --app-repo <url>          agent-office repo to install (default: this checkout's GitHub origin)
  --app-ref <ref>           Branch or tag to install (default: main)
  --github-token <token>    GitHub token for private repos + the issue/PR boards
                            (default: your local `gh auth token`)
  --no-github-token         Don't put any GitHub token on the machine
  --claude-token <token>    Claude subscription token from `claude setup-token`
                            (default: $CLAUDE_CODE_OAUTH_TOKEN). Without one, log in from the
                            first worker's terminal in the office.
  --anthropic-api-key <key> Use an Anthropic API key instead
  --no-open                 Don't open the browser
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
    -*) die "unknown option $1 (see: deploy/aws.sh help)" ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

[[ "$NAME" =~ ^[a-zA-Z0-9-]+$ ]] || die "--name may only contain letters, numbers and dashes"
RESOURCE="agent-office-$NAME"
[[ "$NAME" == "agent-office" ]] && RESOURCE="agent-office"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/agent-office/aws/$NAME"
NAME_FLAG=""
[[ "$NAME" != "agent-office" ]] && NAME_FLAG=" --name $NAME"
KEY_FILE="$STATE_DIR/id_ed25519"
KNOWN_HOSTS="$STATE_DIR/known_hosts"
CLAIM_FILE="$STATE_DIR/claim-token"

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required (${2:-install it first})"; }
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
  [[ "$want_arch" == "$have_arch" ]] || die "can't switch CPU architecture ($have is $have_arch, $want is $want_arch) — use down + up instead"
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

require_instance() {
  INSTANCE_ID=$(find_instance)
  [[ -n "$INSTANCE_ID" ]] || die "no office named \"$NAME\" in $AWS_REGION — run: deploy/aws.sh up"
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

allow_cidr() {
  local sg="$1" cidr="$2" port out
  for port in 443 22; do
    if ! out=$(aws ec2 authorize-security-group-ingress --group-id "$sg" \
      --ip-permissions "IpProtocol=tcp,FromPort=$port,ToPort=$port,IpRanges=[{CidrIp=$cidr,Description=agent-office}]" 2>&1); then
      [[ "$out" == *InvalidPermission.Duplicate* ]] || die "could not allow $cidr: $out"
    fi
  done
}

revoke_cidr() {
  local sg="$1" cidr="$2" port
  for port in 443 22; do
    aws ec2 revoke-security-group-ingress --group-id "$sg" --protocol tcp --port "$port" --cidr "$cidr" >/dev/null 2>&1 || true
  done
}

allowed_cidrs() {
  aws_ ec2 describe-security-groups --group-ids "$1" \
    --query 'SecurityGroups[0].IpPermissions[?FromPort==`443`].IpRanges[].CidrIp' | tr '\t' '\n' | sed '/^$/d'
}

wait_healthy() {
  local i
  for ((i = 0; i < 90; i++)); do
    curl -fsk --max-time 4 "https://$IP/api/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

open_office() {
  local claimable url
  claimable=$(curl -fsk --max-time 6 "https://$IP/api/claim" 2>/dev/null || true)
  if [[ "$claimable" == *'"claimable":true'* && -f "$CLAIM_FILE" ]]; then
    url="https://$IP/claim?t=$(cat "$CLAIM_FILE")"
    say "Opening the one-time password page — write the password down, it is never shown again"
  else
    url="https://$IP/"
  fi
  echo "   $url"
  open_url "$url"
}

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

  # What to install, and which project the office works on.
  if [[ -z "$APP_REPO" ]]; then
    APP_REPO=$(github_https "$(git -C "$SCRIPT_DIR/.." remote get-url origin 2>/dev/null || true)" || echo "https://github.com/AgentSystemLabs/agent-office")
  fi
  local project_repo="" project_name="office"
  if [[ -z "$PROJECT" ]]; then
    PROJECT=$(git remote get-url origin 2>/dev/null || true)
  fi
  if [[ -n "$PROJECT" ]]; then
    project_repo=$(github_https "$PROJECT") || die "--project must be a GitHub repo (owner/name or URL), got: $PROJECT"
    project_name=$(basename "$project_repo")
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
  echo "   project:  ${project_repo:-(empty project)}"
  echo "   allowed:  ${cidrs[*]}"
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

  # Security group: only the allowed IPs can reach 443 (office) and 22 (ssh).
  local vpc sg
  vpc=$(aws_ ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' | sed 's/^None$//')
  [[ -n "$vpc" ]] || die "no default VPC in $AWS_REGION (create one with: aws ec2 create-default-vpc)"
  sg=$(find_sg)
  if [[ -z "$sg" ]]; then
    sg=$(aws_ ec2 create-security-group --group-name "$RESOURCE" --vpc-id "$vpc" \
      --description "Agent Office $NAME - only allowed IPs" \
      --tag-specifications "ResourceType=security-group,Tags=[{Key=agent-office,Value=$NAME},{Key=Name,Value=$RESOURCE}]" \
      --query GroupId)
    ok "Security group $sg"
  fi
  local c
  for c in "${cidrs[@]}"; do allow_cidr "$sg" "$c"; done
  ok "Allowed ${cidrs[*]}"

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
    say "Starting $INSTANCE_ID"
    aws ec2 wait instance-stopped --instance-ids "$INSTANCE_ID"
    aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null
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
    printf 'export APP_REPO=%q APP_REF=%q PROJECT_REPO=%q PROJECT_NAME=%q\n' "$APP_REPO" "$APP_REF" "$project_repo" "$project_name"
    printf 'export CLAIM_TOKEN=%q GH_TOKEN=%q CLAUDE_CODE_OAUTH_TOKEN=%q ANTHROPIC_API_KEY=%q\n' "$(cat "$CLAIM_FILE")" "$gh_token" "$CLAUDE_TOKEN" "$ANTHROPIC_KEY"
    printf 'export GIT_NAME=%q GIT_EMAIL=%q\n' "$git_name" "$git_email"
    cat "$SCRIPT_DIR/provision.sh"
  } | remote 'bash -s' || die "provisioning failed (re-run \"deploy/aws.sh up\" to retry; it picks up where it left off)"

  say "Waiting for the office to answer"
  wait_healthy || die "the office didn't come up — check: deploy/aws.sh logs"
  ok "Your office is live at https://$IP/"
  echo
  echo "   Your browser will warn about the self-signed certificate: choose Advanced → Proceed."
  echo "   Add a teammate:  deploy/aws.sh allow <their-ip>$NAME_FLAG"
  echo "   Tear it down:    deploy/aws.sh down$NAME_FLAG"
  echo
  open_office
}

cmd_open() {
  preflight
  require_instance
  wait_healthy || die "https://$IP/ isn't answering — check: deploy/aws.sh logs"
  open_office
}

cmd_status() {
  preflight
  INSTANCE_ID=$(find_instance)
  if [[ -z "$INSTANCE_ID" ]]; then
    echo "No office named \"$NAME\" in $AWS_REGION."
    return
  fi
  local sg
  sg=$(find_sg)
  IP=$(instance_field "$INSTANCE_ID" PublicIpAddress)
  echo "office:    $NAME ($AWS_REGION)"
  echo "instance:  $INSTANCE_ID $(instance_field "$INSTANCE_ID" InstanceType) $(instance_field "$INSTANCE_ID" State.Name)"
  echo "url:       ${IP:+https://$IP/}"
  if [[ -n "$IP" ]] && curl -fsk --max-time 4 "https://$IP/api/health" >/dev/null 2>&1; then
    echo "office:    up"
  else
    echo "office:    not answering"
  fi
  echo "allowed:   $(allowed_cidrs "$sg" | tr '\n' ' ')"
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
  ok "Your office is back at https://$IP/"
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
    sudo systemctl restart agent-office" || die "update failed"
  wait_healthy || die "the office didn't come back — check: deploy/aws.sh logs"
  ok "Updated and restarted (workers wake up asleep; press R at a desk to resume them)"
}

cmd_reset_password() {
  preflight
  require_instance
  (umask 077 && random_token >"$CLAIM_FILE")
  say "Resetting the office password"
  remote "set -e
    dir=\$(cat /etc/agent-office/dir)
    sudo sed -i 's/^AGENT_OFFICE_CLAIM_TOKEN=.*/AGENT_OFFICE_CLAIM_TOKEN=\"$(cat "$CLAIM_FILE")\"/' /etc/agent-office/env
    sudo systemctl stop agent-office
    node /opt/agent-office/bin/agent-office.js \"\$dir\" --reset-password >/dev/null
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
    aws ec2 describe-security-groups --group-ids "$sg" >/dev/null 2>&1 && die "couldn't delete $sg yet — run down again in a minute"
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
  status) cmd_status ;;
  allow) cmd_allow ;;
  revoke) cmd_revoke ;;
  ssh) cmd_ssh ;;
  logs) cmd_logs ;;
  resize) cmd_resize ;;
  update) cmd_update ;;
  reset-password) cmd_reset_password ;;
  down) cmd_down ;;
  help | -h | --help) usage ;;
  *) die "unknown command \"$CMD\" (see: deploy/aws.sh help)" ;;
esac
