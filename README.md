<div align="center">

<img src="docs/hero.jpg" alt="A cutaway of the office building at night: five floors of desks with AI workers at glowing terminals, a glass elevator on the side, a fire pole through the floors and a rooftop bar" width="100%">

# Droid Office

### Your AI agents deserve a desk. Your team deserves to see them work.

**A 3D office in your browser where you and your teammates hire Factory Droid, Claude Code, Codex and OpenCode workers, walk over to their desks and step into their live terminals.**

[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/nikships/droid-office?style=for-the-badge)](https://github.com/nikships/droid-office/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/nikships/droid-office/release.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/nikships/droid-office/actions/workflows/release.yml)

</div>

---

## Stop babysitting tabs

Five agents in five terminals is a mess. You lose track of who is stuck, who finished and who is waiting on you. Nobody else on the team can see any of it.

Droid Office turns that into a place. Every agent sits at a desk with a laptop showing its real terminal. A worker that needs you jumps up and dings. A worker that is done does a little spin and throws confetti. You see the whole picture from across the room, and so does everyone you invite.

<img src="docs/desk.jpg" alt="A robot worker at its desk with a green terminal, confetti bursting because it just finished, two teammates watching" width="100%">

## What you get

- **A desk for every agent.** Walk up, press **E**, pick Droid, Claude Code, Codex or OpenCode, and a worker sits down. Its live terminal opens on the laptop in front of it.
- **One terminal, many hands.** Teammates can step into the same session at the same time and see who is typing. Late joiners get the full scrollback.
- **A floor per project.** Ride the elevator, pick one of the git projects you already have, and the office opens a new floor in it, right where it is. Nothing is cloned. Each floor has its own desks, boards, task queue and workers.
- **Boards you can touch.** Issues and pull requests hang on the wall. Take a card off the board, carry it across the room, and hand it to a worker.
- **A task queue that works while you don't.** Queue tasks and walk away. Each one gets a fresh worker on its own git branch, and the PR shows up on the board when it's ready.
- **Meetings between agents.** Seat two to five workers at the glass meeting table for a debate, a lead-and-team split, a red-versus-blue attack on your change, or a review panel that posts one merged review on the PR.
- **Voice, screen share and a whiteboard.** Talk to your team, put your screen on the lounge TV and draw together.
- **A place worth being in.** A rooftop bar, a basketball hoop, a golf tee, an arcade cabinet, a jukebox, and weather outside the windows that follows a real city if you ask.

<img src="docs/meeting.jpg" alt="Robot workers and a person around a glass meeting table with a whiteboard of diagrams behind them" width="100%">

## Why Droid Office

This started as a fork of [agent-office](https://github.com/AgentSystemLabs/agent-office) and went its own way. It's built for teams that live in Factory.

### Droid is the star
Droid is the default agent. Hire a worker on any Droid model, including custom and [DroidProxy](https://github.com/anand-92/droidproxy) ones, at the reasoning effort you choose. The office remembers your pick per desk and keeps it with the worker across restarts. It shows you when a Droid worker is working, waiting on you or done.

### See your limits before you hit them
Run DroidProxy on the machine and the monitor on the wall shows every Claude, Codex and Grok sign-in it holds: how much of each 5-hour, weekly and per-model limit is used, when it resets, and which accounts are out. No emails, no tokens.

### GitLab is a first-class citizen
A floor can be a GitLab project, on gitlab.com or your own host. Merge requests fill the PR board, workers open them with `glab`, and every prompt the office sends speaks GitLab.

### Jira on the wall
Connect Jira Cloud once with a read-only token, give a floor an epic, and its tickets appear as a **Jira** tab on the board. Hand any ticket to a worker with one click. The office never writes to Jira.

### Step inside in VR
Open the office in your headset's browser and walk in. Hire workers, read terminals, review PRs, join voice, climb the ladder and pick up an issue card with your own hands. It's tuned for Galaxy XR controllers and hand tracking. See the [VR guide](docs/vr-webxr.md).

<img src="docs/vr.jpg" alt="A person in a VR headset reaching out to take an issue card off the office board" width="100%">

### Built like a Factory
A dark, industrial look in Factory orange. Install it as an app from Chrome or Edge, and it asks before a stray Cmd+W closes your office.

### Always improving
Every new feature that ships in the original project is brought over, adapted to this fork and its Droid, GitLab and VR work. The latest additions: rewrite every prompt the office sends, set a default worker, edit and filter issues by label on the boards, keep workers running through upgrades, send workers home when their PR merges, and browse your project's docs at the office bookshelf.

<img src="docs/rooftop.jpg" alt="The rooftop bar at night with a fire pit, a DJ robot, people and robots with drinks, and a golf tee looking over the city" width="100%">

## Get started in a minute

You need Node.js 20+, `git`, and one agent CLI signed in ([`droid`](https://docs.factory.ai/droid-cli/cli-reference.md), `claude`, `codex` or `opencode`). For the boards, sign in to `gh` for GitHub or `glab` for GitLab.

**macOS and Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/nikships/droid-office/main/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/nikships/droid-office/main/install.ps1 | iex
```

That installs the latest release and starts the office. It asks which folder your projects are in and lets you pick your first one. It uses your existing checkouts where they are and never clones anything. Then it prints the link to share with your team. Run the same line again any time to update.

## Take it further

| Guide | What's in it |
| --- | --- |
| [The full guide](docs/guide.md) | Every feature, accounts and invites for your team, controls, running it on AWS in one command or on your own server, and how it all works |
| [VR guide](docs/vr-webxr.md) | Running the office in a headset, with controls and what's desktop only |

## Credits and license

Droid Office began as a fork of [AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office), whose authors built the office, the desks, the terminals and the boards. It's released under the same [MIT license](LICENSE).
