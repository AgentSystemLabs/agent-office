#!/usr/bin/env bash
# Install the latest Agent Office release and start it, no clone needed:
#
#   curl -fsSL https://raw.githubusercontent.com/nikships/droid-office/main/install.sh | bash
#
# Anything after `bash -s --` goes to the office, e.g. a port:
#
#   curl -fsSL https://raw.githubusercontent.com/nikships/droid-office/main/install.sh | bash -s -- --port 4700
#
# The first time the office starts in a terminal it asks where to clone your projects, offers to
# sign the GitHub (gh) or GitLab (glab) CLI in if neither is, and lets you pick your first
# repository to clone as a floor.
#
# Releases go in ~/.local/share/droid-office and an `droid-office` command in ~/.local/bin, so
# afterwards `droid-office` starts it too. Run the curl line again to update to the newest release.
#
# Environment:
#   AGENT_OFFICE_VERSION       install this release (a tag like v0.1.68) instead of the newest
#   AGENT_OFFICE_INSTALL_DIR   where releases go (default ~/.local/share/droid-office)
#   AGENT_OFFICE_BIN_DIR       where the `droid-office` command goes (default ~/.local/bin; empty: none)
#   AGENT_OFFICE_INSTALL_ONLY  1: install, but don't start the office
#   AGENT_OFFICE_TARBALL       install this release tarball (a local file) instead of downloading one
set -euo pipefail

REPO="nikships/droid-office"
MARKER="droid-office launcher, written by install.sh"
INSTALL_DIR="${AGENT_OFFICE_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/droid-office}"
VERSIONS="$INSTALL_DIR/versions"
BIN_DIR="${AGENT_OFFICE_BIN_DIR-$HOME/.local/bin}"
STAGE=""
TAG=""
LAUNCHER=""

if [ -t 2 ]; then BOLD=$'\033[1m' CYAN=$'\033[1;36m' YELLOW=$'\033[1;33m' RED=$'\033[1;31m' RESET=$'\033[0m'
else BOLD="" CYAN="" YELLOW="" RED="" RESET=""; fi
step() { printf '%s==>%s %s\n' "$CYAN" "$RESET" "$*" >&2; }
warn() { printf '%swarning:%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() { printf '%sdroid-office:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
# Single-quotes a string for a shell script.
sq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

cleanup() {
  if [ -n "$STAGE" ] && [ -d "$STAGE" ]; then rm -rf "$STAGE"; fi
}

check_requirements() {
  case "$(uname -s)" in
    Darwin | Linux) ;;
    *) die "Agent Office runs on macOS and Linux. On Windows, run this inside WSL." ;;
  esac
  have node || die "Agent Office needs Node.js 20 or newer. Get it from https://nodejs.org (or nvm), then run this again."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] || die "Agent Office needs Node.js 20 or newer, and this is $(node -v). Update it, then run this again."
  have npm || die "Agent Office needs npm, which comes with Node.js."
  have curl || die "this needs curl."
  have tar || die "this needs tar."
  have git || warn "git isn't installed. The office needs it for projects and worker worktrees."
  if ! have claude && ! have opencode && ! have codex && ! have droid; then
    warn "no Claude Code, OpenCode, Codex or Droid CLI found on your PATH. Workers need one of them, e.g."
    warn "  curl -fsSL https://claude.ai/install.sh | bash"
  fi
}

# The newest release's tag, from where github.com/<repo>/releases/latest redirects (no API rate limit).
latest_tag() {
  local url
  url="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" 2>/dev/null)" || return 0
  case "$url" in
    */releases/tag/*) printf '%s' "${url##*/releases/tag/}" ;;
  esac
}

valid_tag() {
  [[ "$1" =~ ^v[0-9][0-9A-Za-z._+-]*$ ]]
}

# Unpacks a release tarball into $VERSIONS/<tag> and installs its dependencies. Everything happens in
# a scratch directory first, so a failed or interrupted install never leaves a broken version behind.
# Sets TAG (read from the tarball when it isn't known yet).
install_release() {
  local tag="$1" tarball="$2" dest
  mkdir -p "$VERSIONS"
  STAGE="$(mktemp -d "$VERSIONS/.install.XXXXXX")"
  if [ -n "$tarball" ]; then
    cp "$tarball" "$STAGE/droid-office.tgz"
  else
    step "Downloading Agent Office $tag"
    curl -fSL --progress-bar -o "$STAGE/droid-office.tgz" "https://github.com/$REPO/releases/download/$tag/droid-office.tgz" ||
      die "couldn't download release $tag (is that a release of https://github.com/$REPO/releases ?)"
  fi
  tar -xzf "$STAGE/droid-office.tgz" -C "$STAGE" || die "that isn't a release tarball"
  [ -f "$STAGE/package/bin/droid-office.js" ] || die "that release tarball doesn't contain Agent Office"
  if [ -z "$tag" ]; then tag="v$(node -p 'require(process.argv[1]).version' "$STAGE/package/package.json")"; fi
  valid_tag "$tag" || die "not a release version: $tag"
  dest="$VERSIONS/$tag"
  if [ ! -f "$dest/.installed" ]; then
    step "Installing Agent Office $tag"
    # Exactly the dependency versions the release was tested with (its npm-shrinkwrap.json).
    # The repo's .npmrc (legacy-peer-deps) isn't in the tarball, so its peer policy is passed here.
    (cd "$STAGE/package" && npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund --loglevel=error >&2) ||
      die "npm couldn't install Agent Office's dependencies (see above)"
    touch "$STAGE/package/.installed"
    # Another run may have installed the same version meanwhile; either copy will do.
    if [ ! -e "$dest" ]; then mv "$STAGE/package" "$dest"
    elif [ ! -f "$dest/.installed" ]; then die "$dest is in the way; remove it and run this again"; fi
  fi
  rm -rf "$STAGE"
  STAGE=""
  TAG="$tag"
}

# Removes the versions this install replaced, except any still running: an office, or the terminal
# host that keeps its workers alive across office restarts. Without pgrep nothing is removed.
prune_versions() {
  local keep="$1" dir real rc
  have pgrep || return 0
  for dir in "$VERSIONS"/v*; do
    [ -d "$dir" ] && [ "${dir##*/}" != "$keep" ] || continue
    real="$(cd "$dir" && pwd -P)"
    rc=0
    pgrep -f -- "$dir/" >/dev/null 2>&1 || rc=$?
    [ "$rc" -eq 1 ] || continue
    rc=0
    pgrep -f -- "$real/" >/dev/null 2>&1 || rc=$?
    [ "$rc" -eq 1 ] || continue
    rm -rf "$dir"
  done
}

# Puts an `droid-office` command on the PATH that starts this version.
write_launcher() {
  local tag="$1" entry="$2" target tmp
  [ -n "$BIN_DIR" ] || return 0
  target="$BIN_DIR/droid-office"
  if [ -e "$target" ] && ! grep -q "$MARKER" "$target" 2>/dev/null; then
    warn "left $target alone: this script didn't write it"
    return 0
  fi
  mkdir -p "$BIN_DIR"
  tmp="$target.tmp.$$"
  cat >"$tmp" <<EOF
#!/bin/sh
# $MARKER (https://github.com/$REPO).
# Starts Agent Office $tag. To update, run the install command again:
#   curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash
exec node $(sq "$entry") "\$@"
EOF
  chmod 755 "$tmp"
  mv -f "$tmp" "$target"
  case ":$PATH:" in
    *":$BIN_DIR:"*) LAUNCHER="droid-office" ;;
    *)
      LAUNCHER="$target"
      warn "$BIN_DIR isn't on your PATH. Add it to run ${BOLD}droid-office${RESET} directly next time."
      ;;
  esac
}

main() {
  trap cleanup EXIT
  check_requirements

  local tag="" tarball="${AGENT_OFFICE_TARBALL:-}" installed=""
  [ -f "$INSTALL_DIR/current" ] && installed="$(cat "$INSTALL_DIR/current")"
  if [ -n "$tarball" ]; then
    [ -f "$tarball" ] || die "no such file: $tarball"
  elif [ -n "${AGENT_OFFICE_VERSION:-}" ]; then
    tag="v${AGENT_OFFICE_VERSION#v}"
  else
    tag="$(latest_tag)"
    if [ -z "$tag" ]; then
      if [ -n "$installed" ] && [ -f "$VERSIONS/$installed/.installed" ]; then
        warn "couldn't reach GitHub to look for a newer release; starting the installed $installed"
        tag="$installed"
      else
        die "couldn't find the latest release at https://github.com/$REPO/releases"
      fi
    fi
  fi
  if [ -n "$tag" ]; then valid_tag "$tag" || die "not a release version: $tag"; fi

  if [ -n "$tarball" ] || [ ! -f "$VERSIONS/$tag/.installed" ]; then
    install_release "$tag" "$tarball"
    tag="$TAG"
  fi
  printf '%s\n' "$tag" >"$INSTALL_DIR/current"
  prune_versions "$tag"

  local entry="$VERSIONS/$tag/bin/droid-office.js"
  write_launcher "$tag" "$entry"

  if [ "${AGENT_OFFICE_INSTALL_ONLY:-}" = 1 ]; then
    step "Agent Office $tag is installed. Start it with: ${LAUNCHER:-node $entry}"
    return 0
  fi
  step "Starting Agent Office $tag"
  # Piped into bash (curl … | bash), stdin is the rest of this script: give the office the terminal
  # instead, so its first-run walkthrough can ask where projects go and which one to start with.
  if [ ! -t 0 ] && [ -t 1 ] && (: </dev/tty) 2>/dev/null; then exec node "$entry" "$@" </dev/tty; fi
  exec node "$entry" "$@"
}

main "$@"
