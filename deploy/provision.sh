#!/usr/bin/env bash
# Puts Agent Office on an Ubuntu or Debian server, with one line run on it (as root or a sudo user):
#
#   curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/deploy/provision.sh | bash
#
# or from your own computer:
#
#   ssh root@203.0.113.7 'curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/deploy/provision.sh | bash'
#
# It installs Node.js, git, the GitHub CLI and Claude Code, and runs the office as a systemd service
# that listens on the server's loopback only. You reach it through an SSH tunnel, or, given
# `--domain office.example.com` (after `bash -s --`), on https://office.example.com through Caddy,
# which gets the certificate by itself, or, given `--tailscale`, on your Tailscale network at
# https://agent-office.<your-tailnet>.ts.net through Tailscale Serve. At the end it prints a link
# that shows the office password exactly once. As root, it makes an `agentoffice` user to run the
# office, so workers never run as root. Run it again to update; it's idempotent.
#
# deploy/aws.sh pipes this over SSH to the EC2 machine it creates, with these exported: APP_REPO
# APP_REF PROJECT_REPO CLAIM_TOKEN PUBLIC_HOST GH_TOKEN CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY
# GIT_NAME GIT_EMAIL, and TAILSCALE TAILSCALE_AUTH_KEY TAILSCALE_HOSTNAME for --tailscale. They all
# have defaults, and the options below set the common ones.
#
# deploy/container/install.sh copies four heredocs out of this file into the container image
# deploy/railway.sh, deploy/fly.sh, deploy/dokploy.sh and deploy/coolify.sh run: team_sh, tunnel_sh,
# sshd_conf and the NODE onboarding. Keep each one's first line naming its variable (or
# `as_user node -`) and ending in its <<'TAG'.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

usage() {
  cat <<'EOF'
Usage: provision.sh [options]      (curl … | bash -s -- [options])

  --domain <name>       Serve the office on https://<name> through Caddy (its DNS must point here,
                        and ports 80 and 443 be open). Without it, only an SSH tunnel reaches it
  --tailscale           Put the office on your Tailscale network instead, at
                        https://<machine>.<tailnet>.ts.net (Tailscale Serve: HTTPS, no open ports).
                        It prints a link to sign the machine in, unless you give an auth key
  --tailscale-auth-key <key>
                        Add the machine to your tailnet with this auth key (tskey-auth-…, from
                        the Keys page of Tailscale's admin console). Implies --tailscale
  --tailscale-hostname <name>
                        Its machine name on the tailnet (default agent-office)
  --project <repo>      Clone this GitHub repository (owner/name) as the first floor
  --public-host <addr>  The address teammates SSH to (default: --domain, else this server's public IP)
  --user <name>         Who runs the office when this runs as root (default agentoffice)
  -h, --help            Show this help

Run in a terminal, it offers to sign the GitHub CLI in; otherwise run `gh auth login` in a shell at
any desk in the office. The first Claude worker asks you to type /login in its terminal.
EOF
}

DOMAIN="${AGENT_OFFICE_DOMAIN:-}"
TAILSCALE="${TAILSCALE:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain needs a name}"; shift 2 ;;
    --tailscale) TAILSCALE=1; shift ;;
    --tailscale-auth-key) TAILSCALE_AUTH_KEY="${2:?--tailscale-auth-key needs a key}"; TAILSCALE=1; shift 2 ;;
    --tailscale-hostname) TAILSCALE_HOSTNAME="${2:?--tailscale-hostname needs a name}"; shift 2 ;;
    --project) PROJECT_REPO="${2:?--project needs owner/name}"; shift 2 ;;
    --public-host) PUBLIC_HOST="${2:?--public-host needs an address}"; shift 2 ;;
    --user) AGENT_OFFICE_USER="${2:?--user needs a name}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "provision: unknown option $1" >&2; usage >&2; exit 2 ;;
  esac
done
# Run again to update, this keeps serving the domain it was given before.
[[ -n "$DOMAIN" ]] || DOMAIN=$(cat /etc/agent-office/domain 2>/dev/null || true)
if [[ -n "$DOMAIN" && ! "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
  echo "provision: not a domain name: $DOMAIN" >&2
  exit 2
fi
# …and stays on the tailnet it was put on.
[[ -f /etc/agent-office/tailscale ]] && TAILSCALE=1
[[ -n "${TAILSCALE_AUTH_KEY:-}" ]] && TAILSCALE=1
[[ "$TAILSCALE" == 1 ]] || TAILSCALE=""
TS_NAME=$(printf '%s' "${TAILSCALE_HOSTNAME:-agent-office}" | tr '[:upper:]' '[:lower:]')
if [[ -n "$TAILSCALE" && ! "$TS_NAME" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
  echo "provision: not a machine name: $TS_NAME (letters, numbers and dashes)" >&2
  exit 2
fi
if [[ -n "$DOMAIN" && -n "$TAILSCALE" ]]; then
  echo "provision: pick one of --domain and --tailscale" >&2
  exit 2
fi

APP_REPO="${APP_REPO:-https://github.com/AgentSystemLabs/agent-office.git}"
APP_REF="${APP_REF:-main}"
# deploy/aws.sh brings its own claim token and shows the way in itself; run by hand, this does.
STANDALONE=0
[[ -n "${CLAIM_TOKEN:-}" ]] || STANDALONE=1

APT=(sudo -E apt-get -y -q -o DPkg::Lock::Timeout=600)

step() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mprovision:\033[0m %s\n' "$*" >&2; exit 1; }
# Run quietly; show the output only when something fails.
quiet() {
  local log
  log=$(mktemp)
  if ! "$@" >"$log" 2>&1; then
    tail -n 40 "$log" >&2
    echo "provision: failed: $*" >&2
    exit 1
  fi
  rm -f "$log"
}

command -v apt-get >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1 ||
  die "this sets up Ubuntu or Debian servers (apt and systemd). Elsewhere, see the README."
# As root, other users' commands would start in /root, which they can't read.
cd /

if [[ $EUID -eq 0 ]] && ! command -v sudo >/dev/null 2>&1; then
  step "Installing sudo"
  quiet apt-get -y -q update
  quiet apt-get -y -q install sudo
fi

step "Waiting for the machine to finish booting"
sudo cloud-init status --wait >/dev/null 2>&1 || true

# Who runs the office: whoever runs this, or as root a user of its own, so workers never run as root.
RUN_USER="$(id -un)"
if [[ $EUID -eq 0 ]]; then
  RUN_USER="${AGENT_OFFICE_USER:-agentoffice}"
  [[ "$RUN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ && "$RUN_USER" != root && "$RUN_USER" != office ]] || die "can't run the office as $RUN_USER"
  if ! id "$RUN_USER" >/dev/null 2>&1; then
    step "Creating the $RUN_USER user to run the office"
    useradd --create-home --shell /bin/bash "$RUN_USER"
  fi
fi
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
RUN_GROUP="$(id -gn "$RUN_USER")"
RUN_PATH="$RUN_HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
# Runs a command as that user, in its home and with the service's PATH (Claude Code is in ~/.local/bin).
as_user() {
  if [[ "$RUN_USER" == "$(id -un)" ]]; then env PATH="$RUN_PATH" "$@"
  else sudo -u "$RUN_USER" -H --preserve-env=ANTHROPIC_API_KEY env PATH="$RUN_PATH" "$@"; fi
}

if ! node_major=$(as_user node -p 'process.versions.node.split(".")[0]' 2>/dev/null) || [[ "$node_major" -lt 20 ]]; then
  step "Installing Node.js 22"
  quiet "${APT[@]}" update
  quiet "${APT[@]}" install ca-certificates curl
  quiet bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -'
  quiet "${APT[@]}" install nodejs
fi

step "Installing git, GitHub CLI and build tools"
# gh from GitHub's own apt repo: Ubuntu's archive freezes it at whatever shipped with the release.
# install upgrades it to the newest on every re-run.
sudo install -d -m 755 /etc/apt/keyrings
quiet sudo curl -fsSLo /etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg
sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
quiet "${APT[@]}" update
quiet "${APT[@]}" install git gh curl ca-certificates build-essential python3
echo "    $(gh --version | head -1)"

# A field of `tailscale status --json`, e.g. BackendState or Self.DNSName ('' if there's none).
ts_status() {
  sudo tailscale status --json 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let v;
      try { v = process.argv[1].split(".").reduce((o, k) => o?.[k], JSON.parse(s)); } catch {}
      process.stdout.write(typeof v === "string" ? v : "");
    });' "$1" || true
}

TS_HOST=""
if [[ -n "$TAILSCALE" ]]; then
  if ! command -v tailscale >/dev/null 2>&1; then
    step "Installing Tailscale"
    quiet sh -c 'curl -fsSL https://tailscale.com/install.sh | sh'
  fi
  sudo systemctl enable --now tailscaled >/dev/null 2>&1 || true
  if [[ "$(ts_status BackendState)" != Running ]]; then
    step "Adding this machine to your tailnet as $TS_NAME"
    up_args=(--hostname="$TS_NAME" --timeout=15m)
    key_file=""
    if [[ -n "${TAILSCALE_AUTH_KEY:-}" ]]; then
      # From a file, so the key never shows up in `ps`.
      key_file=$(sudo mktemp)
      printf '%s' "$TAILSCALE_AUTH_KEY" | sudo tee "$key_file" >/dev/null
      up_args+=(--auth-key="file:$key_file")
    else
      echo "    Open the link below and sign in to Tailscale to add it (this waits up to 15 minutes):"
    fi
    rc=0
    sudo tailscale up "${up_args[@]}" || rc=$?
    [[ -z "$key_file" ]] || sudo rm -f "$key_file"
    [[ $rc -eq 0 ]] || die "couldn't join the tailnet${TAILSCALE_AUTH_KEY:+ (is the auth key right, and not expired or used up?)}"
  fi
  step "Serving the office on your tailnet over HTTPS (Tailscale Serve)"
  # The first time, Tailscale may need HTTPS certificates turned on for the tailnet: it prints a
  # link for that and waits here until someone does.
  sudo timeout 900 tailscale serve --bg --yes --https=443 http://127.0.0.1:4600 2>&1 | sed -u 's/^/    /' || true
  sudo tailscale serve status --json 2>/dev/null | grep -q '"http://127.0.0.1:4600"' ||
    die "Tailscale isn't serving the office. Turn on MagicDNS and HTTPS Certificates for your tailnet at https://login.tailscale.com/admin/dns, then run this again."
  TS_HOST=$(ts_status Self.DNSName)
  TS_HOST="${TS_HOST%.}"
  [[ -n "$TS_HOST" ]] || die "couldn't read this machine's name on the tailnet (see: tailscale status)"
  sudo install -d -m 755 /etc/agent-office
  echo "$TS_HOST" | sudo tee /etc/agent-office/tailscale >/dev/null
  # Tailscale gets the certificate on the first visit, which takes a few seconds: get that over with.
  ts_ip=$(sudo tailscale ip -4 2>/dev/null | head -1 || true)
  [[ -z "$ts_ip" ]] || curl -so /dev/null --max-time 90 --resolve "$TS_HOST:443:$ts_ip" "https://$TS_HOST/" || true

  # Workers' web servers get a port of their own there, https://<machine>.ts.net:<port>. The office
  # asks for them through this (it's the only Tailscale thing it may do as root): each one goes to
  # the office, which checks the visitor is signed in and relays it to the worker's server.
  serve_sh=$(mktemp)
  cat >"$serve_sh" <<'SH'
#!/bin/bash
# agent-office-serve sync [port...]: serve exactly these ports on the tailnet, each to the office.
set -euo pipefail
[[ $EUID -eq 0 ]] || exec sudo -n "$0" "$@"
OFFICE=http://127.0.0.1:4600
[[ "${1:-}" == sync ]] || { echo "usage: agent-office-serve sync [port...]" >&2; exit 64; }
shift
want=" "
for p in "$@"; do
  [[ "$p" =~ ^[0-9]{4,5}$ && $p -ge 1024 && $p -le 65535 && $p -ne 4600 ]] || { echo "not a port to serve: $p" >&2; exit 64; }
  want+="$p "
done
exec 9>/run/agent-office-serve.lock
flock 9
# The ports that go to the office now, but the office's own 443.
have=" $(tailscale serve status --json | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const web = (s.trim() ? JSON.parse(s) : {}).Web || {};
    const ports = Object.entries(web)
      .filter(([, w]) => Object.values(w.Handlers || {}).some((h) => h.Proxy === process.argv[1]))
      .map(([hp]) => Number(hp.split(":").pop()))
      .filter((p) => p !== 443);
    console.log(ports.join(" "));
  });' "$OFFICE") "
for p in $have; do
  [[ "$want" == *" $p "* ]] || tailscale serve --yes --https="$p" off >/dev/null
done
for p in $want; do
  [[ "$have" == *" $p "* ]] || tailscale serve --bg --yes --https="$p" "$OFFICE" >/dev/null
done
SH
  sudo install -m 755 -o root -g root "$serve_sh" /usr/local/bin/agent-office-serve
  rm -f "$serve_sh"
  echo "    https://$TS_HOST"
fi

if [[ ! -x "$RUN_HOME/.local/bin/claude" ]]; then
  step "Installing Claude Code"
  quiet as_user bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
fi
echo "    claude $(as_user claude --version 2>/dev/null | head -1)"

# The claim link shows the generated password once. Run again, this keeps the link it printed.
if [[ -z "${CLAIM_TOKEN:-}" ]]; then
  CLAIM_TOKEN=$(sudo sed -n 's/^AGENT_OFFICE_CLAIM_TOKEN="\(.*\)"$/\1/p' /etc/agent-office/env 2>/dev/null || true)
  [[ -n "$CLAIM_TOKEN" ]] || CLAIM_TOKEN=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
fi
if [[ -z "${PUBLIC_HOST:-}" ]]; then
  PUBLIC_HOST="$DOMAIN"
  [[ -n "$PUBLIC_HOST" ]] || PUBLIC_HOST=$(curl -fsS --max-time 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)
  [[ -n "$PUBLIC_HOST" ]] || PUBLIC_HOST=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
fi
# The script that deployed this server, exported as DEPLOY_SCRIPT by deploy/azure.sh ("deploy/azure.sh",
# plus "--name <name>" for a second office), so the office names it in the commands it suggests.
# Run again by hand, this keeps the one from before.
[[ -n "${DEPLOY_SCRIPT:-}" ]] ||
  DEPLOY_SCRIPT=$(sudo sed -n 's/^AGENT_OFFICE_DEPLOY_SCRIPT="\(.*\)"$/\1/p' /etc/agent-office/env 2>/dev/null || true)
[[ "$DEPLOY_SCRIPT" =~ ^deploy/[a-z0-9-]+\.sh(\ --name\ [a-z0-9-]+)?$ ]] || DEPLOY_SCRIPT=""
# Run again without a Claude token or API key (deploy/*.sh up to resize or update, say), this keeps
# the one it was given before, rather than signing the office out of Claude.
if [[ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
  CLAUDE_CODE_OAUTH_TOKEN=$(sudo sed -n 's/^CLAUDE_CODE_OAUTH_TOKEN="\(.*\)"$/\1/p' /etc/agent-office/env 2>/dev/null || true)
  ANTHROPIC_API_KEY=$(sudo sed -n 's/^ANTHROPIC_API_KEY="\(.*\)"$/\1/p' /etc/agent-office/env 2>/dev/null || true)
  export CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY
fi

step "Writing secrets to /etc/agent-office/env"
sudo install -d -m 755 /etc/agent-office
env_file=$(mktemp)
{
  printf 'AGENT_OFFICE_CLAIM_TOKEN="%s"\n' "$CLAIM_TOKEN"
  # The address teammates SSH to, so the office can show them the tunnel command.
  [[ -n "${PUBLIC_HOST:-}" ]] && printf 'AGENT_OFFICE_PUBLIC_HOST="%s"\n' "$PUBLIC_HOST"
  # Its name on the tailnet, so it can show everyone the link, and serve workers' servers there.
  [[ -n "$TS_HOST" ]] && printf 'AGENT_OFFICE_TAILSCALE_HOST="%s"\n' "$TS_HOST"
  [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]] && printf 'CLAUDE_CODE_OAUTH_TOKEN="%s"\n' "$CLAUDE_CODE_OAUTH_TOKEN"
  [[ -n "${ANTHROPIC_API_KEY:-}" ]] && printf 'ANTHROPIC_API_KEY="%s"\n' "$ANTHROPIC_API_KEY"
  [[ -n "$DEPLOY_SCRIPT" ]] && printf 'AGENT_OFFICE_DEPLOY_SCRIPT="%s"\n' "$DEPLOY_SCRIPT"
  true
} >"$env_file"
sudo install -m 600 -o root -g root "$env_file" /etc/agent-office/env
rm -f "$env_file"

if [[ -n "${GH_TOKEN:-}" ]]; then
  step "Signing the GitHub CLI in"
  # Stored in gh's own config, so gh, git (via gh's credential helper), the office's boards, the
  # workers and your ssh sessions all use it — and the token never lands in a .git/config.
  printf '%s' "$GH_TOKEN" | quiet as_user env -u GH_TOKEN gh auth login --hostname github.com --git-protocol https --with-token
  quiet as_user env -u GH_TOKEN gh auth setup-git --hostname github.com
  echo "    $(as_user env -u GH_TOKEN gh api user --jq '"as " + .login' 2>/dev/null || echo 'signed in')"
elif (: </dev/tty) 2>/dev/null && ! as_user gh auth status --hostname github.com >/dev/null 2>&1; then
  # Run by hand in a terminal: sign in now, so the elevator can list your repositories.
  step "Signing the GitHub CLI in (the office clones your projects and reads issues and PRs with it)"
  if as_user gh auth login --hostname github.com --git-protocol https </dev/tty; then
    quiet as_user gh auth setup-git --hostname github.com
  else
    echo "    (skipped: sign in later with gh auth login, from a shell at any desk in the office)"
  fi
fi
[[ -n "${GIT_NAME:-}" ]] && as_user git config --global user.name "$GIT_NAME"
[[ -n "${GIT_EMAIL:-}" ]] && as_user git config --global user.email "$GIT_EMAIL"
as_user git config --global init.defaultBranch main

step "Installing agent-office ($APP_REF) from $APP_REPO"
sudo install -d -o "$RUN_USER" -g "$RUN_GROUP" /opt/agent-office
if [[ -d /opt/agent-office/.git ]]; then
  quiet as_user git -C /opt/agent-office fetch --depth 1 origin "$APP_REF"
  quiet as_user git -C /opt/agent-office reset --hard FETCH_HEAD
else
  quiet as_user git clone --depth 1 --branch "$APP_REF" "$APP_REPO" /opt/agent-office
fi
echo "    at $(as_user git -C /opt/agent-office log -1 --format='%h %s')"
step "npm install (builds the office)"
quiet as_user sh -c 'cd /opt/agent-office && npm install --no-audit --no-fund'

# The office keeps its data (password, accounts, the list of floors) in ~/agent-office and clones
# projects into ~/workspace/<owner>/<repo>. It starts with no project: its elevator lists every
# repository the GitHub token can see, and cloning one makes it the first floor.
OFFICE_HOME="$RUN_HOME/agent-office"
WORKSPACE="$RUN_HOME/workspace"
as_user mkdir -p "$WORKSPACE"
# Offices provisioned before that ran in one project's checkout, with their data in it: they carry
# on there, so nobody loses their account. That project can be taken off in the elevator.
LEGACY_DIR=""
if [[ -f /etc/agent-office/dir ]]; then
  legacy=$(cat /etc/agent-office/dir)
  [[ -f "$legacy/.agent-office/config.json" ]] && LEGACY_DIR="$legacy"
fi
if [[ -n "$LEGACY_DIR" ]]; then
  step "Keeping the office in $LEGACY_DIR (its accounts and floors are there)"
  RUN_DIR="$LEGACY_DIR"
  OFFICE_ARGS="$LEGACY_DIR "
else
  RUN_DIR="$RUN_HOME"
  OFFICE_ARGS=""
  setup_args=()
  # Once: after that, the folder is the admins' to move in ⚙️ Settings.
  [[ -f "$OFFICE_HOME/.agent-office/projects-folder.json" ]] || setup_args+=(--projects "$WORKSPACE")
  [[ -n "${PROJECT_REPO:-}" ]] && setup_args+=(--project "$PROJECT_REPO")
  if [[ ${#setup_args[@]} -gt 0 ]]; then
    step "Setting up the office${PROJECT_REPO:+: cloning $PROJECT_REPO as a floor}"
    # It won't touch a running office's floors (the service restarts below anyway).
    sudo systemctl stop agent-office >/dev/null 2>&1 || true
    as_user node /opt/agent-office/bin/agent-office.js setup "${setup_args[@]}" </dev/null ||
      echo "    (carrying on: add projects from the office's elevator)"
  fi
  sudo rm -f /etc/agent-office/dir
fi
echo "$OFFICE_HOME" | sudo tee /etc/agent-office/home >/dev/null
[[ -n "$LEGACY_DIR" ]] && echo "$LEGACY_DIR" | sudo tee /etc/agent-office/dir >/dev/null

step "Pre-accepting Claude Code onboarding and folder trust"
# The workspace (every project is cloned under it), and an older office's own project.
as_user node - "$WORKSPACE" ${LEGACY_DIR:+"$LEGACY_DIR"} <<'NODE'
const fs = require('fs');
const file = `${process.env.HOME}/.claude.json`;
let c = {};
try { c = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
c.hasCompletedOnboarding = true;
c.projects = c.projects || {};
for (const dir of process.argv.slice(2)) c.projects[dir] = { ...(c.projects[dir] || {}), hasTrustDialogAccepted: true };
const key = process.env.ANTHROPIC_API_KEY;
if (key) {
  c.customApiKeyResponses = c.customApiKeyResponses || { approved: [], rejected: [] };
  if (!c.customApiKeyResponses.approved.includes(key.slice(-20))) c.customApiKeyResponses.approved.push(key.slice(-20));
}
fs.writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
NODE

step "Creating the office user (teammates' SSH keys can only open the tunnel)"
if ! id office >/dev/null 2>&1; then
  sudo useradd --create-home --shell /bin/sh --password '*' office
fi
# Keys are managed by deploy/aws.sh (invite/uninvite). Root owns them so the office user can't add its own.
sudo install -d -m 755 -o root -g root /home/office/.ssh
sudo test -f /home/office/.ssh/authorized_keys || sudo install -m 644 -o root -g root /dev/null /home/office/.ssh/authorized_keys
# What a teammate's key runs instead of a shell: hold the connection (and so their tunnel) open.
tunnel_sh=$(mktemp)
cat >"$tunnel_sh" <<'SH'
#!/bin/sh
echo "Agent Office tunnel is up: open http://localhost:4600 in your browser."
echo "Keep this window open; Ctrl-C closes it."
exec cat >/dev/null
SH
sudo install -m 755 "$tunnel_sh" /usr/local/bin/agent-office-tunnel
rm -f "$tunnel_sh"
# Adds and removes teammates' keys. deploy/aws.sh (invite/uninvite/team) and the office's own
# invite panel both go through it, and it's the only root thing the office user may run.
team_sh=$(mktemp)
cat >"$team_sh" <<'SH'
#!/bin/bash
# agent-office-team list | add <name> (public keys on stdin) | remove <name> | fingerprint
set -euo pipefail
[[ $EUID -eq 0 ]] || exec sudo -n "$0" "$@"
KEYS=/home/office/.ssh/authorized_keys
PORT=4600
cmd="${1:-}" who="${2:-}"
valid() { [[ "$who" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$ ]] || { echo "not a valid name: $who" >&2; exit 64; }; }
write() { install -m 644 -o root -g root "$1" "$KEYS"; rm -f "$1"; }
exec 9>/run/agent-office-team.lock
flock 9
case "$cmd" in
  list) awk '{print $NF}' "$KEYS" | sed -n 's/^agent-office://p' | sort | uniq -c | awk '{print $2, $1}' ;;
  add)
    valid
    # Each key may only open a tunnel to the office port: no shell, no other forwarding.
    keys=$(awk -v who="$who" -v port="$PORT" '
      $1 ~ /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)$/ &&
      $2 ~ /^[A-Za-z0-9+\/]+=*$/ {
        printf "restrict,pty,port-forwarding,permitopen=\"localhost:%s\",permitopen=\"127.0.0.1:%s\",command=\"/usr/local/bin/agent-office-tunnel\" %s %s agent-office:%s\n", port, port, $1, $2, who
      }')
    [[ -n "$keys" ]] || { echo "no SSH public keys given" >&2; exit 65; }
    tmp=$(mktemp)
    { awk -v tag="agent-office:$who" '$NF != tag' "$KEYS"; printf '%s\n' "$keys"; } >"$tmp"
    write "$tmp"
    printf '%s\n' "$keys" | wc -l ;;
  remove)
    valid
    tmp=$(mktemp)
    awk -v tag="agent-office:$who" '$NF != tag' "$KEYS" >"$tmp"
    if cmp -s "$tmp" "$KEYS"; then rm -f "$tmp"; echo "$who isn't invited" >&2; exit 66; fi
    write "$tmp"
    pkill -u office || true ;;
  fingerprint) ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | awk '{print $2}' ;;
  *) echo "usage: agent-office-team list | add <name> | remove <name> | fingerprint" >&2; exit 64 ;;
esac
SH
sudo install -m 755 -o root -g root "$team_sh" /usr/local/bin/agent-office-team
rm -f "$team_sh"
sudoers=$(mktemp)
echo "$RUN_USER ALL=(root) NOPASSWD: /usr/local/bin/agent-office-team, /usr/local/bin/agent-office-serve" >"$sudoers"
sudo visudo -cqf "$sudoers"
sudo install -m 440 -o root -g root "$sudoers" /etc/sudoers.d/agent-office
rm -f "$sudoers"
# The same limits server-side, so they hold even for a key added by hand: local forwards to the
# office port and nothing else (no shell, no -R listeners, no Unix socket forwards, no agent or X11
# forwarding).
sshd_conf=$(mktemp)
cat >"$sshd_conf" <<'CONF'
Match User office
    AllowTcpForwarding local
    PermitOpen localhost:4600 127.0.0.1:4600
    AllowStreamLocalForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    ForceCommand /usr/local/bin/agent-office-tunnel
CONF
sudo install -d -m 755 /etc/ssh/sshd_config.d
sudo install -m 644 "$sshd_conf" /etc/ssh/sshd_config.d/agent-office.conf
rm -f "$sshd_conf"
if [[ -x /usr/sbin/sshd ]]; then
  sudo /usr/sbin/sshd -t
  sudo systemctl reload ssh 2>/dev/null || sudo systemctl restart ssh 2>/dev/null || true
fi

PROXY_ARGS=""
if [[ -n "$DOMAIN" ]]; then
  step "Serving it on https://$DOMAIN (Caddy fetches the certificate)"
  if ! command -v caddy >/dev/null 2>&1; then
    quiet "${APT[@]}" install gnupg
    quiet sh -c 'curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg'
    sudo chmod go+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    quiet "${APT[@]}" update
    quiet "${APT[@]}" install caddy
  fi
  # Caddy's own sample page, or a Caddyfile this wrote before: anything else is someone's setup.
  marker="# Written by agent-office's deploy/provision.sh"
  if [[ -s /etc/caddy/Caddyfile ]] && ! grep -qF -e "$marker" -e 'root * /usr/share/caddy' /etc/caddy/Caddyfile; then
    die "/etc/caddy/Caddyfile is already set up for something else. Add this to it, then run this again without --domain:
    $DOMAIN {
        reverse_proxy 127.0.0.1:4600
    }"
  fi
  caddyfile=$(mktemp)
  printf '%s\n%s {\n    reverse_proxy 127.0.0.1:4600\n}\n' "$marker" "$DOMAIN" >"$caddyfile"
  sudo install -m 644 "$caddyfile" /etc/caddy/Caddyfile
  rm -f "$caddyfile"
  sudo systemctl enable caddy >/dev/null 2>&1
  sudo systemctl reload-or-restart caddy
  if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q '^Status: active'; then
    quiet sudo ufw allow 80/tcp
    quiet sudo ufw allow 443/tcp
  fi
  echo "$DOMAIN" | sudo tee /etc/agent-office/domain >/dev/null
  # Cookies go Secure, and sign-in limits count the visitor's address rather than Caddy's.
  PROXY_ARGS=" --trust-proxy"
fi
# Tailscale Serve is a proxy like Caddy: it says the visitor came over https, and from where.
[[ -z "$TS_HOST" ]] || PROXY_ARGS=" --trust-proxy"

step "Installing the agent-office service (restarts itself if it ever crashes)"
unit=$(mktemp)
cat >"$unit" <<UNIT
[Unit]
Description=Agent Office
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$RUN_DIR
EnvironmentFile=/etc/agent-office/env
Environment=HOME=$RUN_HOME
Environment=AGENT_OFFICE_HOME=$OFFICE_HOME
Environment=SHELL=/bin/bash
Environment=PATH=$RUN_PATH
# Lets the office upgrade itself from its UI: it builds the new version, then exits, and
# Restart=always brings it back up on that version.
Environment=AGENT_OFFICE_SELF_UPDATE=1
# Loopback only: the office is reached through an SSH tunnel (or Caddy, or Tailscale Serve), never straight from the internet.
ExecStart=/usr/bin/env node /opt/agent-office/bin/agent-office.js ${OFFICE_ARGS}--host 127.0.0.1 --port 4600${PROXY_ARGS}
Restart=always
RestartSec=3
# Stopping or restarting the office stops the office, not its workers: their terminals run in a
# process of their own that the next office picks back up. The default, control-group, would stop
# every worker mid-task on each upgrade.
KillMode=process
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
sudo install -m 644 "$unit" /etc/systemd/system/agent-office.service
rm -f "$unit"
sudo systemctl daemon-reload
sudo systemctl enable agent-office >/dev/null 2>&1
sudo systemctl restart agent-office

[[ $STANDALONE -eq 1 ]] || { step "Done"; exit 0; }

step "Waiting for the office to answer"
for _ in $(seq 60); do
  curl -fs --max-time 4 http://127.0.0.1:4600/api/health >/dev/null && break
  sleep 2
done
curl -fs --max-time 4 http://127.0.0.1:4600/api/health >/dev/null ||
  die "the office didn't come up. Its logs: sudo journalctl -u agent-office -n 50"

bold=$'\033[1m' reset=$'\033[0m'
base="http://localhost:4600"
[[ -z "$DOMAIN" ]] || base="https://$DOMAIN"
[[ -z "$TS_HOST" ]] || base="https://$TS_HOST"
if grep -qs '"claimedAt"' "${LEGACY_DIR:-$OFFICE_HOME}/.agent-office/config.json"; then
  open_line="open ${bold}$base${reset} and sign in with the office password you saved."
else
  open_line="open ${bold}$base/claim?t=$CLAIM_TOKEN${reset}
  It shows the office password ${bold}once${reset}: write it down."
fi
echo
echo "  🏢 Agent Office is running, as $RUN_USER, on 127.0.0.1:4600 only."
echo
if [[ -n "$DOMAIN" ]]; then
  echo "  Now $open_line"
  echo "  ($DOMAIN has to point at this server, with ports 80 and 443 open, for Caddy to get its certificate.)"
elif [[ -n "$TS_HOST" ]]; then
  echo "  From any device on your tailnet, $open_line"
  echo
  echo "  Teammates: add them to your tailnet, or share this machine with them from Tailscale's"
  echo "  Machines page (👥 Invite teammates in the office's ☰ menu says how)."
  echo "  Tailscale expires this machine's key in 180 days: turn that off on the Machines page"
  echo "  (⋯ → Disable key expiry), or the office drops off your tailnet."
else
  echo "  On your computer, open a tunnel and leave it running:"
  echo
  echo "    ${bold}ssh -N -L 4600:localhost:4600 ${SUDO_USER:-$(id -un)}@$PUBLIC_HOST${reset}"
  echo
  echo "  then $open_line"
  echo
  echo "  Teammates: 👥 Invite teammates in the office's ☰ menu lets their SSH keys open the same tunnel."
fi
echo "  Update: run this again, or ⬆️ Upgrade the office from its ☰ menu."
echo
