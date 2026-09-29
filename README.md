<div align="center">

<img src="docs/hero.jpg" alt="A cutaway of the office building at night: five floors of desks with AI workers at glowing terminals, a glass elevator on the side, a fire pole through the floors and a rooftop bar" width="100%">

# Droid Office

**A 3D office in your browser where your team hires [Factory Droid](https://factory.ai) and other AI coding agents at desks, and shares their live terminals.**

[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/nikships/droid-office?style=for-the-badge)](https://github.com/nikships/droid-office/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/nikships/droid-office/release.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/nikships/droid-office/actions/workflows/release.yml)

</div>

## What is this?

A fork of [AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office), built around **Droid** and the way a team using Factory actually works. You walk a cartoon office with your teammates, seat an agent at a desk, and watch its real terminal on the laptop in front of it. Every project is a floor of the building, with its own desks, issue and PR boards, task queue and workers.

The original has Claude Code, OpenCode and Codex. This fork keeps all three and changes what sits around them.

## What makes this fork different

**Droid is the default agent.** New workers, board agents and queue tasks start on Droid unless you pick otherwise. Every hire, queue task and meeting can pin a Droid model and reasoning effort, read from your own `~/.factory/settings.json`, custom and [DroidProxy](https://github.com/anand-92/droidproxy) models included. The choice is kept per desk and stays with the worker across resumes. Ctrl+Enter queues and Shift+Enter adds a newline in Droid terminals. Droid workers report status through hooks, so the office knows when one is working, needs you or is done.

**DroidProxy limits on the wall.** When DroidProxy runs on the machine, the machine monitor shows every Claude, Codex and Grok sign-in it holds: how much of each 5-hour, weekly and per-model limit is used, when it resets, and which accounts are out. It shows no emails or tokens. Worker cards, the queue and the workers list draw DroidProxy models with the Factory pinwheel.

**GitLab floors as well as GitHub.** A floor can be a GitLab project, including self-managed hosts. Its board shows merge requests, its workers open them with `glab`, and every prompt the office sends is in GitLab's words (`glab`, merge request, `!12`). Adding a project lists your `gh` and `glab` repositories together.

**A Jira epic board.** An admin connects Jira Cloud once with a read-only token and gives a floor an epic. The floor's issue board gets a **Jira** tab with the epic's tickets, and so does the board on the wall. **Hand to a worker** seats a worker with the ticket as its prompt. The office never changes a ticket.

**Real VR.** The office runs in a headset browser over WebXR, tuned for Galaxy XR controllers and hand tracking. You can hire, terminal, queue, review PRs, join voice, ride the elevator, climb the ladder and grab coffee or an issue card by hand. Read [docs/vr-webxr.md](docs/vr-webxr.md).

**A dark, Factory-style look.** The whole UI is a dark industrial theme in Factory's orange, with plain labels and no decorative emoji.

**Install it as an app.** In Chrome or Edge, install the office and it opens in its own window with its own icon. Closing the window or reloading asks first, so a stray Cmd+W doesn't drop you out.

**Upstream features, kept in step.** New features from the original repo are ported in as code that fits this fork, not merged as commits, so nothing here gets overwritten. Most recently: editable office prompts and a default worker, editing and filtering by label on the boards, workers that survive upgrades, workers that go home when their PR merges, removing a floor, a first-run walkthrough, and a basketball hoop, golf tee and docs bookshelf.

## Quick start

You need Node.js 20+, `git`, and at least one agent CLI signed in: [`droid`](https://docs.factory.ai/droid-cli/cli-reference.md), `claude`, `opencode` or `codex`. For boards, sign in to `gh` (GitHub) and/or `glab` (GitLab).

macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/nikships/droid-office/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/nikships/droid-office/main/install.ps1 | iex
```

The first start in a terminal walks you through a workspace folder, a `gh` or `glab` sign-in and your first project. After that, `agent-office` starts the office and prints the URLs to share. Run the install line again to update.

From a clone:

```bash
git clone https://github.com/nikships/droid-office && cd droid-office
npm ci                        # also builds the client and server
node bin/agent-office.js --password 'correct horse battery staple'
```

Two more ways to run it, both in the [guide](docs/guide.md): [one command on AWS](docs/guide.md#one-command-on-aws) (`deploy/aws.sh up`), and [a VPS for your team](docs/guide.md#running-it-on-a-vps-for-your-team).

## Documentation

| Resource | What's in it |
| --- | --- |
| [docs/guide.md](docs/guide.md) | Every feature, the install and account options, controls, AWS and VPS setup, security notes, and how each subsystem works |
| [docs/vr-webxr.md](docs/vr-webxr.md) | Running the office in a headset: requirements, controls, and what is desktop only |
| [AGENTS.md](AGENTS.md) | Rules for changing the code: commands, conventions, and validation before a PR |
| [.env.example](.env.example) | Every environment variable the office and the installers read |

## Development

```bash
npm ci               # installs, builds, and sets up the pre-commit hook
npm run lint         # Biome; any warning fails
npm run typecheck
npm run test:coverage
npm run dev          # Vite with hot reload on :5173, server on :4600, password "dev"
```

`node bin/agent-office.js` runs the built `dist/`, so run `npm run build` after changing source. More in the guide's [Development](docs/guide.md#development) section and in [AGENTS.md](AGENTS.md).

## Credits and license

Started from [AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office), whose authors built the office, the desks, the terminals and the boards. This fork is released under the same [MIT license](LICENSE).
