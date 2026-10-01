#!/usr/bin/env bash
# Starts the office in its container (deploy/container/Dockerfile): sshd on port 22, then the
# office as agentoffice on 127.0.0.1:4600.
#
# Everything that has to outlive a restart or a redeploy lives on the volume at /data:
#   /data/home   agentoffice's home: the office's data in ~/agent-office (password, accounts, floors,
#                chat, per-account sign-ins), the projects in ~/workspace, Claude Code and its sign-in
#                (~/.local, ~/.claude, ~/.claude.json), the GitHub CLI's (~/.config/gh), ~/.gitconfig
#   /data/ssh    the SSH host key, so ssh keeps trusting the office after a redeploy
#   /data/team   teammates' keys (office's authorized_keys), from 👥 Invite teammates
set -euo pipefail
DATA=/data
RUN_USER=agentoffice
RUN_HOME=$DATA/home
RUN_PATH=$RUN_HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

AS_USER=(setpriv --reuid=$RUN_USER --regid=$RUN_USER --init-groups
  env HOME=$RUN_HOME USER=$RUN_USER LOGNAME=$RUN_USER SHELL=/bin/bash PATH="$RUN_PATH")

say() { echo "agent-office-container: $*"; }

mountpoint -q $DATA || say "nothing is mounted on $DATA: the office forgets everything when this container goes"
# sshd refuses keys under a directory others can write to.
install -d -m 755 -o root -g root $DATA $DATA/team
install -d -m 700 -o root -g root $DATA/ssh
[[ -f $DATA/team/authorized_keys ]] || install -m 644 -o root -g root /dev/null $DATA/team/authorized_keys
if [[ ! -f $DATA/ssh/ssh_host_ed25519_key ]]; then
  say "making the SSH host key (first start)"
  ssh-keygen -q -t ed25519 -N '' -C agent-office -f $DATA/ssh/ssh_host_ed25519_key
fi
install -m 600 $DATA/ssh/ssh_host_ed25519_key /etc/ssh/ssh_host_ed25519_key
install -m 644 $DATA/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ed25519_key.pub
install -d -m 755 /etc/agent-office
printf '%s\n' "${AGENT_OFFICE_ADMIN_KEYS:-}" >/etc/agent-office/admin_keys
chmod 644 /etc/agent-office/admin_keys
unset AGENT_OFFICE_ADMIN_KEYS

install -d -m 755 -o $RUN_USER -g $RUN_USER $RUN_HOME
for f in .bashrc .profile; do
  [[ -e $RUN_HOME/$f ]] || install -m 644 -o $RUN_USER -g $RUN_USER /etc/skel/$f $RUN_HOME/$f
done
cd $RUN_HOME

# The address teammates SSH to: Railway's TCP proxy in front of port 22 (host:port). deploy/fly.sh
# sets it itself: the app's IPv4 address and its port.
if [[ -z "${AGENT_OFFICE_PUBLIC_HOST:-}" && -n "${RAILWAY_TCP_PROXY_DOMAIN:-}" && -n "${RAILWAY_TCP_PROXY_PORT:-}" ]]; then
  export AGENT_OFFICE_PUBLIC_HOST=$RAILWAY_TCP_PROXY_DOMAIN:$RAILWAY_TCP_PROXY_PORT
fi
# On Fly.io, port 22 is Fly's own SSH server (`fly ssh console`), so deploy/fly.sh moves this one.
SSHD_PORT=${AGENT_OFFICE_SSHD_PORT:-22}
[[ "$SSHD_PORT" =~ ^[0-9]+$ ]] || SSHD_PORT=22

mkdir -p /run/sshd
/usr/sbin/sshd -t
# Brought back if it ever dies, so the tunnels keep working.
(while :; do /usr/sbin/sshd -D -e -p "$SSHD_PORT"; sleep 2; done) &
say "sshd is listening on port $SSHD_PORT${AGENT_OFFICE_PUBLIC_HOST:+ (reached at $AGENT_OFFICE_PUBLIC_HOST)}"

if [[ ! -x $RUN_HOME/.local/bin/claude ]]; then
  say "installing Claude Code in $RUN_HOME/.local (first start)"
  "${AS_USER[@]}" bash -c 'curl -fsSL https://claude.ai/install.sh | bash' >/dev/null ||
    say "couldn't install Claude Code; it's tried again at the next start"
fi
"${AS_USER[@]}" mkdir -p $RUN_HOME/workspace
# Once: after that, the folder is the admins' to move in ⚙️ Settings.
if [[ ! -f $RUN_HOME/agent-office/.agent-office/projects-folder.json ]]; then
  "${AS_USER[@]}" node /opt/agent-office/bin/agent-office.js setup --projects $RUN_HOME/workspace </dev/null
fi
"${AS_USER[@]}" node /usr/local/lib/agent-office/onboard.js $RUN_HOME/workspace

exec "${AS_USER[@]}" node /opt/agent-office/bin/agent-office.js --host 127.0.0.1 --port 4600 --no-open
