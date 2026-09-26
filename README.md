# 🏢 Agent Office

A cartoon 3D office your team walks around in together. Sit a Claude Code worker at any empty desk, watch its terminal on the laptop in front of it, and jump into that terminal with everyone else. Issues and pull requests hang on cork boards on the wall. You can talk over voice and put your screen on the lounge TV.

Everything is scoped to **one directory on the machine that runs it**: every worker, terminal and board works in that project.

```
cd ~/code/my-project
agent-office
```

## What's inside

- **Walk around.** Use WASD, Space to jump, and drag the mouse to orbit the camera. Everyone in the office sees everyone else move in real time.
- **Hire workers.** Walk up to an empty desk and press **E** to seat a fresh Claude Code session, or press **P** to write a task first. A little worker sits down, a laptop opens, and Claude's live screen appears on it.
- **Shared shells.** Press **B** at an empty desk to open a plain login shell for dev servers, git or tests. It's shared the same way as a Claude terminal.
- **Isolated branches.** When you hire with a task, you can tick *own git worktree*. The worker then gets its own `office/<name>` branch under `.agent-office/worktrees/`, so parallel workers never share a checkout.
- **Shared terminals.** Press **E** at an occupied desk to open the real terminal (a PTY, over WebSockets). Several people can type into the same session at once, and anyone who joins late gets the full scrollback.
- **Live status.** Claude Code hooks drive each worker's status: *working*, *needs input* or *done*. When a worker needs a human or has finished, it jumps up and down and you hear a ding. Its antenna bulb shows the status from across the room.
- **Survives restarts.** Workers are saved to disk. After a server restart they come back asleep, and **R** resumes the exact Claude session.
- **Cost per worker.** Every worker shows what its Claude session has cost and how many tokens it used, on the desk hint, in the sidebar and in its terminal header. The sidebar adds up today's and all-time spend for the whole office. All of it survives restarts. Start the office with `--budget 20` and everyone gets a warning when the day's spend passes $20; add `--budget-pause` and no new workers can be hired until the next day.
- **Issues board.** A tack board shows GitHub issues in *Open*, *In progress* and *Closed*. Click an issue and choose **Hand to a worker** to seat a worker with a ready-made prompt.
- **PR board.** A second tack board shows pull requests in *Draft*, *In review*, *Approved*, *Merged* and *Closed*, with CI status and diff size. **Review with a worker** does what it says.
- **Services board.** When a worker starts a web server (`npm run dev`, a preview build, `python -m http.server`), it appears within a few seconds on the **🌐 Services** board, which hangs on the wall by the lounge and is also a button in the top bar. Each entry shows the worker, its branch and the page's title. Click a row to copy one command that opens that server on your own computer. Hire a worker with its own worktree, ask it to run the dev server, and your designer can review the branch in their own browser.
- **Voice.** Browser-to-browser WebRTC voice. Volume depends on how close you stand, but people are never fully silent.
- **Screen sharing.** Your screen appears on the lounge TV for everyone, and there's a full-screen viewer.
- **Password protected.** The session cookie is signed, and login attempts are rate limited.

## Requirements

On the machine that runs the office (your laptop or a VPS):

- **Node.js 20+**. Prebuilt PTY binaries ship for Linux and macOS, x64 and arm64, so no compiler is needed.
- **Claude Code** (`claude`), installed and logged in as the user that runs the office.
- **git**, plus the **GitHub CLI** (`gh`) logged in (`gh auth login`) if you want the issue and PR boards.
- `curl` is optional. The status hooks use it when it's there and fall back to Node when it isn't.

## Install & run

Install once from a clone:

```bash
git clone <this repo> agent-office && cd agent-office
npm install          # also builds the client and server
npm install -g .     # puts `agent-office` on your PATH
```

Then run it from any project:

```bash
cd ~/code/my-project
agent-office --password 'correct horse battery staple'
```

It prints the URLs your teammates can open. If you leave out `--password`, it generates one, saves it in `.agent-office/config.json` and prints it.

```
agent-office [dir] [options]

  -p, --port <n>          Port (default 4600, env PORT)
  -H, --host <addr>       Bind address (default 0.0.0.0)
      --password <pw>     Office password (env AGENT_OFFICE_PASSWORD)
      --agent <cmd>       Command each worker runs (default "claude")
      --agent-args <str>  Extra args for every worker, e.g. "--model opus"
      --tls-cert <file>   Serve HTTPS with this cert…
      --tls-key <file>    …and key
      --self-signed       Serve HTTPS with a generated self-signed cert
      --trust-proxy       Trust X-Forwarded-* (behind Caddy/nginx)
      --turn <url>        Add a TURN server for voice, e.g. turn:user:pass@host:3478
      --budget <usd>      Daily budget for all workers; everyone is warned when it's passed
      --budget-pause      ...and nobody can hire a new worker until the next day
```

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Walk (hold Shift to run) |
| Space | Jump (you can land on desks and couches) |
| Mouse drag / wheel | Orbit / zoom the camera |
| E | Interact: hire a worker, open its terminal, read a board, watch the TV |
| P | Prompt: give a task to a new worker, or to the one at this desk |
| B | Open a shared shell at an empty desk |
| R | Resume a sleeping worker (or restart a shell) |
| X | Send a worker home (frees the desk) |
| T / Enter | Chat |
| V / M | Join voice / mute |
| Esc | Close any window (a terminal too) and get back to looking around |
| Ctrl + [ | Send Esc to a terminal (e.g. to interrupt Claude) |

You can also click a nearby desk to interact with it, or click a worker in the sidebar to open its terminal.

## One command on AWS

If you have the AWS CLI logged in, one command gives you your own office on EC2. No Terraform needed:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
deploy/aws.sh up
```

After that, the whole lifecycle is four more commands:

```bash
deploy/aws.sh open      # tunnel to the office and open it in your browser
deploy/aws.sh pause     # stop the machine to save money (asks first); only the disk and IP are billed
deploy/aws.sh resume    # start it again: same address, same files, then open it
deploy/aws.sh destroy   # delete the machine, disk, IP, security group and key pair (asks first)
```

What `up` does, in about 2 minutes:

1. Creates an SSH key pair (kept in `~/.config/agent-office/aws/<name>/`).
2. Creates a security group that opens **only SSH (port 22), and only to your current IP**. The office itself is never on the internet.
3. Gives the machine a fixed Elastic IP and launches a **t3.xlarge** (4 vCPU, 16 GiB) Ubuntu 24.04 instance with a 50 GiB disk.
4. Installs Node 22, git, the GitHub CLI and **Claude Code**. It clones the latest agent-office from GitHub, runs `npm i`, and clones your project.
5. Runs the office under systemd with `Restart=always`, so it comes back after a crash or a reboot. It listens on `127.0.0.1:4600` on the machine, so the only way in is an SSH tunnel.
6. Opens an SSH tunnel and your browser at `http://localhost:4600`. **The first page shows the office password once. Write it down.** The server then keeps only a hash, so nobody can display the password again.

Everything goes through SSH, so there are no certificate warnings, and `localhost` counts as a secure origin: voice and screen sharing just work. Keep the terminal open while you use the office; Ctrl-C closes the tunnel. Next time, run `deploy/aws.sh open`. If port 4600 is taken on your machine, it picks the next free one.

**Inviting your team.** Teammates don't need AWS access or this repo, just `ssh`. In the office, click **👥 Invite** and type their GitHub username. That installs the SSH keys from `github.com/<username>.keys`. The panel then gives you one command to send them, for macOS, Linux or Windows. It opens the tunnel and, once it's up, the office in their browser:

```
ssh -o ExitOnForwardFailure=yes -o PermitLocalCommand=yes -o LocalCommand="open http://localhost:4600" -L 4600:localhost:4600 office@<your-office-ip>
```

**Copy invite message** copies the command, plus the server fingerprint to check on first connect. The panel also lists who's invited and can remove them. The same works from your terminal:

```bash
deploy/aws.sh invite octocat        # uses the SSH keys on github.com/octocat
deploy/aws.sh allow 203.0.113.7     # their IP (SSH answers only allowed IPs)
```

They leave that command running and sign in with the office password. Their keys log in as a separate `office` user that can **only** forward to the office port. It has no shell, no other ports, no `-R`, and no agent forwarding. So a leaked teammate key still doesn't get past the office password.

**Reviewing what workers build.** Every web server a worker runs is listed on the **🌐 Services** board. Clicking a row copies a command like this one:

```
ssh -N -o ExitOnForwardFailure=yes -o PermitLocalCommand=yes -o LocalCommand="open http://localhost:5173" -L 5173:localhost:4600 office@<your-office-ip>
```

It opens http://localhost:5173 on their computer. The tunnel ends at the office's own port, and the office relays it to the worker's server on 5173. So the same invited keys work, nothing new is opened on the machine, and every page still asks for the office password (anyone signed in to the office already is). Keep one terminal per service open while you look. You set the office up yourself? Run `deploy/aws.sh service 5173` instead.

If chasing teammates' IPs gets old, `deploy/aws.sh allow anywhere` opens SSH to every IP. That's a reasonable trade: SSH only accepts your key and invited keys, and the office stays behind the tunnel.

```bash
deploy/aws.sh open                 # tunnel + open the office in your browser
deploy/aws.sh service 5173         # open a worker's web server from the 🌐 Services board
deploy/aws.sh invite <gh-user>     # let a teammate tunnel in (or: invite <name> <key.pub>)
deploy/aws.sh uninvite <name>      # remove their keys and drop open tunnels
deploy/aws.sh team                 # who's invited
deploy/aws.sh allow 203.0.113.7    # let an IP reach SSH (CIDR ok; "me", "anywhere")
deploy/aws.sh revoke 203.0.113.7   # …and take it back
deploy/aws.sh status               # instance, address, office up?, team, allowed IPs
deploy/aws.sh resize t3.2xlarge    # bigger or smaller machine; same address, ~1-2 min of downtime
deploy/aws.sh update               # install the latest agent-office and restart
deploy/aws.sh reset-password       # new password, shown once; signs everyone out
deploy/aws.sh ssh | logs           # get on the box / follow the office logs
```

**Upgrading from the office.** The **⬆️** button in the top bar checks GitHub for new commits on the branch the office was installed from. It lights up as **⬆️ Update** when there are any, and lists them. **Upgrade now** builds the new version next to the running one. Meanwhile the office keeps working and everyone sees a banner. A failed build changes nothing. Once the build succeeds, the office swaps it in and restarts, and everyone gets a *"🛠️ Upgrading the office"* dialog. A few seconds later their page reloads on the new version. Workers that were awake wake back up at their desks by themselves. Anything they were in the middle of gets interrupted, and the panel names those workers before you click.

An office created before the SSH tunnel served HTTPS on port 443 with a self-signed certificate. Run `deploy/aws.sh up` once to move it over: 443 closes and the office moves behind the tunnel. Offices created before the **👥 Invite** and **⬆️** buttons also need one `deploy/aws.sh up` before those buttons appear. `update` alone isn't enough, because `up` installs the key helper and turns on self-upgrade in the systemd unit.

Useful options for `up`:

- `--project owner/repo` chooses which GitHub repo the office works on. The default is the GitHub origin of the directory you run it from.
- `--instance-type`, `--disk` and `--region` set the machine size, disk size and region.
- `--allow <ip>` lets more IPs reach SSH from the start.
- `--name <name>` runs several offices side by side.

**Claude sign-in.** Workers run Claude Code on the machine, so it has to be signed in there. You can do this either way:

- Pass `--claude-token "$(claude setup-token)"`, which uses your Claude subscription, or `--anthropic-api-key <key>`.
- Do nothing, and the first worker jumps with *"Claude isn't signed in — type /login"*. Open its terminal and run `/login`.

**GitHub.** By default, your local `gh auth token` is used to sign in the GitHub CLI on the machine. It's needed for private repos, the issue and PR boards, and for workers to push branches and open PRs. Anyone who can use the office can use that token, so pass `--github-token <fine-grained token>` or `--no-github-token` if that's too much.

## Running it on a VPS for your team

The simplest private setup needs no certificates at all. Run `agent-office --host 127.0.0.1` and have everyone connect with `ssh -L 4600:localhost:4600 you@server`, then open http://localhost:4600. Browsers treat `localhost` as secure, so voice and screen sharing work.

To serve it on a real domain instead, put the office behind HTTPS. Voice and screen sharing need a secure context. The simplest setup is Caddy, which gets certificates automatically:

```caddy
# /etc/caddy/Caddyfile
office.example.com {
    reverse_proxy 127.0.0.1:4600
}
```

```bash
cd /srv/my-project
agent-office --host 127.0.0.1 --trust-proxy --password "$(openssl rand -base64 18)"
```

Caddy proxies WebSockets out of the box. With nginx, forward the Host and Upgrade headers:

```nginx
location / {
    proxy_pass http://127.0.0.1:4600;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1d;
}
```

To keep the office running, use a systemd unit:

```ini
# /etc/systemd/system/agent-office.service
[Unit]
Description=Agent Office
After=network.target

[Service]
User=dev
WorkingDirectory=/srv/my-project
# generate with: openssl rand -base64 24
Environment=AGENT_OFFICE_PASSWORD=<a long random password>
ExecStart=/usr/bin/env agent-office --host 127.0.0.1 --trust-proxy
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

If you don't have a domain, `--self-signed` serves HTTPS directly. Browsers will warn once per person.

**Voice across strict NATs.** Peers connect directly using public STUN. If some teammates can't hear each other (common on corporate networks), run a TURN server such as coturn and pass `--turn turn:user:pass@turn.example.com:3478`.

## How it works

```
browser ──HTTPS/WSS──▶ agent-office (Node)
                         ├─ node-pty ─▶ claude  (one PTY per worker, cwd = project dir)
                         │    └─ headless xterm mirror ─▶ laptop screen frames + late-join snapshots
                         ├─ loopback-only hook server ◀── curl from Claude Code hooks (per-worker token)
                         ├─ gh issue/pr list (cached, refreshed every 90s)
                         ├─ port scan every 4s ─▶ 🌐 Services board; relay for service tunnels
                         └─ WebRTC signaling relay (voice + screen share are peer-to-peer)
```

- **Status.** Each worker starts as `claude --settings .agent-office/claude-hooks.json`. That file adds hooks (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SessionStart`) which `curl` a server bound to `127.0.0.1`. The hooks merge with your own Claude settings; they don't replace them. OSC 9;4 progress sequences in the terminal also count, which catches an Esc-cancel.
- **Shared shells.** Press **B** at an empty desk to open a plain login shell for dev servers, git or tests. It's shared the same way as a Claude terminal.
- **Isolated branches.** When you hire with a task, you can tick *own git worktree*. The worker then gets its own `office/<name>` branch under `.agent-office/worktrees/`, so parallel workers never share a checkout.
- **Shared terminals.** The server keeps one PTY per worker and mirrors it in a headless xterm. People who open the terminal get a serialized snapshot, then the live stream. Laptops get compact per-row diffs a few times a second. The PTY takes the size of whoever is typing.
- **Cost.** Hooks carry no usage, but each one names the session's transcript (`~/.claude/projects/<dir>/<session>.jsonl`). The office reads what gets appended to it, and to the subagent transcripts next to it: every assistant message records the API's token usage and the model, which the office prices from its own table (cache writes and reads included). When a session ends, Claude Code appends its own tally (`cost-state`), and the worker's numbers snap to that, which also covers calls that never reach the transcript. Per-worker totals are saved with the worker, and `.agent-office/usage.json` keeps the office's all-time and per-day spend, so nothing is lost on a restart or when a worker is sent home. On an office deployed with `deploy/aws.sh`, put `AGENT_OFFICE_BUDGET=20` (and `AGENT_OFFICE_BUDGET_PAUSE=1`) in `/etc/agent-office/env` and restart the service.
- **Services.** Every 4 seconds the office lists the TCP ports its user's processes listen on (`ss`, or `lsof` on macOS). It credits each port to the worker whose terminal started it. It goes by the process tree first. For a server that detached from it, it uses the `AGENT_OFFICE_WORKER_ID` the process inherited (Linux), then whether it runs inside that worker's worktree. Ports that answer HTTP are shown. A request for `localhost:<port>` that reaches the office's own port (that's what a service tunnel does) is relayed to that server, WebSockets included, so hot reload works.
- **State.** `.agent-office/` in the project holds the password, the signing secret, the hook settings and the saved workers. It is added to `.git/info/exclude` automatically, so it never shows up in `git status`.

## Security notes

Anyone with the password can drive Claude Code in that directory, and through it run commands as the user that runs the office. Treat the password like SSH access:

- Use a strong password and HTTPS. With `--trust-proxy`, cookies are `Secure` once the proxy says the request came over https.
- Changing the password signs everyone out, because sessions are signed with a key derived from it. Login attempts are limited to 10 per 5 minutes per client.
- Only enable `--trust-proxy` behind a proxy that appends `X-Forwarded-For` (Caddy and nginx both do). The office uses the rightmost hop.
- Run the office as a dedicated, unprivileged user, in the project you mean to share.
- The WebSocket checks the session cookie and the `Origin` header. The hook endpoint only listens on loopback and needs a random per-worker token.
- Service tunnels are relayed only to web servers a worker started, and only with an office session. The office's own cookies are stripped before a request reaches that server. A server you started yourself outside the office is never listed or relayed.
- Workers don't inherit the office password or any parent agent-session variables.

## Development

```bash
npm install
npm run build        # vite (client) + tsc (server)
npm run typecheck
node bin/agent-office.js /path/to/project --password dev
```

`npm run dev` runs Vite with hot reload on :5173 and proxies to the server on :4600.
