#!/usr/bin/env bash
# Runs ON the EC2 instance (piped over ssh by deploy/aws.sh). Idempotent: safe to re-run.
# Expects these to be exported by the caller: APP_REPO APP_REF PROJECT_REPO PROJECT_NAME
# CLAIM_TOKEN PUBLIC_HOST GH_TOKEN CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY GIT_NAME GIT_EMAIL
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
APT=(sudo -E apt-get -y -q -o DPkg::Lock::Timeout=600)

step() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
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

step "Waiting for the instance to finish booting"
sudo cloud-init status --wait >/dev/null 2>&1 || true

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  step "Installing Node.js 22"
  quiet bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -'
  quiet "${APT[@]}" install nodejs
fi

step "Installing git, GitHub CLI and build tools"
quiet "${APT[@]}" update
quiet "${APT[@]}" install git gh curl ca-certificates build-essential python3

if [[ ! -x "$HOME/.local/bin/claude" ]]; then
  step "Installing Claude Code"
  quiet bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
fi
export PATH="$HOME/.local/bin:$PATH"
echo "    claude $(claude --version 2>/dev/null | head -1)"

step "Writing secrets to /etc/agent-office/env"
sudo install -d -m 755 /etc/agent-office
env_file=$(mktemp)
{
  printf 'AGENT_OFFICE_CLAIM_TOKEN="%s"\n' "$CLAIM_TOKEN"
  # The address teammates SSH to, so the office can show them the tunnel command.
  [[ -n "${PUBLIC_HOST:-}" ]] && printf 'AGENT_OFFICE_PUBLIC_HOST="%s"\n' "$PUBLIC_HOST"
  [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]] && printf 'CLAUDE_CODE_OAUTH_TOKEN="%s"\n' "$CLAUDE_CODE_OAUTH_TOKEN"
  [[ -n "${ANTHROPIC_API_KEY:-}" ]] && printf 'ANTHROPIC_API_KEY="%s"\n' "$ANTHROPIC_API_KEY"
  true
} >"$env_file"
sudo install -m 600 -o root -g root "$env_file" /etc/agent-office/env
rm -f "$env_file"

if [[ -n "${GH_TOKEN:-}" ]]; then
  step "Signing the GitHub CLI in"
  # Stored in gh's own config, so gh, git (via gh's credential helper), the office's boards, the
  # workers and your ssh sessions all use it — and the token never lands in a .git/config.
  printf '%s' "$GH_TOKEN" | quiet env -u GH_TOKEN gh auth login --hostname github.com --git-protocol https --with-token
  quiet env -u GH_TOKEN gh auth setup-git --hostname github.com
  echo "    $(env -u GH_TOKEN gh api user --jq '"as " + .login' 2>/dev/null || echo 'signed in')"
fi
[[ -n "${GIT_NAME:-}" ]] && git config --global user.name "$GIT_NAME"
[[ -n "${GIT_EMAIL:-}" ]] && git config --global user.email "$GIT_EMAIL"
git config --global init.defaultBranch main

step "Installing agent-office ($APP_REF) from $APP_REPO"
sudo install -d -o "$USER" -g "$USER" /opt/agent-office
if [[ -d /opt/agent-office/.git ]]; then
  quiet git -C /opt/agent-office fetch --depth 1 origin "$APP_REF"
  quiet git -C /opt/agent-office reset --hard FETCH_HEAD
else
  quiet git clone --depth 1 --branch "$APP_REF" "$APP_REPO" /opt/agent-office
fi
echo "    at $(git -C /opt/agent-office log -1 --format='%h %s')"
step "npm install (builds the office)"
(cd /opt/agent-office && quiet npm install --no-audit --no-fund)

WORKDIR="$HOME/workspace/$PROJECT_NAME"
mkdir -p "$HOME/workspace"
if [[ ! -d "$WORKDIR" ]]; then
  if [[ -n "$PROJECT_REPO" ]]; then
    step "Cloning your project $PROJECT_REPO"
    quiet git clone "$PROJECT_REPO" "$WORKDIR"
  else
    step "Creating an empty project at $WORKDIR"
    mkdir -p "$WORKDIR"
    git -C "$WORKDIR" init -q
  fi
fi
echo "$WORKDIR" | sudo tee /etc/agent-office/dir >/dev/null

step "Pre-accepting Claude Code onboarding and folder trust"
node - "$WORKDIR" <<'NODE'
const fs = require('fs');
const file = `${process.env.HOME}/.claude.json`;
let c = {};
try { c = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
c.hasCompletedOnboarding = true;
c.projects = c.projects || {};
const dir = process.argv[2];
c.projects[dir] = { ...(c.projects[dir] || {}), hasTrustDialogAccepted: true };
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
echo "$USER ALL=(root) NOPASSWD: /usr/local/bin/agent-office-team" >"$sudoers"
sudo visudo -cqf "$sudoers"
sudo install -m 440 -o root -g root "$sudoers" /etc/sudoers.d/agent-office
rm -f "$sudoers"
# The same limits server-side, so they hold even for a key added by hand: local forwards to the
# office port and nothing else (no shell, no -R listeners, no agent or X11 forwarding).
sshd_conf=$(mktemp)
cat >"$sshd_conf" <<'CONF'
Match User office
    AllowTcpForwarding local
    PermitOpen localhost:4600 127.0.0.1:4600
    AllowAgentForwarding no
    X11Forwarding no
    ForceCommand /usr/local/bin/agent-office-tunnel
CONF
sudo install -m 644 "$sshd_conf" /etc/ssh/sshd_config.d/agent-office.conf
rm -f "$sshd_conf"
sudo sshd -t
sudo systemctl reload ssh 2>/dev/null || sudo systemctl restart ssh

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
User=$USER
Group=$USER
WorkingDirectory=$WORKDIR
EnvironmentFile=/etc/agent-office/env
Environment=HOME=$HOME
Environment=SHELL=/bin/bash
Environment=PATH=$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Lets the office upgrade itself from its UI: it builds the new version, then exits, and
# Restart=always brings it back up on that version.
Environment=AGENT_OFFICE_SELF_UPDATE=1
# Loopback only: the office is reached through an SSH tunnel, never from the internet.
ExecStart=/usr/bin/node /opt/agent-office/bin/agent-office.js $WORKDIR --host 127.0.0.1 --port 4600
Restart=always
RestartSec=3
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
sudo install -m 644 "$unit" /etc/systemd/system/agent-office.service
rm -f "$unit"
sudo systemctl daemon-reload
sudo systemctl enable agent-office >/dev/null 2>&1
sudo systemctl restart agent-office

step "Done"
