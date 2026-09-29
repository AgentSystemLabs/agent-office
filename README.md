> [!WARNING]
> **Work in progress.** Agent Office is built for one person's workflow — mine — and it changes fast as I iterate on it.
> Expect breaking changes between releases: keys that move, screens that get redrawn, features that come and go
> without notice. If it's close to what you want, fork or clone it and bend it into what you need it to be.

<div align="center">

*"Whatever you do, work heartily, as for the Lord and not for men."* — Colossians 3:23 (ESV)

# 🏢 Agent Office

**A 3D office your team shares with its coding agents.**

Sit **Claude Code**, **Codex** and **OpenCode** workers at desks, watch each one's terminal on the laptop in front of it,
and jump into any of them together. Every GitHub repo is a floor of the building.

[![Release](https://img.shields.io/github/v/release/AgentSystemLabs/agent-office?style=flat-square&color=e8c547&label=release)](https://github.com/AgentSystemLabs/agent-office/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/AgentSystemLabs/agent-office/release.yml?style=flat-square&label=build)](https://github.com/AgentSystemLabs/agent-office/actions)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](#run-locally)
[![Built with TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178c6?style=flat-square)](https://www.typescriptlang.org)

[**Run locally**](#run-locally) · [**Deploy to AWS**](#deploy-to-aws-ec2) · [**Add users**](#add-users) · [**Controls**](#controls) · [**Features**](docs/features.md) · [**How it works**](docs/how-it-works.md)

```sh
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/install.sh | bash
```

</div>

---

## What it is

- **A floor per project.** Ride the elevator, pick one of your GitHub repos, and the office clones it and opens a floor for it. Every worker, board and queue on that floor works in that checkout.
- **Workers at desks.** Walk up to an empty desk, press **E**, and pick Claude Code, Codex or OpenCode. The agent's live terminal shows on its laptop, and anyone can open it and type.
- **You can see who needs you.** A worker that needs input or has finished jumps up and down and dings. Press **N** to go straight to the one that has waited longest.
- **GitHub on the walls.** Issues and pull requests hang on cork boards. Hand an issue to a worker, queue tasks, give a worker its own git worktree and open its PR with one key.
- **Together.** Voice, chat, screen sharing on the lounge TV and a shared whiteboard.

There's a lot more (a rooftop bar, an office dog, an arcade): see [docs/features.md](docs/features.md).

## Requirements

On the machine that runs the office:

- **Node.js 20+**
- At least one agent CLI, signed in as the user that runs the office: **Claude Code** (`claude`), **Codex** (`codex`) or **OpenCode** (`opencode`)
- **git**, and the **GitHub CLI** (`gh auth login`) for cloning repos and the issue and PR boards

## Run locally

Install the latest release and start the office:

```bash
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/install.sh | bash
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/install.ps1 | iex
```

This puts an `agent-office` command on your PATH, so next time just run `agent-office`. Run the install line again to update. The installer's settings (a particular release, install without starting) are listed at the top of [`install.sh`](install.sh) and [`install.ps1`](install.ps1).

Then:

1. Open **http://localhost:4600**.
2. Sign in with the office password. The first start prints it in the terminal (it's saved in `~/agent-office/.agent-office/config.json`).
3. The elevator asks for your first project. Pick a repo (or type `owner/name`) and the office clones it into `~/agent-office/<owner>/<repo>`.
4. Walk to an empty desk, press **E** and hire a worker.

Common options:

```bash
agent-office ~/code/my-project              # use a project you already have as the first floor
agent-office --password 'correct horse'     # choose the password
agent-office --port 4700
agent-office --agent codex                  # default agent: claude, codex or opencode
```

Every option is in [docs/configuration.md](docs/configuration.md). Choosing models and providers per worker is in [docs/agents.md](docs/agents.md).

To run it from a clone instead:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
npm install          # also builds the client and server
npm install -g .     # puts `agent-office` on your PATH
agent-office
```

> Teammates on your network can open the LAN address it prints, but voice and screen sharing only work over HTTPS or `localhost`. To share the office with a team, deploy it to AWS (below) or see [docs/self-hosting.md](docs/self-hosting.md).

## Deploy to AWS (EC2)

One script, using only the AWS CLI. You need the **AWS CLI signed in** (`aws configure` or `aws sso login`), `ssh`, `curl` and a clone of this repo:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
deploy/aws.sh up --project your-org/your-repo --claude-token "$(claude setup-token)"
```

In about two minutes, `up`:

1. Launches a **t3.xlarge** (4 vCPU, 16 GiB) Ubuntu 24.04 instance with a 50 GiB disk and a fixed Elastic IP.
2. Creates a security group that opens **only SSH, only to your IP**. The office listens on `127.0.0.1:4600` on the machine and is never on the internet. Everyone reaches it through an SSH tunnel, so there are no certificates to manage, and voice and screen sharing work.
3. Installs Node 22, git, the GitHub CLI, Claude Code and the office, and runs it under systemd so it comes back after a crash or reboot.
4. Opens a tunnel and your browser at http://localhost:4600. **The first page shows the office password once. Write it down.**

**Signing in the agents.** `--claude-token` uses your Claude subscription; `--anthropic-api-key <key>` uses an API key instead. Leave both out and run `/login` in the first worker's terminal. Codex and OpenCode aren't installed by the script: `deploy/aws.sh ssh` and install them yourself.

**GitHub.** Your local `gh auth token` is copied to the machine so the office can clone private repos, show the boards and push PRs. Anyone in the office can use it, so pass `--github-token <fine-grained token>` or `--no-github-token` to limit that.

Day to day:

```bash
deploy/aws.sh open                # tunnel + open the office (Ctrl-C closes the tunnel)
deploy/aws.sh status              # machine, address, is the office up, who's invited
deploy/aws.sh logs                # follow the office's logs
deploy/aws.sh ssh                 # a shell on the machine
deploy/aws.sh update              # install the latest agent-office and restart
deploy/aws.sh resize t3.2xlarge   # bigger or smaller machine, same address
deploy/aws.sh pause               # stop the machine; only the disk and IP are billed
deploy/aws.sh resume              # start it again and open it
deploy/aws.sh destroy             # delete everything it created (asks first)
```

You can also upgrade from inside the office: **☰ → ⬆️ Upgrade the office**. Other flags (`--region`, `--instance-type`, `--disk`, `--name` for several offices) are in `deploy/aws.sh help`, and the details are in [docs/aws.md](docs/aws.md).

## Add users

Everyone gets their own account, so their name is on their character, in chat and on every terminal they type into.

**1. On AWS, let them in first.** The office is only reachable through the SSH tunnel, so a teammate needs their SSH key on the machine. In the office, open **☰ → 👥 Invite teammates** and type their GitHub username, or from your terminal:

```bash
deploy/aws.sh invite octocat        # installs the keys from github.com/octocat.keys
deploy/aws.sh allow 203.0.113.7     # their IP ("allow anywhere" opens SSH to every IP)
```

It prints the command to send them. They leave it running and open http://localhost:4600:

```
ssh -L 4600:localhost:4600 office@<your-office-ip>
```

Their key logs in as a locked-down `office` user that can only forward to the office port: no shell, no other ports. Running the office locally or on your own server? Skip this step.

**2. Make them an account.** Open **☰ → 🔑 Accounts** and make an invite link. Name it (or let them pick) and make them a *Member* or an *Admin*. The link works once, for 7 days, and they choose their own password. Make one for yourself too, as an admin.

The same works from a terminal on the office's machine, even while it runs:

```bash
agent-office accounts                      # accounts and open invites
agent-office accounts invite ada --admin   # prints a single-use /join#… link
agent-office accounts role ada member
agent-office accounts revoke ada           # signed out within seconds
```

On the EC2 machine, run it through `deploy/aws.sh ssh`:

```bash
deploy/aws.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada --dir "$(cat /etc/agent-office/dir)"'
```

**3. Turn off the shared password.** Until you do, anyone who knows the office password can get in, as an admin. Once everyone has an account, switch it off in **🔑 Accounts** (signed in with your own admin account), or `agent-office accounts password off`.

**Removing someone.** Revoke their account in **🔑 Accounts** (or `agent-office accounts revoke <name>`), and on AWS also run `deploy/aws.sh uninvite <name>` to remove their SSH keys and drop open tunnels (other teammates just reconnect). If the shared password is still on, change it with `deploy/aws.sh reset-password`.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Walk (hold Shift to run) |
| Space | Jump |
| Mouse drag / wheel | Orbit / zoom the camera |
| E | Interact: hire a worker, open its terminal, read a board, sit down, ride the elevator |
| P | Give a task to a new worker, or to the one at this desk |
| C | See a worker's changes: diff, commit, open a PR |
| N | Go to the next worker that's waiting on you |
| X | Send a worker home |
| T / Enter | Chat |
| V / M | Join voice / mute |
| Tab | The ☰ menu: every window |
| Esc | Close any window |
| Ctrl + [ | Send Esc to a terminal (e.g. to interrupt Claude) |

The full list is in [docs/controls.md](docs/controls.md).

## Development

```bash
npm install
npm run dev          # Vite with hot reload on :5173, the server on :4600 (password: dev)
npm run typecheck
npm test
```

Server edits restart the server, not the workers. After changing `ptyhost.ts`, bump `PTY_PROTOCOL` in `ptys.ts` so the next server replaces the PTY host.

Every change to the app that lands on `main` is published as a GitHub release by [`.github/workflows/release.yml`](.github/workflows/release.yml), and `install.sh` installs the newest one. Bump `package.json`'s version to start a new minor.

## More

- [Features](docs/features.md): everything in the office, room by room
- [Agents](docs/agents.md): Claude Code, Codex and OpenCode, models and effort
- [Configuration](docs/configuration.md): every command-line option, and where the office keeps its data
- [AWS reference](docs/aws.md): service tunnels, upgrades, and everything `deploy/aws.sh` does
- [Self-hosting](docs/self-hosting.md): your own server, behind Caddy or nginx
- [How it works](docs/how-it-works.md): the architecture, and security notes

## License

[MIT](LICENSE)
