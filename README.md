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
- **Issues board.** A tack board shows GitHub issues in *Open*, *In progress* and *Closed*. Click an issue and choose **Hand to a worker** to seat a worker with a ready-made prompt.
- **PR board.** A second tack board shows pull requests in *Draft*, *In review*, *Approved*, *Merged* and *Closed*, with CI status and diff size. **Review with a worker** does what it says.
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
| Ctrl + ] | Leave a terminal (Esc goes to Claude) |

You can also click a nearby desk to interact with it, or click a worker in the sidebar to open its terminal.

## Running it on a VPS for your team

Voice and screen sharing need a secure context, so put the office behind HTTPS. The simplest setup is Caddy, which gets certificates automatically:

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
Environment=AGENT_OFFICE_PASSWORD=change-me
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
                         └─ WebRTC signaling relay (voice + screen share are peer-to-peer)
```

- **Status.** Each worker starts as `claude --settings .agent-office/claude-hooks.json`. That file adds hooks (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SessionStart`) which `curl` a server bound to `127.0.0.1`. The hooks merge with your own Claude settings; they don't replace them. OSC 9;4 progress sequences in the terminal also count, which catches an Esc-cancel.
- **Shared shells.** Press **B** at an empty desk to open a plain login shell for dev servers, git or tests. It's shared the same way as a Claude terminal.
- **Isolated branches.** When you hire with a task, you can tick *own git worktree*. The worker then gets its own `office/<name>` branch under `.agent-office/worktrees/`, so parallel workers never share a checkout.
- **Shared terminals.** The server keeps one PTY per worker and mirrors it in a headless xterm. People who open the terminal get a serialized snapshot, then the live stream. Laptops get compact per-row diffs a few times a second. The PTY takes the size of whoever is typing.
- **State.** `.agent-office/` in the project holds the password, the signing secret, the hook settings and the saved workers. It is added to `.git/info/exclude` automatically, so it never shows up in `git status`.

## Security notes

Anyone with the password can drive Claude Code in that directory, and through it run commands as the user that runs the office. Treat the password like SSH access:

- Use a strong password and HTTPS. With `--trust-proxy`, cookies are `Secure` once the proxy says the request came over https.
- Run the office as a dedicated, unprivileged user, in the project you mean to share.
- The WebSocket checks the session cookie and the `Origin` header. The hook endpoint only listens on loopback and needs a random per-worker token.
- Workers don't inherit the office password or any parent agent-session variables.

## Development

```bash
npm install
npm run build        # vite (client) + tsc (server)
npm run typecheck
node bin/agent-office.js /path/to/project --password dev
```

`npm run dev` runs Vite with hot reload on :5173 and proxies to the server on :4600.
