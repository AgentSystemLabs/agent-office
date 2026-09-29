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

[**Run locally**](#run-locally) · [**Deploy to AWS**](#deploy-to-aws-ec2) · [**Any server**](#deploy-to-any-ubuntu-or-debian-server) · [**Add users**](#add-users) · [**Controls**](#controls) · [**Features**](docs/features.md) · [**How it works**](docs/how-it-works.md)

```sh
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/install.sh | bash
```

</div>

---

## What it is

- **A floor per project.** Ride the elevator, pick one of your GitHub repos, and the office clones it and opens a floor for it. Every worker, board and queue on that floor works in that checkout.
- **Workers at desks.** Walk up to an empty desk, press **E**, and pick Claude Code, Codex or OpenCode. The agent's live terminal shows on its laptop, and anyone can open it and type.
- **You can see who needs you.** A worker that needs input or has finished jumps up and down and dings. Press **N** to go straight to the one that has waited longest.
- **GitHub on the walls.** Issues and pull requests hang on cork boards. Hand an issue to a worker, queue tasks, give a worker its own git worktree and open its PR with one key. One task can span several projects: the worker gets a worktree of each, and a PR in each that links the others.
- **Together.** Voice, chat, screen sharing on the lounge TV and a shared whiteboard.

There's a lot more (a rooftop bar, an office dog, an arcade): see [docs/features.md](docs/features.md).

## Requirements

On the machine that runs the office:

- **Node.js 20+**
- At least one agent CLI, signed in as the user that runs the office: **Claude Code** (`claude`), **Codex** (`codex`) or **OpenCode** (`opencode`). With [accounts](#add-users), everyone can sign in to their own Claude from the office instead.
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

The first time it starts, it walks you through setting up, right in the terminal:

1. **Where to clone your projects.** It suggests a code folder you already have (`~/Workspace`, `~/code`…), else `~/agent-office`. Each project goes in `<folder>/<owner>/<repo>`.
2. **GitHub.** If the GitHub CLI isn't signed in, it offers to run `gh auth login` for you.
3. **Your first project.** Pick one of your repos by number, or type `owner/name`, and the office clones it as the first floor.

Press Enter to skip a step: the elevator in the office asks for your first project too. Then the office opens in your browser, **already signed in**, with a link that works once. The terminal also prints the office password, for signing in from another browser (it's saved in `~/agent-office/.agent-office/config.json`).

Walk to an empty desk, press **E** and hire a worker.

Common options:

```bash
agent-office ~/code/my-project              # use a project you already have as the first floor
agent-office --password 'correct horse'     # choose the password
agent-office --port 4700
agent-office --agent codex                  # default agent: claude, codex or opencode
agent-office --no-open                      # print the sign-in link instead of opening a browser
agent-office setup                          # the first-start walkthrough again (office stopped)
```

Every option is in [docs/configuration.md](docs/configuration.md). Choosing models and providers per worker is in [docs/agents.md](docs/agents.md).

To run it from a clone instead:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
npm install          # also builds the client and server
npm install -g .     # puts `agent-office` on your PATH
agent-office
```

> Only your computer can reach the office: it listens on `127.0.0.1`. `--host 0.0.0.0` lets your network in, but over plain http, where voice and screen sharing don't work. To share the office with a team, put it on a server: [AWS](#deploy-to-aws-ec2) or [any Ubuntu or Debian machine](#deploy-to-any-ubuntu-or-debian-server).

## Deploy to AWS (EC2)

One script, using only the AWS CLI. You need the **AWS CLI signed in** (`aws configure` or `aws sso login`), `ssh`, `curl` and a clone of this repo:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
deploy/aws.sh up --project your-org/your-repo --claude-token "$(claude setup-token)"
```

In about two minutes, `up`:

1. Launches a **t3.xlarge** (4 vCPU, 16 GiB) Ubuntu 24.04 instance with a 50 GiB disk and a fixed Elastic IP.
2. Creates a security group that opens **only SSH, only to your IP**. The office listens on `127.0.0.1:4600` on the machine and is never on the internet. Everyone reaches it through an SSH tunnel, so there are no certificates to manage, and voice and screen sharing work.
3. Runs [`deploy/provision.sh`](deploy/provision.sh) on it: Node 22, git, the GitHub CLI, Claude Code and the office, under systemd, so it comes back after a crash or reboot and workers keep running through a restart.
4. Opens a tunnel and your browser at http://localhost:4600. **The first page shows the office password once. Write it down.**

`--project` is optional: it clones that repo as the first floor. Leave it out and pick projects in the elevator.

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

## Deploy to any Ubuntu or Debian server

No AWS? Run one line on the server, as root or as a user with sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/deploy/provision.sh | bash
```

It installs Node 22, git, the GitHub CLI, Claude Code and the office as a systemd service. Run as root, it creates an `agentoffice` user to run the office, so workers never run as root. The office listens on `127.0.0.1:4600` only, and the script ends by printing the SSH tunnel command and a link that shows the office password once. Run the same line again to update.

For HTTPS on your own domain, point a DNS record at the server and add `bash -s -- --domain office.example.com`: it sets up Caddy, which gets the certificate by itself. The details, and setting it up by hand behind Caddy or nginx, are in [docs/self-hosting.md](docs/self-hosting.md).

## Add users

Everyone gets their own account, so their name is on their character, in chat and on every terminal they type into.

**1. On a server, let them in first.** The office is only reachable through an SSH tunnel, so a teammate needs their SSH key on the machine. In the office, open **☰ → 👥 Invite teammates** and type their GitHub username. On AWS you can also do it from your terminal:

```bash
deploy/aws.sh invite octocat        # installs the keys from github.com/octocat.keys
deploy/aws.sh allow 203.0.113.7     # their IP ("allow anywhere" opens SSH to every IP)
```

It prints the command to send them. They leave it running and open http://localhost:4600:

```
ssh -L 4600:localhost:4600 office@<your-office-ip>
```

Their key logs in as a locked-down `office` user that can only forward to the office port: no shell, no other ports. Running the office on your own computer, or on your own domain over HTTPS? Skip this step.

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
deploy/aws.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada --dir "$(cat /etc/agent-office/home)"'
```

**Their own Claude and GitHub.** With accounts, everyone's workers run on their own Claude plan, and the office acts on GitHub as them: comments, merges, labels, pushes and pull requests show up under their name. The first time someone comes in, **🔐 Your sign-ins** opens (it's in the **☰** menu too). *Sign in with Claude* gives them Claude's sign-in page and takes back the code it shows. *Sign in with GitHub* shows a one-time code for github.com/login/device. They can paste a token from `claude setup-token`, or a GitHub token, instead. A 🐚 shell they open at a desk runs as them, so `claude auth login` and `gh auth login` typed there work too. Admins can use the office machine's own sign-ins instead. Each account's sign-ins live in `.agent-office/homes/<account>/`, and revoking the account deletes them. The boards are read with the machine's own `gh`, so that account needs read access to the repos. Running it just for yourself, with no accounts, none of this applies.

**3. Turn off the shared password.** Until you do, anyone who knows the office password can get in, as an admin. Once everyone has an account, switch it off in **🔑 Accounts** (signed in with your own admin account), or `agent-office accounts password off`.

**Removing someone.** Revoke their account in **🔑 Accounts** (or `agent-office accounts revoke <name>`), and on a server also remove them in **👥 Invite teammates** (on AWS, `deploy/aws.sh uninvite <name>`) to take away their SSH keys and drop open tunnels (other teammates just reconnect). If the shared password is still on, change it with `deploy/aws.sh reset-password`.

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
| V | Join voice; then hold V to talk |
| M | Mute / unmute in voice |
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
- [Agents](docs/agents.md): Claude Code, Codex and OpenCode, models and effort, and the office's prompts
- [Configuration](docs/configuration.md): every command-line option, and where the office keeps its data
- [AWS reference](docs/aws.md): service tunnels, upgrades, and everything `deploy/aws.sh` does
- [Your own server](docs/self-hosting.md): the one-line setup for any Ubuntu or Debian server, or by hand behind Caddy or nginx
- [How it works](docs/how-it-works.md): the architecture, and security notes

## License

[MIT](LICENSE)
