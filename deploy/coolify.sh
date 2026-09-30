#!/usr/bin/env bash
# Deploy your own Agent Office to a Coolify server with one command, using Coolify's API.
#
#   deploy/coolify.sh up --url https://coolify.example.com   create the office, build it, open it
#   deploy/coolify.sh open                                   tunnel to the office and open it
#   deploy/coolify.sh destroy                                delete it and its volume (asks first)
#
# The office is never on the internet: it listens on 127.0.0.1 in its container, and everyone
# reaches it through an SSH tunnel to the container's sshd, published on one port of the server
# Coolify runs it on (2222 unless you pick another). What it keeps (accounts, floors, projects,
# sign-ins, teammates' keys, the SSH host key) is on a Docker volume at /data, so restarts and
# redeploys lose none of it. Coolify only builds from git, so it builds deploy/container/Dockerfile
# from a commit you've pushed: this checkout's HEAD, from a public repository (its upstream).
# Run `deploy/coolify.sh help` for all commands and options.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NAME="agent-office"
URL_ARG="${COOLIFY_URL:-}"
TOKEN_ARG="${COOLIFY_API_TOKEN:-}"
unset COOLIFY_API_TOKEN # nothing this runs needs it: curl reads the token from a file
SERVER_ARG=""
REPO_ARG=""
BRANCH_ARG=""
SSH_HOST_ARG=""
SSH_PORT_ARG=""
GH_TOKEN_ARG=""
NO_GH_TOKEN=0
CLAUDE_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"
ANTHROPIC_KEY=""
YES=0
NO_OPEN=0
DOCKERFILE="deploy/container/Dockerfile"
DEFAULT_SSH_PORT=2222  # the port on the server that leads to the container's sshd
SSH_USER="agentoffice" # your key's shell in the container: the user that runs the office
TEAM_USER="office"     # teammates' keys log in as this user, which can only tunnel to the office
OFFICE_PORT=4600       # where the office listens in the container (127.0.0.1 only)
LOCAL_PORT=4600
LOCAL_PORT_SET=0
TOKEN_HELP="make one in Coolify (Keys & Tokens → API tokens) with read, write and deploy, and run this again with COOLIFY_API_TOKEN=<token>"

usage() {
  cat <<'EOF'
Agent Office on Coolify: one command up, one command down.

Usage: deploy/coolify.sh <command> [options]

The office is never on the internet. It listens on 127.0.0.1 in its container, and everyone reaches
it through an SSH tunnel on http://localhost:4600, to the container's sshd on one port of the server
Coolify runs it on. Accounts, floors, projects, sign-ins and teammates' keys live on a Docker volume,
so they survive restarts and redeploys.

Coolify builds from git, never from your local files: it builds this checkout's HEAD, which has to
be pushed to its upstream branch (or to --repo and --branch), in a public repository.

The first `up` needs your Coolify's address and an API token with read, write and deploy (Coolify:
Keys & Tokens → API tokens), and API Access turned on (Settings → Configuration → Advanced). Both are
remembered for this office after that.

Commands
  up                 Create (or reuse) the Coolify project and application, have Coolify build this
                     checkout's HEAD (pushed), start the office, then open it in your browser. The
                     first page shows the office password ONCE.
  open               Tunnel to your office and open it in the browser (Ctrl-C closes the tunnel)
  update             Have Coolify build this checkout's HEAD (pushed) and redeploy it (running
                     workers stop, and come back where they left off)
  restart            Restart the office in a new container, without rebuilding it
  destroy            Delete the office's application and its volume, and the project if nothing
                     else is in it (asks you to type the office name first). `down` does the same.

  service <port>     Open a worker's web server from the office's 🌐 Services board on
                     http://localhost:<port> (through the office; Ctrl-C closes the tunnel)
  invite <gh-user>   Let a teammate tunnel in with the SSH keys on their GitHub account, and
                     print the one command to send them. Or: invite <name> <public-key-file>
  uninvite <name>    Remove a teammate's keys and drop open tunnels
  team               List who is invited
  status             Show the application, the last deployment, the SSH address and whether the
                     office is up
  ssh                A shell in the container, as the user that runs the office
  logs               Follow the office's logs
  reset-password     Forget the password and show a new one once in your browser

Options
  --name <name>             Office name (default: agent-office). Several offices = several projects
  --url <url>               Your Coolify, like https://coolify.example.com (default: $COOLIFY_URL).
                            The API token comes from $COOLIFY_API_TOKEN, or `up` asks for it.
  --server <name|uuid>      The server to run the office on, when Coolify has more than one
  --repo <url|remote>       The public repository Coolify builds from (default: the upstream of
                            this checkout's branch)
  --branch <branch>         Its branch, which has to have HEAD on it (default: the upstream branch)
  --ssh-port <n>            Port on the server that leads to the office's SSH (default: 2222)
  --ssh-host <host>         Address you and teammates SSH to (default: the server's IP in Coolify,
                            or your Coolify's own address for the server Coolify runs on)
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
# suggests `deploy/coolify.sh --name <name> service <port>`).
CMD=""
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name | --url | --server | --repo | --branch | --ssh-port | --ssh-host | --port | --github-token | --claude-token | --anthropic-api-key)
      [[ $# -ge 2 ]] || die "$1 needs a value (see: deploy/coolify.sh help)" ;;
  esac
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --url) URL_ARG="$2"; shift 2 ;;
    --server) SERVER_ARG="$2"; shift 2 ;;
    --repo) REPO_ARG="$2"; shift 2 ;;
    --branch) BRANCH_ARG="$2"; shift 2 ;;
    --ssh-port) SSH_PORT_ARG="$2"; shift 2 ;;
    --ssh-host) SSH_HOST_ARG="$2"; shift 2 ;;
    --port) LOCAL_PORT="$2"; LOCAL_PORT_SET=1; shift 2 ;;
    --github-token) GH_TOKEN_ARG="$2"; shift 2 ;;
    --no-github-token) NO_GH_TOKEN=1; shift ;;
    --claude-token) CLAUDE_TOKEN="$2"; shift 2 ;;
    --anthropic-api-key) ANTHROPIC_KEY="$2"; shift 2 ;;
    --no-open) NO_OPEN=1; shift ;;
    -y | --yes) YES=1; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) die "unknown option $1 (see: deploy/coolify.sh help)" ;;
    *)
      if [[ -z "$CMD" ]]; then CMD="$1"; else POSITIONAL+=("$1"); fi
      shift
      ;;
  esac
done
CMD="${CMD:-help}"

# Coolify names projects with 3 characters or more.
[[ "$NAME" =~ ^[a-zA-Z0-9-]{3,}$ ]] || die "--name is 3 or more letters, numbers and dashes"
[[ "$LOCAL_PORT" =~ ^[0-9]+$ && $LOCAL_PORT -gt 0 && $LOCAL_PORT -lt 65536 ]] || die "--port must be a port number"
[[ -z "$SSH_PORT_ARG" || ("$SSH_PORT_ARG" =~ ^[0-9]+$ && $SSH_PORT_ARG -gt 0 && $SSH_PORT_ARG -lt 65536) ]] || die "--ssh-port must be a port number"
# The server's own SSH, and the ports Coolify's proxy takes on every server.
case "$SSH_PORT_ARG" in
  22 | 80 | 443 | 8080) die "port $SSH_PORT_ARG is taken on a Coolify server (its SSH or Coolify's proxy): pick another --ssh-port" ;;
esac
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/agent-office/coolify/$NAME"
NAME_FLAG=""
[[ "$NAME" != "agent-office" ]] && NAME_FLAG=" --name $NAME"
KEY_FILE="$STATE_DIR/id_ed25519"
KNOWN_HOSTS="$STATE_DIR/known_hosts"
CLAIM_FILE="$STATE_DIR/claim-token"
TOKEN_FILE="$STATE_DIR/api-token" # "Authorization: Bearer <token>", read by curl -H @file so the token stays out of ps
IDS_FILE="$STATE_DIR/coolify.env"  # COOLIFY_URL PROJECT_UUID ENVIRONMENT_UUID APP_UUID SERVER_UUID VOLUME_NAME SSH_HOST SSH_PORT
COOLIFY_URL="" PROJECT_UUID="" ENVIRONMENT_UUID="" APP_UUID="" SERVER_UUID="" VOLUME_NAME="" SSH_HOST="" SSH_PORT=""
REPO_URL="" GIT_BRANCH="" COMMIT="" PUSH_TO="" # what Coolify builds (resolve_source)
COOLIFY_VERSION=""

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required (${2:-install it first})"; }

# Evaluates a JavaScript expression over the JSON on stdin (as j) and prints the result: json 'j.id'
json() {
  node -e 'let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const v = new Function("j", `return (${process.argv[1]})`)(JSON.parse(s));
      if (v !== undefined && v !== null) console.log(typeof v === "object" ? JSON.stringify(v) : String(v));
    });' "$1"
}

# Prints the JSON a JavaScript expression makes of the other arguments (as v[0], v[1]…). They go to
# node through its environment, so tokens never show in ps: mkjson '({id: v[0]})' "$ID"
mkjson() {
  local expr="$1" i=0 v
  shift
  (
    for v in "$@"; do
      export "J$i=$v"
      i=$((i + 1))
    done
    node -e 'const v = [];
      for (let i = 0; process.env["J" + i] !== undefined; i++) v.push(process.env["J" + i]);
      console.log(JSON.stringify(new Function("v", `return (${process.argv[1]})`)(v)));' "$expr"
  )
}

load_ids() {
  # shellcheck disable=SC1090
  [[ -f "$IDS_FILE" ]] && source "$IDS_FILE"
  [[ -z "$URL_ARG" ]] || COOLIFY_URL="$URL_ARG"
  if [[ -n "$COOLIFY_URL" ]]; then
    [[ "$COOLIFY_URL" =~ ^https?:// ]] || COOLIFY_URL="https://$COOLIFY_URL"
    COOLIFY_URL="${COOLIFY_URL%/}"
    COOLIFY_URL="${COOLIFY_URL%/api/v1}"
  fi
  return 0
}

save_ids() {
  printf 'COOLIFY_URL=%q PROJECT_UUID=%q ENVIRONMENT_UUID=%q APP_UUID=%q SERVER_UUID=%q VOLUME_NAME=%q SSH_HOST=%q SSH_PORT=%q\n' \
    "$COOLIFY_URL" "$PROJECT_UUID" "$ENVIRONMENT_UUID" "$APP_UUID" "$SERVER_UUID" "$VOLUME_NAME" "$SSH_HOST" "$SSH_PORT" >"$IDS_FILE"
}

preflight() {
  need ssh
  need curl
  need node "https://nodejs.org"
  load_ids
}

require_office() {
  [[ -n "$APP_UUID" && -n "$SSH_HOST" && -n "$SSH_PORT" ]] ||
    die "no office named \"$NAME\" on Coolify: run deploy/coolify.sh up --url <your Coolify>$NAME_FLAG"
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

# --- the commit Coolify builds -----------------------------------------------------------------------

# git the way Coolify runs it: no credentials and no prompts.
anon_git() { GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true SSH_ASKPASS=true git -c credential.helper= "$@"; }

# A repository as anyone can clone it: over https, without the user name or token a remote may carry
# (git@github.com:o/r.git and ssh://git@github.com/o/r.git become https://github.com/o/r.git).
public_url() {
  sed -E -e 's#^[A-Za-z0-9._-]+@([^:/]+):/*#https://\1/#' -e 's#^ssh://([^@/]+@)?([^:/]+)(:[0-9]+)?/#https://\2/#' \
    -e 's#^(https?://)[^@/]+@#\1#' <<<"$1"
}

# How Coolify keeps a repository once it has made the application: one on github.com as owner/repo
# (it clones those through its GitHub source), any other as its URL. Updates take it as it is kept.
coolify_repo() { sed -E 's#^https?://github\.com/([^/]+)/([^/]+).*$#\1/\2#' <<<"$REPO_URL"; }

# Coolify can't take an upload: it clones a repository, without signing in, and checks a commit out.
# So it builds this checkout's HEAD, which has to be on that repository's branch already: --repo and
# --branch, or else this branch's upstream. Sets REPO_URL, GIT_BRANCH, COMMIT and PUSH_TO.
resolve_source() {
  need git
  git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1 || die "run this from a git clone of agent-office (Coolify builds a commit of it)"
  local cur remote="" url tip short
  COMMIT=$(git -C "$REPO_DIR" rev-parse HEAD)
  short="${COMMIT:0:7}"
  cur=$(git -C "$REPO_DIR" symbolic-ref -q --short HEAD || true)
  if [[ -n "$cur" ]]; then
    remote=$(git -C "$REPO_DIR" config "branch.$cur.remote" || true)
    [[ "$remote" != "." ]] || remote=""
  fi
  if [[ -n "$REPO_ARG" ]]; then
    # A remote's name, or a URL.
    if url=$(git -C "$REPO_DIR" remote get-url "$REPO_ARG" 2>/dev/null); then PUSH_TO="$REPO_ARG"; else url="$REPO_ARG" PUSH_TO="$REPO_ARG"; fi
  elif [[ -n "$remote" ]]; then
    url=$(git -C "$REPO_DIR" remote get-url "$remote") PUSH_TO="$remote"
  else
    die "Coolify builds pushed commits, and ${cur:-HEAD} has no upstream: push it (git push -u origin ${cur:-HEAD:<branch>}), or pass --repo <url> --branch <branch>"
  fi
  GIT_BRANCH="$BRANCH_ARG"
  if [[ -z "$GIT_BRANCH" ]]; then
    GIT_BRANCH=$(git -C "$REPO_DIR" config "branch.$cur.merge" 2>/dev/null || true)
    GIT_BRANCH="${GIT_BRANCH#refs/heads/}"
    GIT_BRANCH="${GIT_BRANCH:-$cur}"
  fi
  [[ -n "$GIT_BRANCH" ]] || die "which branch should Coolify build? HEAD isn't on one here: pass --branch <branch>"
  REPO_URL=$(public_url "$url")

  # Asked the way Coolify will ask: a repository that needs signing in stops here, not in the build.
  tip=$(anon_git -C "$REPO_DIR" ls-remote "$REPO_URL" "refs/heads/$GIT_BRANCH" 2>/dev/null) ||
    die "couldn't read $REPO_URL without signing in, and neither can Coolify: it builds public repositories only (a public fork works: --repo <its https URL>)"
  tip="${tip%%[[:space:]]*}"
  [[ -n "$tip" ]] || die "$REPO_URL has no branch $GIT_BRANCH: push it first (git push $PUSH_TO HEAD:$GIT_BRANCH)"
  if [[ "$tip" != "$COMMIT" ]]; then
    git -C "$REPO_DIR" cat-file -e "$tip^{commit}" 2>/dev/null ||
      anon_git -C "$REPO_DIR" fetch -q --no-tags "$REPO_URL" "refs/heads/$GIT_BRANCH" 2>/dev/null || true
    git -C "$REPO_DIR" merge-base --is-ancestor "$COMMIT" "$tip" 2>/dev/null ||
      die "HEAD ($short) isn't on $GIT_BRANCH at $REPO_URL, and Coolify only builds pushed commits: push it (git push $PUSH_TO HEAD:$GIT_BRANCH), then run this again"
  fi
  [[ -z "$(git -C "$REPO_DIR" status --porcelain)" ]] || warn "your uncommitted changes aren't in it: Coolify builds commit $short as it was pushed"
}

# --- Coolify -----------------------------------------------------------------------------------------

# Calls Coolify's API: api <METHOD> <path under /api/v1> [JSON body]
# Prints the answer. On an error it says what Coolify said (on stderr) and fails: with 4 when what
# was asked for isn't there (saying nothing), 3 when Coolify turned it down for now (400), 2 when it
# refused the token, 5 when this Coolify's API has no such route, 1 otherwise.
api() {
  local method="$1" path="$2" body="${3:-}" out code msg
  local args=(-sS --max-time 120 -X "$method" -H @"$TOKEN_FILE" -H 'Accept: application/json' -w '\n%{http_code}')
  [[ -z "$body" ]] || args+=(-H 'Content-Type: application/json' --data-binary @-)
  out=$(printf '%s' "$body" | curl "${args[@]}" "$COOLIFY_URL/api/v1$path" 2>&1) ||
    { warn "couldn't reach Coolify at $COOLIFY_URL: $(head -n 1 <<<"$out")"; return 1; }
  code="${out##*$'\n'}"
  out="${out%$'\n'*}"
  if [[ "$code" == 2?? ]]; then
    printf '%s\n' "$out"
    return 0
  fi
  msg=$(json 'j.message' <<<"$out" 2>/dev/null) || msg=""
  case "$code" in
    404)
      [[ "$msg" == "Not found." ]] || return 4
      warn "Coolify's API at $COOLIFY_URL has no $method $path (is it Coolify v4, and a recent one?)"
      return 5 ;;
    400)
      if [[ "$msg" != "Invalid token." ]]; then
        warn "Coolify ($method $path): ${msg:-HTTP 400}"
        return 3
      fi
      warn "Coolify doesn't take this API token (is it from another team?): $TOKEN_HELP"
      return 2 ;;
    401)
      warn "Coolify refused the API token: $TOKEN_HELP"
      return 2 ;;
    403)
      case "$msg" in
        "API is disabled."*) msg="its API is off: an admin has to turn on API Access, under Settings → Configuration → Advanced" ;;
        "Missing required permissions"*) msg="${msg%.}; $TOKEN_HELP" ;;
        "You are not allowed to access the API."*) msg="it only lets some IP addresses use its API: add this one under Settings → Configuration → Advanced" ;;
        *) msg="${msg:-HTTP 403}. API Access has to be on (Settings → Configuration → Advanced), and the token needs read, write and deploy" ;;
      esac ;;
    422) msg="${msg:-Validation failed.} $(json 'Object.entries(j.errors || {}).map(([k, e]) => k + ": " + [].concat(e).join(" ")).join("; ")' <<<"$out" 2>/dev/null)" ;;
    429) msg="this API token hit Coolify's rate limit (200 requests a minute): wait a minute and run this again" ;;
  esac
  warn "Coolify ($method $path): ${msg:-HTTP $code}"
  return 1
}

# Checks that there's a Coolify to talk to, with a token it takes. The token is kept in the state
# directory, as the header curl reads from a file; a token given now replaces the remembered one.
connect() {
  local rc=0
  [[ -n "$COOLIFY_URL" ]] || die "which Coolify? Pass --url https://coolify.example.com (or set COOLIFY_URL)"
  if [[ -z "$TOKEN_ARG" && ! -s "$TOKEN_FILE" && -t 0 ]]; then
    read -r -s -p "   Your Coolify API token (read, write and deploy; kept in $STATE_DIR): " TOKEN_ARG || true
    echo
  fi
  if [[ -n "$TOKEN_ARG" ]]; then
    [[ "$TOKEN_ARG" != *[[:space:]]* ]] || die "the API token has spaces in it"
    mkdir -p "$STATE_DIR"
    chmod 700 "$STATE_DIR"
    (umask 077 && printf 'Authorization: Bearer %s\n' "$TOKEN_ARG" >"$TOKEN_FILE")
    TOKEN_ARG=""
  fi
  [[ -s "$TOKEN_FILE" ]] || die "no Coolify API token: $TOKEN_HELP (or run this in a terminal, which asks for it)"
  COOLIFY_VERSION=$(api GET /version) || rc=$?
  [[ $rc -ne 2 ]] || rm -f "$TOKEN_FILE" # forgotten, so the next run asks again
  [[ $rc -eq 0 ]] || die "couldn't use Coolify's API at $COOLIFY_URL"
}

# The office's page in Coolify: its deployments, their logs, its environment variables and storage.
app_url() { echo "$COOLIFY_URL/project/$PROJECT_UUID/environment/$ENVIRONMENT_UUID/application/$APP_UUID"; }

# Whether Coolify still has something: exists /projects/<uuid>. Only an answer can say it's gone:
# when Coolify can't be asked, this dies, so nothing gets made again or forgotten over an office
# that's still running.
exists() {
  local rc=0
  api GET "$1" >/dev/null || rc=$?
  [[ $rc -eq 0 || $rc -eq 4 ]] || die "couldn't ask Coolify whether ${1##*/} is still there"
  [[ $rc -eq 0 ]]
}

# The server a new office goes on: --server, or the one server Coolify has for applications.
pick_server() {
  local servers pick
  servers=$(api GET /servers) || die "couldn't list Coolify's servers"
  pick=$(mkjson '(() => {
      const all = JSON.parse(v[0]);
      const fit = v[1] ? all.filter((s) => s.uuid === v[1] || s.name === v[1]) : all.filter((s) => !(s.settings && s.settings.is_build_server));
      return fit.length === 1 ? fit[0].uuid : "";
    })()' "$servers" "$SERVER_ARG" | json 'j')
  if [[ -z "$pick" ]]; then
    local names
    names=$(json 'j.map((s) => s.name).join(", ") || "none"' <<<"$servers")
    [[ -z "$SERVER_ARG" ]] || die "no server \"$SERVER_ARG\" in Coolify (or several by that name); its servers: $names"
    die "which of Coolify's servers ($names) should run the office? Pick one with --server <name>"
  fi
  echo "$pick"
}

# The JSON for the office's application: which commit Coolify builds (source), and how (update):
# deploy/container/Dockerfile, sshd published on a port of the server, no domain (so Coolify's proxy
# never routes to it), and a health check that asks the office's own health route with curl in the
# container. create adds what only a new application takes.
# app_json create|update|source [the repository to switch to]
app_json() {
  mkjson '(() => {
    const app = {git_branch: v[1], git_commit_sha: v[2]};
    if (v[0] !== "source") Object.assign(app, {build_pack: "dockerfile", dockerfile_location: "/" + v[3], base_directory: "/",
      ports_exposes: "22", ports_mappings: v[4] + ":22", domains: "", is_auto_deploy_enabled: false,
      health_check_enabled: true, health_check_type: "cmd", health_check_command: "curl -fs http://127.0.0.1:" + v[5] + "/api/health",
      health_check_interval: 15, health_check_timeout: 5, health_check_retries: 4, health_check_start_period: 300});
    if (v[0] === "create") {
      // autogenerate_domain is on unless it is sent off: it would give the office a public sslip.io domain.
      Object.assign(app, {project_uuid: v[6], environment_name: "production", environment_uuid: v[7], server_uuid: v[8],
        name: "office", description: "Agent Office (deploy/coolify.sh)", git_repository: v[9], autogenerate_domain: false,
        instant_deploy: false});
    } else if (v[9]) {
      app.git_repository = v[9];
    }
    return app;
  })()' "$1" "$GIT_BRANCH" "$COMMIT" "$DOCKERFILE" "$SSH_PORT" "$OFFICE_PORT" "$PROJECT_UUID" "$ENVIRONMENT_UUID" "$SERVER_UUID" "${2:-}"
}

# Sets the application up the way app_json says: patch_app update|source
patch_app() {
  local cur want body
  cur=$(api GET "/applications/$APP_UUID" | json 'j.git_repository || ""') || die "couldn't read the office's application"
  want=$(coolify_repo)
  if [[ "$cur" == "$want" ]]; then
    want=""
  else
    # GitHub repositories are cloned through Coolify's GitHub source and others by URL, and the API
    # can't change an application's source.
    [[ ("$cur" == *://* && "$want" == *://*) || ("$cur" != *://* && "$want" != *://*) ]] ||
      die "this office builds from $cur, and Coolify can't switch it to $REPO_URL: build from a repository on the same host, or destroy the office and run up again"
  fi
  body=$(app_json "$1" "$want") || die "couldn't make the application's settings"
  api PATCH "/applications/$APP_UUID" "$body" >/dev/null || die "couldn't update the office's application in Coolify"
}

# The project (with its production environment) and the office's application: made once, then
# remembered in $IDS_FILE. Each UUID is saved as soon as it exists, so a later step failing never
# makes the next `up` create a second office (or `destroy` miss the first).
ensure_project() {
  local out pick=""
  if [[ -n "$PROJECT_UUID" ]] && ! exists "/projects/$PROJECT_UUID"; then
    warn "the Coolify project for \"$NAME\" is gone; making a new one"
    PROJECT_UUID="" ENVIRONMENT_UUID="" APP_UUID=""
  fi
  if [[ -n "$APP_UUID" ]] && ! exists "/applications/$APP_UUID"; then
    warn "the office's application in Coolify is gone; making a new one (with a new, empty volume)"
    APP_UUID=""
  fi
  # Checked before anything is made. It only places a new application: one that exists stays put.
  if [[ -z "$APP_UUID" || -n "$SERVER_ARG" ]]; then pick=$(pick_server) || exit 1; fi
  [[ -z "$APP_UUID" || -z "$pick" || "$pick" == "$SERVER_UUID" ]] ||
    warn "--server only places a new office; this one stays where it is (destroy it first to move it)"
  if [[ -z "$PROJECT_UUID" ]]; then
    out=$(api POST /projects "$(mkjson '({name: v[0], description: "Agent Office (deploy/coolify.sh)"})' "$NAME")") ||
      die "couldn't create the Coolify project"
    PROJECT_UUID=$(json 'j.uuid' <<<"$out")
    [[ -n "$PROJECT_UUID" ]] || die "Coolify made the project but didn't say its UUID: $out"
    save_ids
    ok "Coolify project $NAME"
  fi
  if [[ -z "$ENVIRONMENT_UUID" ]]; then
    out=$(api GET "/projects/$PROJECT_UUID") || die "couldn't read the Coolify project"
    ENVIRONMENT_UUID=$(json '(j.environments || []).filter((e) => e.name === "production").map((e) => e.uuid)[0] || ""' <<<"$out")
    [[ -n "$ENVIRONMENT_UUID" ]] || die "the Coolify project $NAME has no production environment"
    save_ids
  fi
  if [[ -z "$APP_UUID" ]]; then
    SERVER_UUID="$pick"
    # Creating one takes the URL (Coolify checks it is one), and Coolify turns a github.com URL into
    # owner/repo itself.
    out=$(app_json create "$REPO_URL") || die "couldn't make the application's settings"
    out=$(api POST /applications/public "$out") || die "couldn't create the office's application"
    APP_UUID=$(json 'j.uuid' <<<"$out")
    [[ -n "$APP_UUID" ]] || die "Coolify made the application but didn't say its UUID: $out"
    save_ids
    ok "Application office ($APP_UUID)"
  fi
}

# How Coolify builds and runs it (set again on every `up`, whatever was changed in Coolify since:
# that also takes off any domain it has), where it keeps its data, and how SSH reaches it.
configure_app() {
  local out ip
  patch_app update

  # Everything the office keeps goes on this volume (see deploy/container/start.sh). Coolify names it
  # after the application: <its UUID>-data.
  out=$(api GET "/applications/$APP_UUID/storages") || die "couldn't read the office's storage"
  VOLUME_NAME=$(json '(j.persistent_storages || []).filter((s) => s.mount_path === "/data").map((s) => s.name)[0] || ""' <<<"$out")
  if [[ -z "$VOLUME_NAME" ]]; then
    out=$(api POST "/applications/$APP_UUID/storages" '{"type": "persistent", "name": "data", "mount_path": "/data"}') ||
      die "couldn't add the volume"
    VOLUME_NAME=$(json 'j.name' <<<"$out")
    save_ids
    ok "Volume $VOLUME_NAME on /data"
  fi

  # Where you and teammates SSH to: the server the office runs on. Coolify's own server is
  # host.docker.internal to Coolify, and you reach it at your Coolify's address.
  if [[ -n "$SSH_HOST_ARG" ]]; then
    SSH_HOST="$SSH_HOST_ARG"
  elif [[ -z "$SSH_HOST" ]]; then
    ip=$(api GET "/servers/$SERVER_UUID" | json 'j.ip || ""') || die "couldn't read the office's server in Coolify"
    if [[ -n "$ip" && "$ip" != host.docker.internal ]]; then SSH_HOST="$ip"
    else SSH_HOST=$(sed -E 's#^[a-z]+://([^/:]+).*#\1#' <<<"$COOLIFY_URL"); fi
  fi
  save_ids
  ok "SSH at $SSH_HOST:$SSH_PORT"
}

# Sets KEY=VALUE environment variables on the office's application, keeping every other one (yours,
# from Coolify's Environment Variables tab). They reach the container at its next deploy or restart,
# at runtime only: build variables become build arguments, which can end up in the image.
#
# PORT and HOST go in with runtime and build time both off, so they reach nothing: they only stop
# Coolify giving the container its own (PORT=22 from the SSH port, HOST=0.0.0.0), which workers'
# dev servers would pick up.
set_env() {
  local body
  body=$(mkjson '({data: v.map((kv) => {
    const i = kv.indexOf("="), key = kv.slice(0, i), value = kv.slice(i + 1), on = key !== "PORT" && key !== "HOST";
    // Coolify writes a literal value in single quotes.
    if (/[\x27\n]/.test(value)) throw new Error(key + " cannot have quotes or newlines in it");
    return {key, value, is_literal: true, is_runtime: on, is_buildtime: false, is_preview: false,
      comment: on ? "set by deploy/coolify.sh" : "keeps Coolify from setting " + key + " in the office (deploy/coolify.sh)"};
  })})' "$@") || die "couldn't set the office's environment variables"
  api PATCH "/applications/$APP_UUID/envs/bulk" "$body" >/dev/null || die "couldn't set the office's environment variables"
}

# Follows a deployment of the office until it's done: queued, in_progress, then finished (or failed).
follow_deployment() {
  local id="$1" i rc out st="" link
  for ((i = 0; i < 240; i++)); do
    rc=0
    out=$(api GET "/deployments/$id" 2>/dev/null) || rc=$?
    [[ $rc -ne 4 ]] || die "Coolify has no deployment $id (is its deployment queue full?): see $(app_url)"
    st=$(json 'j.status' <<<"$out" 2>/dev/null) || st=""
    case "$st" in
      finished) break ;;
      failed | cancelled-by-user)
        link=$(json 'j.deployment_url || ""' <<<"$out")
        die "the deployment $([[ $st == failed ]] && echo failed || echo was cancelled): its log is in Coolify, at ${link:+$COOLIFY_URL$link}${link:-$(app_url)}" ;;
    esac
    sleep 5
  done
  [[ "$st" == finished ]] || die "the deployment is still going after 20 minutes: follow it in Coolify: $(app_url)"
}

# Has Coolify deploy the office (start: build the pinned commit, unless it has its image already;
# restart: a new container from that image), and waits for the new container's office to answer.
# With a port published, Coolify stops the old container before it starts the new one, so two
# offices never share the volume (or the SSH port).
deploy() {
  local action="$1" was out id
  was=$(started)
  out=$(api POST "/applications/$APP_UUID/$action") || die "couldn't start a deployment in Coolify"
  id=$(json 'j.deployment_uuid || ""' <<<"$out")
  if [[ -z "$id" ]]; then
    # One of this commit is already queued or going: Coolify says so instead of starting another.
    id=$(api GET "/deployments/applications/$APP_UUID?take=1" | json '(j.deployments || []).map((d) => d.deployment_uuid)[0] || ""' 2>/dev/null) || id=""
    [[ -n "$id" ]] || die "Coolify didn't start a deployment: $(json 'j.message' <<<"$out")"
  fi
  follow_deployment "$id"
  ok "Deployed in Coolify"
  say "Waiting for the new container's office to answer over SSH"
  if [[ -n "$was" ]]; then wait_replaced "$was"; else wait_healthy; fi ||
    die "the office didn't come up; check: deploy/coolify.sh logs$NAME_FLAG (and that port $SSH_PORT is free on the server, and open in any firewall in front of it)"
}

# Has Coolify build the commit resolve_source found (it skips the build when it has that commit's
# image already), and run it.
build() {
  say "Coolify is building $(git -C "$REPO_DIR" log -1 --format='%h %s') from $REPO_URL ($GIT_BRANCH): a few minutes"
  deploy start
}

# --- SSH ---------------------------------------------------------------------------------------------

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

# When the container's first process started: it changes when Coolify replaces the container.
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
    die "the tunnel opened but the office didn't answer through it; check: deploy/coolify.sh logs$NAME_FLAG"
  fi
  ok "Your office: http://localhost:$port$path"
  echo "   (tunneled over SSH to $SSH_HOST:$SSH_PORT; keep this running while you use it, Ctrl-C closes it)"
  open_url "http://localhost:$port$path"
  wait "$pid" || true
  trap - INT TERM
  warn "The tunnel dropped; reopen it with: deploy/coolify.sh open$NAME_FLAG"
}

# A worker's server from the 🌐 Services board: localhost:<port> tunnels to the office, which
# relays it by that port (see src/server/relay.ts), so the local port must match the service's.
service_tunnel() {
  local port="$1" pid i up=0
  port_busy "$port" && die "localhost:$port is already in use on this computer: stop whatever runs there first"
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
  echo "   (through the office: sign in with the office password if it asks; Ctrl-C closes it)"
  open_url "http://localhost:$port"
  wait "$pid" || true
  trap - INT TERM
  warn "The tunnel dropped; reopen it with: deploy/coolify.sh service $port$NAME_FLAG"
}

open_office() {
  local claimable path="/"
  claimable=$(office_get /api/claim 2>/dev/null || true)
  if [[ "$claimable" == *'"claimable":true'* && -f "$CLAIM_FILE" ]]; then
    path="/claim?t=$(cat "$CLAIM_FILE")"
    say "Opening the one-time password page: write the password down, it is never shown again"
  fi
  tunnel "$path"
}

valid_member() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$ ]] || die "names are letters, numbers, dots, dashes and underscores: $1"; }

team_members() { remote "agent-office-team list"; } # "<name> <number of keys>" per line

# --- commands ----------------------------------------------------------------------------------------

cmd_up() {
  need ssh-keygen
  need git
  [[ -f "$REPO_DIR/$DOCKERFILE" ]] || die "run this from a clone of agent-office ($DOCKERFILE is missing)"
  preflight
  resolve_source
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  connect
  SSH_PORT="${SSH_PORT_ARG:-${SSH_PORT:-$DEFAULT_SSH_PORT}}"

  local gh_token="$GH_TOKEN_ARG"
  if [[ -z "$gh_token" && $NO_GH_TOKEN -eq 0 ]] && command -v gh >/dev/null 2>&1; then
    gh_token=$(gh auth token 2>/dev/null || true)
  fi
  [[ $NO_GH_TOKEN -eq 1 ]] && gh_token=""

  say "Agent Office \"$NAME\" on Coolify $COOLIFY_VERSION ($COOLIFY_URL)"
  echo "   app:      commit ${COMMIT:0:7} of $REPO_URL ($GIT_BRANCH), built by Coolify with $DOCKERFILE"
  echo "   data:     a Docker volume on /data: accounts, floors, projects (~/workspace), sign-ins, team keys"
  echo "   access:   SSH tunnel only (the office is never exposed), on a port of the server Coolify runs it on"
  if [[ -n "$gh_token" ]]; then
    echo "   github:   your GitHub token goes in the office (private clones, issue/PR boards, pushes)"
  else
    echo "   github:   no token; private repos and the boards won't work until gh is signed in"
  fi
  if [[ -n "$CLAUDE_TOKEN" || -n "$ANTHROPIC_KEY" ]]; then
    echo "   claude:   signed in with the token you provided"
  else
    echo "   claude:   not signed in; log in from the first worker's terminal (or pass --claude-token)"
  fi

  [[ -f "$KEY_FILE" ]] || ssh-keygen -q -t ed25519 -N '' -C "agent-office-$NAME" -f "$KEY_FILE"
  [[ -f "$CLAIM_FILE" ]] || (umask 077 && random_token >"$CLAIM_FILE")

  ensure_project
  configure_app

  # Your key gets a shell in the container; the claim link shows the generated password once;
  # teammates are told to SSH to the server's port; the office's panels suggest this script.
  local vars=("AGENT_OFFICE_ADMIN_KEYS=$(cat "$KEY_FILE.pub")" "AGENT_OFFICE_CLAIM_TOKEN=$(cat "$CLAIM_FILE")"
    "AGENT_OFFICE_PUBLIC_HOST=$SSH_HOST:$SSH_PORT" "AGENT_OFFICE_DEPLOY_SCRIPT=deploy/coolify.sh$NAME_FLAG"
    "PORT=$OFFICE_PORT" "HOST=127.0.0.1")
  [[ -z "$CLAUDE_TOKEN" ]] || vars+=("CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_TOKEN")
  [[ -z "$ANTHROPIC_KEY" ]] || vars+=("ANTHROPIC_API_KEY=$ANTHROPIC_KEY")
  set_env "${vars[@]}"

  build

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

  ok "Your office is running on Coolify (reachable only through SSH)"
  echo
  echo "   Open it later:     deploy/coolify.sh open$NAME_FLAG"
  echo "   Add a teammate:    the 👥 Invite button in the office, or deploy/coolify.sh invite <their-github-username>$NAME_FLAG"
  echo "   Update it:         push, then deploy/coolify.sh update$NAME_FLAG"
  echo "   Tear it down:      deploy/coolify.sh destroy$NAME_FLAG"
  echo "   In Coolify:        $(app_url)"
  echo
  [[ $NO_OPEN -eq 1 ]] && return
  open_office
}

cmd_open() {
  preflight
  require_office
  wait_healthy || die "the office isn't answering; check: deploy/coolify.sh logs$NAME_FLAG"
  open_office
}

cmd_update() {
  preflight
  require_office
  resolve_source
  connect
  patch_app source
  build
  ok "Updated (workers that were running come back where they left off)"
}

cmd_restart() {
  preflight
  require_office
  connect
  say "Restarting (a new container, from the image Coolify built)"
  deploy restart
  ok "Restarted"
}

cmd_service() {
  preflight
  [[ ${#POSITIONAL[@]} -eq 1 && "${POSITIONAL[0]}" =~ ^[0-9]+$ && ${POSITIONAL[0]} -gt 0 && ${POSITIONAL[0]} -lt 65536 ]] ||
    die "usage: deploy/coolify.sh service <port>   (a port from the office's 🌐 Services board)"
  [[ "${POSITIONAL[0]}" -ne $OFFICE_PORT ]] || die "$OFFICE_PORT is the office itself; use: deploy/coolify.sh open"
  require_office
  service_tunnel "${POSITIONAL[0]}"
}

cmd_status() {
  preflight
  if [[ -z "$APP_UUID" ]]; then
    echo "No office named \"$NAME\" on Coolify."
    return
  fi
  connect
  local app deployment server
  app=$(api GET "/applications/$APP_UUID") || die "couldn't read the office's application"
  deployment=$(api GET "/deployments/applications/$APP_UUID?take=1" |
    json '(j.deployments || []).map((d) => d.status + " (commit " + String(d.commit).slice(0, 7) + ", " + d.created_at + ")")[0] || "none"' 2>/dev/null) || deployment="unknown"
  server=$(api GET "/servers/$SERVER_UUID" | json 'j.name' 2>/dev/null) || server="$SERVER_UUID"
  echo "office:     $NAME (Coolify application $APP_UUID on server $server: $(json 'j.status' <<<"$app"))"
  echo "coolify:    $(app_url)"
  echo "source:     $(json 'j.git_repository + " " + j.git_branch + ", commit " + String(j.git_commit_sha).slice(0, 7)' <<<"$app")"
  echo "deployment: $deployment"
  echo "ssh:        $SSH_HOST:$SSH_PORT  (open the office with: deploy/coolify.sh open$NAME_FLAG)"
  if [[ -f "$KEY_FILE" ]] && office_get /api/health >/dev/null 2>&1; then
    echo "volume:     $VOLUME_NAME: $(remote "df -h /data | awk 'NR == 2 {print \$3 \" used of \" \$2}'")"
    echo "office:     up"
    local team
    team=$(team_members 2>/dev/null | awk '{printf "%s%s", sep, $1; sep=", "}')
    echo "team:       ${team:-nobody invited yet}"
  else
    echo "volume:     ${VOLUME_NAME:-none}"
    echo "office:     not answering"
  fi
}

cmd_invite() {
  preflight
  [[ ${#POSITIONAL[@]} -ge 1 && ${#POSITIONAL[@]} -le 2 ]] ||
    die "usage: deploy/coolify.sh invite <github-username>   or   deploy/coolify.sh invite <name> <public-key-file>"
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
  [[ ${#POSITIONAL[@]} -eq 1 ]] || die "usage: deploy/coolify.sh uninvite <name>"
  local who="${POSITIONAL[0]}" out rc=0
  valid_member "$who"
  require_office
  out=$(remote "agent-office-team remove $who" 2>&1) || rc=$?
  [[ $rc -eq 66 ]] && die "$who isn't invited (see: deploy/coolify.sh team$NAME_FLAG)"
  [[ $rc -eq 0 ]] || die "couldn't remove the keys: $out"
  ok "$who's keys are removed and open tunnels were dropped (other teammates just reconnect)"
  echo "   They still know the office password. To change it: deploy/coolify.sh reset-password$NAME_FLAG"
}

cmd_team() {
  preflight
  require_office
  local list
  list=$(team_members)
  if [[ -z "$list" ]]; then
    echo "Nobody is invited yet. Add someone: deploy/coolify.sh invite <github-username>$NAME_FLAG"
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

# The container's output, from Coolify (which keeps no more than Docker does): the last 100 lines,
# then whatever comes after, until Ctrl-C.
cmd_logs() {
  preflight
  require_office
  connect
  local out last=""
  while :; do
    out=$(api GET "/applications/$APP_UUID/logs?lines=100&show_timestamps=true" 2>/dev/null) || out='{"logs": ""}'
    # Each line starts with Docker's timestamp (fixed width, so they sort as text).
    out=$(mkjson '(JSON.parse(v[0]).logs || "").split("\n").filter((l) => l && l.split(" ")[0] > v[1]).join("\n")' "$out" "$last" | json 'j')
    if [[ -n "$out" ]]; then
      printf '%s\n' "$out"
      last=$(tail -n 1 <<<"$out" | cut -d' ' -f1)
    fi
    sleep 2
  done
}

cmd_reset_password() {
  preflight
  require_office
  connect
  (umask 077 && random_token >"$CLAIM_FILE")
  say "Resetting the office password"
  set_env "AGENT_OFFICE_CLAIM_TOKEN=$(cat "$CLAIM_FILE")"
  remote "node /opt/agent-office/bin/agent-office.js --reset-password >/dev/null" || die "reset failed"
  # A restart, so the office starts with the new claim token (and makes the new password).
  deploy restart
  ok "Everyone has been signed out"
  open_office
}

cmd_down() {
  preflight
  if [[ -z "$PROJECT_UUID" && -z "$APP_UUID" ]]; then
    echo "Nothing to delete for \"$NAME\"."
    rm -rf "$STATE_DIR"
    return
  fi
  connect
  # The state directory (this office's SSH key, claim token, API token and UUIDs) goes only once the
  # office has: exists dies when Coolify can't say, and a failed delete stops here.
  local have_app=0 i rc out
  [[ -n "$APP_UUID" ]] && exists "/applications/$APP_UUID" && have_app=1
  say "This permanently deletes office \"$NAME\" from $COOLIFY_URL: the application${VOLUME_NAME:+, the volume $VOLUME_NAME} and everything on it."
  echo "   Anything in the office that isn't pushed to GitHub is lost."
  if [[ $YES -ne 1 ]]; then
    read -r -p "   Type the office name ($NAME) to confirm: " answer
    [[ "$answer" == "$NAME" ]] || die "cancelled"
  fi
  if [[ $have_app -eq 1 ]]; then
    # Coolify stops and removes the container, the volume, the office's network and its files on the
    # server in the background, once the application is gone from its API.
    api DELETE "/applications/$APP_UUID?delete_configurations=true&delete_volumes=true&docker_cleanup=true&delete_connected_networks=true" >/dev/null ||
      die "couldn't delete the office's application"
    for ((i = 0; i < 60; i++)); do
      rc=0
      api GET "/applications/$APP_UUID" >/dev/null 2>&1 || rc=$?
      [[ $rc -eq 4 ]] && break
      sleep 2
    done
    [[ $rc -eq 4 ]] || die "Coolify still has the office's application after 2 minutes (run this again to retry)"
    ok "Application deleted (Coolify removes its container${VOLUME_NAME:+ and the volume $VOLUME_NAME} with it)"
  else
    ok "The office's application is already deleted"
  fi
  APP_UUID=""
  save_ids

  # The project too, unless you've put something else in it: Coolify refuses (400) while it has
  # anything in it, the office's application included until that's gone.
  if [[ -n "$PROJECT_UUID" ]] && exists "/projects/$PROJECT_UUID"; then
    for ((i = 0; i < 24; i++)); do
      rc=0
      out=$(api DELETE "/projects/$PROJECT_UUID" 2>&1) || rc=$?
      [[ $rc -eq 3 ]] || break
      sleep 5
    done
    case "$rc" in
      0 | 4) ok "Coolify project $NAME deleted" ;;
      3) warn "left the Coolify project \"$NAME\" in place: Coolify says it still has something else in it" ;;
      *) die "couldn't delete the Coolify project: ${out:-no answer} (run this again to retry)" ;;
    esac
  fi
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
  *) die "unknown command \"$CMD\" (see: deploy/coolify.sh help)" ;;
esac
