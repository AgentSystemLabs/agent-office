> [!WARNING]
> **Work in progress.** Agent Office is built for one person's workflow — mine — and it changes fast as I iterate on it.
> Expect breaking changes between releases: keys that move, screens that get redrawn, features that come and go
> without notice. If it's close to what you want, fork or clone it and bend it into what you need it to be.

<div align="center">

*"Whatever you do, work heartily, as for the Lord and not for men."* — Colossians 3:23 (ESV)

# 🏢 Agent Office

**A 3D office your team shares with its coding agents.**

Sit **Claude Code**, **Codex**, **OpenCode**, **Grok**, **Muse**, **DeepSeek Harness** and **Cursor** workers at desks, watch each one's terminal on the laptop in front of it,
and jump into any of them together. Every GitHub repo is a floor of the building.

[![Release](https://img.shields.io/github/v/release/AgentSystemLabs/agent-office?style=flat-square&color=e8c547&label=release)](https://github.com/AgentSystemLabs/agent-office/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/AgentSystemLabs/agent-office/release.yml?style=flat-square&label=build)](https://github.com/AgentSystemLabs/agent-office/actions)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](#run-locally)
[![Built with TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178c6?style=flat-square)](https://www.typescriptlang.org)

[**Run locally**](#run-locally) · [**Deploy to AWS**](#deploy-to-aws-ec2) · [**Azure**](#deploy-to-azure) · [**Railway**](#deploy-to-railway) · [**Fly.io**](#deploy-to-flyio) · [**Dokploy**](#deploy-to-dokploy) · [**Coolify**](#deploy-to-coolify) · [**Any server**](#deploy-to-any-ubuntu-or-debian-server) · [**Add users**](#add-users) · [**Controls**](#controls) · [**Features**](docs/features.md) · [**How it works**](docs/how-it-works.md)

```sh
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/install.sh | bash
```

</div>

---

## What it is

- **A floor per project.** Ride the elevator, pick one of your GitHub repos, and the office clones it (showing how far along it is) and opens a floor for it. Every worker, board and queue on that floor works in that checkout.
- **Workers at desks.** Walk up to an empty desk, press **E**, and pick Claude Code, Codex, OpenCode, Grok, Muse, DeepSeek Harness, Pi or Cursor, each with its model and reasoning effort. The agent's live terminal shows on its laptop, and anyone can open it and type.
- **Talk instead of typing.** Hold **Ctrl+Space** (or the **🎤**) in a worker's terminal or a prompt box and say what you want: it's typed in for you to send. Your browser does the listening, so there's nothing to install.
- **You can't miss who needs you.** A worker that stops to ask you something lights a red beacon over its desk, puts a banner on your screen saying who and what for, and sounds an alarm. One that has finished jumps up and down and dings. Press **N** to go straight to whoever is waiting.
- **From your phone, too.** `/lite` is the office in 2D: every worker and what it's waiting on, its terminal with the keys a phone keyboard lacks, and the boards. The 3D office offers it on a phone or a slow computer.
- **GitHub on the walls.** Issues and pull requests hang on cork boards. Hand an issue to a worker, queue tasks, give a worker its own git worktree and open its PR with one key (if one gets deleted behind the office's back, the worker waits at its desk until you rebuild it). One task can span several projects: the worker gets a worktree of each, and a PR in each that links the others.
- **Agents that manage agents.** Every worker can list, hire, message and send home the others, through an `agent-office` MCP server (Claude Code, Codex, OpenCode) or the `office-workers` command. Ask one to "send everyone whose PR merged home" and it does, deleting their worktrees and branches unless they hold unpushed work. A worker that opens its pull request itself (`gh pr create`) shows it at its desk, and one the office missed can be told which is its own (`office-workers pr`).
- **Together.** Voice, chat, screen sharing on the lounge TV and a shared whiteboard.

- **Other maps.** Turn the whole building into a castle: sit on a throne of iron blades while your workers line up before you when they're done, send new ones off through the Hand of the King, and watch their beards grow long and grey as they toil. Send one home and the Kingsguard runs up from the dungeon, marches it down the stairs and throws it in a cell, where it starves, dies and rots down to a skeleton. Or make a map of your own, with its own way of seeing workers off in JSON ([docs/maps.md](docs/maps.md)).

There's a lot more (a rooftop bar, an office dog, an arcade, supercars in the garage to drive round a scenic loop past a farm, pines, mountains and a beach): see [docs/features.md](docs/features.md).

## Requirements

On the machine that runs the office:

- **Node.js 20+**
- At least one agent CLI, signed in as the user that runs the office: **Claude Code** (`claude`), **Codex** (`codex`), **OpenCode** (`opencode`), **Grok** (`grok`), **Muse** (`muse`), **DeepSeek Harness** (`dsh`), **Pi** (`pi`, 0.87.1+) or the **Cursor** CLI (`cursor-agent`). With [accounts](#add-users), everyone can sign in to their own Claude from the office instead.
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
agent-office --agent pi                     # default agent: claude, codex, opencode, grok, muse, dsh, pi or cursor-agent
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

> Only your computer can reach the office: it listens on `127.0.0.1`. `--host 0.0.0.0` lets your network in, but over plain http, where voice and screen sharing don't work. To share the office with a team, put it on a server: [AWS](#deploy-to-aws-ec2), [Azure](#deploy-to-azure), [Railway](#deploy-to-railway), [Fly.io](#deploy-to-flyio), [Dokploy](#deploy-to-dokploy), [Coolify](#deploy-to-coolify) or [any Ubuntu or Debian machine](#deploy-to-any-ubuntu-or-debian-server).

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

**On Tailscale, no tunnels.** If your team uses [Tailscale](https://tailscale.com), add `--tailscale`:

```bash
deploy/aws.sh up --tailscale --project your-org/your-repo --claude-token "$(claude setup-token)"
```

The machine joins your tailnet, and Tailscale Serve puts the office on `https://agent-office.<your-tailnet>.ts.net` with a real certificate. Anyone on your tailnet just opens that link: no terminal to keep open, no SSH keys, no IPs to allow, and voice and screen sharing work. `up` opens Tailscale's page to add the machine (or pass `--tailscale-auth-key tskey-auth-…`) and, the first time, the page that turns on HTTPS for your tailnet. SSH stays open to your IP only, for `deploy/aws.sh` itself. More in [docs/aws.md](docs/aws.md#tailscale).

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

**The workers' dev servers, on your computer.** The office runs on the server, so a worker's `npm run dev` listens there. Run this on your own computer and leave it running, and every web server a worker starts opens on the same port on yours, by itself (`http://localhost:5173` is the worker's), and closes when the worker stops it:

```bash
agent-office tunnel                       # while `deploy/aws.sh open` (or a teammate's ssh command) is running
agent-office tunnel office@203.0.113.7    # or by itself: it opens the tunnel to the office too
```

It works with every way of running the office on a server, and needs the `agent-office` command on your computer: [docs/tunnel.md](docs/tunnel.md).

## Deploy to Azure

The same thing on an Azure VM, using only the Azure CLI. You need the **Azure CLI signed in** (`az login`), `ssh`, `curl` and a clone of this repo:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
deploy/azure.sh up --project your-org/your-repo --claude-token "$(claude setup-token)"
```

`up` puts everything in a resource group of its own, `agent-office`, and launches a **Standard_D4as_v5** VM (4 vCPU and 16 GiB, like the t3.xlarge on AWS, at about the same price) with Ubuntu 24.04, a 64 GiB Premium SSD and a static IP. Its firewall opens **only SSH, only to your IP**. Then it runs the same [`deploy/provision.sh`](deploy/provision.sh) and opens the office through an SSH tunnel at http://localhost:4600. **The first page shows the office password once. Write it down.**

Every command from the AWS script works the same, with `deploy/azure.sh` in its place: `open`, `status`, `logs`, `ssh`, `update`, `invite`, `allow`, `service`, `resize Standard_D8as_v5`, `pause` (deallocates the VM, so only the disk and IP are billed), `resume` and `destroy` (deletes the resource group). One more, `connect`, lets a second computer manage the office. `--location` picks the region (default: your `az` default location, else `eastus`), `--subscription` the subscription and `--size` the VM size. The details are in [docs/azure.md](docs/azure.md).

## Deploy to Railway

No machine to look after: one script, using the Railway CLI. You need the **Railway CLI 5 or newer, logged in** (`railway login`), `ssh`, `curl`, Node.js and a clone of this repo:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
deploy/railway.sh up --claude-token "$(claude setup-token)"
```

In about five minutes, `up`:

1. Creates a Railway project with one service, built from this checkout with [`deploy/container/Dockerfile`](deploy/container/Dockerfile): Node 22, git, the GitHub CLI and sshd, with Claude Code installed on first start.
2. Adds a **volume on `/data`** for everything the office keeps: the password, accounts, floors and settings, the projects, Claude's and GitHub's sign-ins, teammates' keys and the SSH host key. Restarts and redeploys replace the container, never the volume.
3. Puts Railway's **TCP proxy** in front of the container's SSH, and nothing else. The office listens on `127.0.0.1:4600` inside the container and has no public URL: everyone reaches it through an SSH tunnel, as on AWS.
4. Opens a tunnel and your browser at http://localhost:4600. **The first page shows the office password once. Write it down.**

The agents and GitHub sign in as on AWS: `--claude-token`, `--anthropic-api-key`, `--github-token` or `--no-github-token`.

```bash
deploy/railway.sh open              # tunnel + open the office (Ctrl-C closes the tunnel)
deploy/railway.sh status            # deployment, SSH address, volume, is the office up, who's invited
deploy/railway.sh invite octocat    # let a teammate tunnel in with their GitHub SSH keys
deploy/railway.sh logs              # follow the office's logs (ssh: a shell in the container)
deploy/railway.sh update            # build this checkout again and redeploy it
deploy/railway.sh destroy           # delete the project and its volume (asks first)
```

The details, and what's on the volume, are in [docs/railway.md](docs/railway.md).

## Deploy to Fly.io

The same container on a [Fly.io](https://fly.io) machine, using flyctl. You need **flyctl logged in** (`fly auth login`), `ssh`, `curl`, Node.js and a clone of this repo:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
deploy/fly.sh up --claude-token "$(claude setup-token)"
```

In a few minutes, `up`:

1. Creates a Fly app with one machine, a `shared-cpu-4x` with 8 GB in the region nearest you, built from this checkout with the same [`deploy/container/Dockerfile`](deploy/container/Dockerfile) as on Railway.
2. Adds a **volume on `/data`** for everything the office keeps, so restarts, redeploys and resizes lose none of it.
3. Gives the app a **dedicated IPv4 address** with SSH on a random port, and nothing else. The office listens on `127.0.0.1:4600` inside the machine and has no public URL: everyone reaches it through an SSH tunnel, as on AWS.
4. Opens a tunnel and your browser at http://localhost:4600. **The first page shows the office password once. Write it down.**

The agents and GitHub sign in as on AWS: `--claude-token`, `--anthropic-api-key`, `--github-token` or `--no-github-token`.

```bash
deploy/fly.sh open                    # tunnel + open the office (Ctrl-C closes the tunnel)
deploy/fly.sh status                  # machine, SSH address, volume, is the office up, who's invited
deploy/fly.sh invite octocat          # let a teammate tunnel in with their GitHub SSH keys
deploy/fly.sh logs                    # follow the office's logs (ssh: a shell in the machine)
deploy/fly.sh update                  # build this checkout again and redeploy it
deploy/fly.sh resize performance-2x   # another machine size, same address and volume
deploy/fly.sh pause                   # stop the machine (resume starts it again)
deploy/fly.sh destroy                 # delete the app and its volume (asks first)
```

`--region`, `--org`, `--vm-size`, `--memory`, `--disk` and `--name` (for several offices) are in `deploy/fly.sh help`. The details, and what's on the volume, are in [docs/fly.md](docs/fly.md).

## Deploy to Dokploy

Already run a [Dokploy](https://dokploy.com) server? One script puts the office on it, through Dokploy's API. You need an **API key** (Dokploy: **Settings → Profile → API/CLI Keys**, with rate limiting off), `ssh`, `curl`, `git`, Node.js and a clone of this repo:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
export DOKPLOY_API_KEY=<your key>
deploy/dokploy.sh up --url https://dokploy.example.com --claude-token "$(claude setup-token)"
```

In about five minutes, `up`:

1. Creates a Dokploy project with one application, and uploads this checkout for Dokploy to build with [`deploy/container/Dockerfile`](deploy/container/Dockerfile), the same image as on Railway.
2. Mounts a **Docker volume on `/data`** for everything the office keeps. Deploys and restarts replace the container, never the volume.
3. Publishes the container's SSH on **port 2222 of the server** (`--ssh-port` picks another), and nothing else: no domain, and the office listens on `127.0.0.1:4600` inside the container. Everyone reaches it through an SSH tunnel, as on AWS. A firewall in front of the server has to let that port through.
4. Opens a tunnel and your browser at http://localhost:4600. **The first page shows the office password once. Write it down.**

The agents and GitHub sign in as on AWS: `--claude-token`, `--anthropic-api-key`, `--github-token` or `--no-github-token`. `--server <name>` runs it on one of Dokploy's remote servers.

```bash
deploy/dokploy.sh open              # tunnel + open the office (Ctrl-C closes the tunnel)
deploy/dokploy.sh status            # its page in Dokploy, last deployment, SSH address, who's invited
deploy/dokploy.sh invite octocat    # let a teammate tunnel in with their GitHub SSH keys
deploy/dokploy.sh logs              # follow the office's logs (ssh: a shell in the container)
deploy/dokploy.sh update            # upload this checkout again, build it and redeploy it
deploy/dokploy.sh destroy           # delete the application and its volume (asks first)
```

The details, and what's on the volume, are in [docs/dokploy.md](docs/dokploy.md).

## Deploy to Coolify

Already run a [Coolify](https://coolify.io) server? One script puts the office on it, through Coolify's API. You need **API Access** turned on (Coolify: **Settings → Configuration → Advanced**), an **API token** with read, write and deploy (**Keys & Tokens → API tokens**), `ssh`, `curl`, `git`, Node.js and a clone of this repo. Coolify builds from git, so the commit you deploy has to be pushed to a public repository: by default, the upstream of your branch.

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
export COOLIFY_API_TOKEN=<your token>
deploy/coolify.sh up --url https://coolify.example.com --claude-token "$(claude setup-token)"
```

In about five minutes, `up`:

1. Checks that this checkout's HEAD is on its upstream branch (or on `--repo` and `--branch`), and tells you what to push if it isn't.
2. Creates a Coolify project with one application, and has Coolify build that commit with [`deploy/container/Dockerfile`](deploy/container/Dockerfile), the same image as on Railway.
3. Mounts a **Docker volume on `/data`** for everything the office keeps. Deploys and restarts replace the container, never the volume.
4. Publishes the container's SSH on **port 2222 of the server** (`--ssh-port` picks another), and nothing else: no domain, and the office listens on `127.0.0.1:4600` inside the container. Everyone reaches it through an SSH tunnel, as on AWS. A firewall in front of the server has to let that port through.
5. Opens a tunnel and your browser at http://localhost:4600. **The first page shows the office password once. Write it down.**

The agents and GitHub sign in as on AWS: `--claude-token`, `--anthropic-api-key`, `--github-token` or `--no-github-token`. `--server <name>` picks one of Coolify's servers when it has more than one.

```bash
deploy/coolify.sh open              # tunnel + open the office (Ctrl-C closes the tunnel)
deploy/coolify.sh status            # its page in Coolify, last deployment, SSH address, who's invited
deploy/coolify.sh invite octocat    # let a teammate tunnel in with their GitHub SSH keys
deploy/coolify.sh logs              # follow the office's logs (ssh: a shell in the container)
deploy/coolify.sh update            # build this checkout's HEAD (pushed) and redeploy it
deploy/coolify.sh destroy           # delete the application and its volume (asks first)
```

The details, what's on the volume, and troubleshooting are in [docs/coolify.md](docs/coolify.md).

## Deploy to any Ubuntu or Debian server

Another cloud, or your own machine? Run one line on the server, as root or as a user with sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/deploy/provision.sh | bash
```

It installs Node 22, git, the GitHub CLI, Claude Code and the office as a systemd service. Run as root, it creates an `agentoffice` user to run the office, so workers never run as root. The office listens on `127.0.0.1:4600` only, and the script ends by printing the SSH tunnel command and a link that shows the office password once. Run the same line again to update.

For HTTPS on your own domain, point a DNS record at the server and add `bash -s -- --domain office.example.com`: it sets up Caddy, which gets the certificate by itself. To put it on your Tailscale network instead, add `bash -s -- --tailscale`. The details, and setting it up by hand behind Caddy or nginx, are in [docs/self-hosting.md](docs/self-hosting.md).

## Add users

Everyone gets their own account, so their name is on their character, in chat and on every terminal they type into.

**1. On a server, let them in first.** On a [Tailscale](docs/aws.md#tailscale) office, everyone on your tailnet can already open it. For someone who isn't, share the machine with them from Tailscale's Machines page: **☰ → 👥 Invite teammates** says how. Skip to step 2.

Otherwise the office is only reachable through an SSH tunnel, so a teammate needs their SSH key on the machine. In the office, open **☰ → 👥 Invite teammates** and type their GitHub username. On AWS, Railway, Fly.io, Dokploy or Coolify you can also do it from your terminal:

```bash
deploy/aws.sh invite octocat        # installs the keys from github.com/octocat.keys
deploy/aws.sh allow 203.0.113.7     # their IP ("allow anywhere" opens SSH to every IP)
deploy/railway.sh invite octocat    # on Railway, SSH answers every IP already
deploy/fly.sh invite octocat        # and on Fly.io
deploy/dokploy.sh invite octocat    # and on Dokploy
deploy/coolify.sh invite octocat    # and on Coolify
```

It prints the command to send them. They leave it running and open http://localhost:4600:

```
ssh -L 4600:localhost:4600 office@<your-office-ip>
```

(On Railway and Fly.io the address carries a port of its own, like `ssh://office@zephyr.proxy.rlwy.net:17738`. On Dokploy and Coolify it's the server's SSH port for the office: `ssh://office@203.0.113.7:2222`.)

Their key logs in as a locked-down `office` user that can only forward to the office port: no shell, no other ports. Running the office on your own computer, or on your own domain over HTTPS? Skip this step.

A teammate with the `agent-office` command on their computer can run `agent-office tunnel office@<your-office-ip>` instead of the `ssh` line: it opens the same tunnel, and every web server a worker starts opens on their computer too ([docs/tunnel.md](docs/tunnel.md)).

**2. Make them an account.** Open **☰ → 🔑 Accounts** and make an invite link. Name it (or let them pick) and make them a *Member* or an *Admin*. The link works once, for 7 days, and they choose their own password. Make one for yourself too, as an admin.

The same works from a terminal on the office's machine, even while it runs:

```bash
agent-office accounts                      # accounts and open invites
agent-office accounts invite ada --admin   # prints a single-use /join#… link
agent-office accounts role ada member
agent-office accounts revoke ada           # signed out within seconds
```

On the EC2 machine, run it through `deploy/aws.sh ssh` (on Azure, `deploy/azure.sh ssh`):

```bash
deploy/aws.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada --dir "$(cat /etc/agent-office/home)"'
deploy/railway.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada'   # on Railway
deploy/fly.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada'       # on Fly.io
deploy/dokploy.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada'   # on Dokploy
deploy/coolify.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada'   # on Coolify
```

**Their own Claude and GitHub.** With accounts, everyone's workers run on their own Claude plan, and the office acts on GitHub as them: comments, merges, labels, pushes and pull requests show up under their name. The first time someone comes in, **🔐 Your sign-ins** opens (it's in the **☰** menu too). *Sign in with Claude* gives them Claude's sign-in page and takes back the code it shows. *Sign in with GitHub* shows a one-time code for github.com/login/device. They can paste a token from `claude setup-token`, or a GitHub token, instead. A 🐚 shell they open at a desk runs as them, so `claude auth login` and `gh auth login` typed there work too. Admins can use the office machine's own sign-ins instead. Each account's sign-ins live in `.agent-office/homes/<account>/`, and revoking the account deletes them. The boards are read with the machine's own `gh`, so that account needs read access to the repos. Running it just for yourself, with no accounts, none of this applies.

**3. Turn off the shared password.** Until you do, anyone who knows the office password can get in, as an admin. Once everyone has an account, switch it off in **🔑 Accounts** (signed in with your own admin account), or `agent-office accounts password off`.

**Removing someone.** Revoke their account in **🔑 Accounts** (or `agent-office accounts revoke <name>`), and on a server also remove them in **👥 Invite teammates** (on AWS, `deploy/aws.sh uninvite <name>`; on Railway, `deploy/railway.sh uninvite <name>`; on Fly.io, `deploy/fly.sh uninvite <name>`; on Dokploy, `deploy/dokploy.sh uninvite <name>`; on Coolify, `deploy/coolify.sh uninvite <name>`) to take away their SSH keys and drop open tunnels (other teammates just reconnect). If the shared password is still on, change it with `deploy/aws.sh reset-password` (or `deploy/railway.sh reset-password`, `deploy/fly.sh reset-password`, `deploy/dokploy.sh reset-password` or `deploy/coolify.sh reset-password`).

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
| L | Hang a sign over a desk ("Operations", "Code cleanup") |
| T / Enter | Chat |
| V | Join voice; then hold V to talk |
| M | Mute / unmute in voice |
| Ctrl + Space | Dictate into a terminal or a prompt box: hold it and talk (or hold the **🎤**) |
| Tab | The ☰ menu: every window |
| Esc | Close any window |
| Ctrl + [ | Send Esc to a terminal, to close a menu like Claude's `/skills` or interrupt Claude (or **⎋ Esc** in its header) |

The full list is in [docs/controls.md](docs/controls.md).

## Development

```bash
npm install
npm run dev          # Vite with hot reload on :5173, the server on :4600 (password: dev)
npm run typecheck
npm test
```

Server edits restart the server, not the workers. After changing `ptyhost.ts`, bump `PTY_PROTOCOL` in `ptys.ts` so the next server replaces the PTY host.

[docs/code-layout.md](docs/code-layout.md) says where the code lives, and where a new feature's pieces go.

The rules for coding agents working on this repository are in [`AGENTS.md`](AGENTS.md), which Codex, OpenCode and most other agent CLIs read. `CLAUDE.md` only imports it for Claude Code, so new rules go in `AGENTS.md`.

Every change to the app that lands on `main` is published as a GitHub release by [`.github/workflows/release.yml`](.github/workflows/release.yml), and `install.sh` installs the newest one. Bump `package.json`'s version to start a new minor.

## More

- [Features](docs/features.md): everything in the office, room by room
- [Agents](docs/agents.md): Claude Code, Codex and OpenCode, models and effort, and the office's prompts
- [Configuration](docs/configuration.md): every command-line option, and where the office keeps its data
- [Maps](docs/maps.md): the castle, and making a map of your own
- [Workers' servers on your own computer](docs/tunnel.md): `agent-office tunnel`, which opens every worker's web server on your computer by itself
- [AWS reference](docs/aws.md): Tailscale, service tunnels, upgrades, and everything `deploy/aws.sh` does
- [Railway reference](docs/railway.md): what `deploy/railway.sh` sets up, and what the volume keeps
- [Fly.io reference](docs/fly.md): what `deploy/fly.sh` sets up, machine sizes, pausing and what the volume keeps
- [Dokploy reference](docs/dokploy.md): what `deploy/dokploy.sh` sets up on your Dokploy, and what the volume keeps
- [Coolify reference](docs/coolify.md): what `deploy/coolify.sh` sets up on your Coolify, building pushed commits, and what the volume keeps
- [Your own server](docs/self-hosting.md): the one-line setup for any Ubuntu or Debian server, or by hand behind Caddy or nginx
- [Azure reference](docs/azure.md): picking a VM size, pausing, and everything `deploy/azure.sh` does
- [How it works](docs/how-it-works.md): the architecture, and security notes
- [Code layout](docs/code-layout.md): where the code lives, adding a feature or an agent provider, and the size guard

## License

[MIT](LICENSE)
