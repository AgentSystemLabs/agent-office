# A worker on your own machine (remote agents)

Status: **proposed**, not implemented. Target: agent-office `main`.

Back to the [README](../README.md).

## Summary

The question this document answers: I am signed into the office from my laptop. Can the agent
sitting on that laptop take a desk?

**Today, no.** Not because the office is closed to the idea, but because every worker is a child
process of the office, on the office's machine, running as the office's user:

| Where it is decided | What it says |
|---|---|
| `src/server/workers.ts:1704` | `this.host.spawn({ file: commandPath, args, ... })` — the office runs the agent CLI itself |
| `src/server/ptys.ts`, `ptyhost.ts` | terminals live in `agent-office-ptys`, a detached process reached over a **Unix socket** in that project's `.agent-office/` |
| `src/shared/protocol.ts:1146` | a client may only send `term.input`, `term.typing` and `term.resize` — bytes into a PTY that already exists on the office machine. There is no message that runs something on the client |

The consequence people hit is that the office can only ever show you agents running on the box
that serves it, configured exactly the way the office configures workers
(`docs/how-it-works.md`, security notes: per-account `CLAUDE_CONFIG_DIR`, `GH_CONFIG_DIR` and
`GIT_CONFIG_GLOBAL` under `.agent-office/homes/<account>/`, with `ANTHROPIC_API_KEY`,
`CLAUDE_CODE_OAUTH_TOKEN` and `GH_TOKEN` stripped from the child). Your laptop's agent is not
yours from the office's point of view; it is a different machine with different logins, and the
office has no path to it.

This document proposes a **`remote` worker**: a paired bridge process on your own machine that
spawns your agent, hands the office a terminal and status, and takes instructions back. The
terminal half is cheap. The honest half of the design is the list of office features that assume
a worker's files are on the office's disk, and therefore have to be refused rather than
half-broken.

## Why this needs a decision at all

The office already has the right seam, which is why this is worth doing rather than a hack.

`Pty` (`src/server/ptys.ts:41`) is a small interface — `write`, `resize`, `kill` and the two
subscriptions — and it already has two implementations: a local `pty.spawn`, and `RemotePty`,
which forwards the same operations to the PTY host over a socket (`src/server/ptys.ts:105`).
Everything downstream of a PTY is transport-agnostic: `follow`
(`src/server/workers.ts:1872`) writes the bytes into a headless xterm and ships them to viewers,
`newTerm` (`:1839`) keeps the screen, and from there the snapshot on join, scrollback, search
(`src/server/history.ts`) and screen sharing all follow without knowing where the process is.

So a third `Pty` implementation — one whose process lives on somebody's laptop, reached over the
office's own WebSocket — is a small thing. The expensive part is everything that is not transport:

- **Status** comes from hooks that `curl` a loopback-only server (`src/server/server.ts:296`, bound
  at `:493`). On the bridge's machine that URL points at the bridge's own loopback.
- **The filesystem.** Worktrees, the Changes window, pull requests, send-home cleanup, meetings
  and across-repository workspaces all name paths on the office's disk.
- **Cost.** `src/server/usage.ts` reads `~/.claude/projects/<dir>/<session>.jsonl` and
  `codex-usage.ts` reads rollouts under `CODEX_HOME`, both next to the office.

## Alternatives considered

### A wrapper script as `--agent`

`--agent` takes one executable (`resolveCommand`, `src/server/workers.ts:2432`), and
`--agent-args` adds arguments, so this works today with no code at all:

```bash
agent-office /path/to/project --agent /usr/local/bin/my-agent-wrapper
```

where the wrapper is a shell script that `ssh`es to your laptop, or `docker exec`s into a
container, or `tmux new-session -t`es into something already running. It is labelled **Custom**
(`src/server/agents.ts:21`) and gets a real terminal in the office.

What you get: the terminal, the avatar, the desk, sharing, scrollback, the queue seating it. What
you do not get: **status**. The agent's hooks run on the far machine and post to
`$AGENT_OFFICE_HOOK_URL`, which is `http://127.0.0.1:<port>` on the *office's* loopback, so every
hook fails, the desk sits at *idle* from launch and stays there, `needs_input` never fires, and
there is no cost.

A determined wrapper can route that port: the office asks for the same hook port on every restart
and only falls back to a random one when it is taken (`src/server/server.ts:498`), so `ssh -R
<port>:127.0.0.1:<port>` plus a listener on the far machine often does bring status back. That is
also the whole fragile part of the hack, and it does not survive the port moving.

**Verdict: the honest halfway point, and the thing to tell someone who asks today.** It is also
the baseline this design has to beat, which is a low bar for the terminal and a high one for status.

### Mounting the laptop's filesystem instead

Share the checkout over NFS or SSHFS and let the office spawn locally into it. Rejected: the
office would still rewrite the child's environment and write its hook settings into your worktree,
`changes.ts` would `git status` across a network mount every two seconds, and every failure would
look like a flaky agent rather than a wrong architecture. It also inherits the worst property of
both worlds — a remote agent driven by local env.

### The `agent-office` MCP server or `office-workers` from the laptop

This is the reverse direction and it is already built, but it is not a route in: the hook server
binds `127.0.0.1` only, and `/office/workers` requires the calling worker's own id and random
per-worker bearer token (`src/server/office-workers.ts:174`, checked at `src/server/workers.ts:583`).
A laptop has neither. Those tools are for agents **inside** the office managing each other.

### A shared shell at an empty desk

Press **B** for a plain login shell on the office machine. Useful, and free, but a shell is not a
worker: no status, no PR, no avatar, no queue accounting, no meeting seat. It is what you have
today when what you want is "my own tooling, in the office".

### A second office on the laptop

`agent-office ~/code --agent opencode` gives you your own agents, your own logins and your own
configuration, on your machine. Two offices do not see each other, and there is no cross-office
control today; a floor's board agents cannot hire into another building. This is the correct answer
for "I want my agents on my machine" and it is one command away. What it does not give you is
sharing the team: your colleagues' office is a different building with its own workers, queue and
boards.

## The bridge

`agent-office-bridge` — a plain-Node CLI, sitting in `bin/` next to `office-workers.js` and
`office-queue.js`, and the only new moving part. It runs on the machine that owns the agent.

One difference from its two neighbours, which matters: those are copied into a floor's
`.agent-office/bin/` and put first on every worker's `PATH`, because they run *inside* the office.
A bridge runs on a machine that may never have run an office at all, so it also has to be
installable there — `npm i -g agent-office`, or a single file copied over — and it has to work
with no office checkout, no floors and no accounts to read.

```bash
agent-office-bridge --office https://office.example.com --name laptop
# → a one-time code: 4F2A-9C
# approve it in ⚙️ Settings → 🌉 Bridges (an admin), or `agent-office bridges approve 4F2A-9C`
```

### Pairing, not a shared secret

A bridge is a long-lived credential for running code on somebody's machine, which the office's
security notes already treat as SSH-equivalent. So pairing is deliberate and revocable, modelled
on the existing single-use invite links (`src/server/accounts.ts:113`): the bridge generates a
short code, an **admin** approves it, and the office writes a token to
`.agent-office/bridges.json` (mode `0600`) that the bridge stores in its own `0600` file. Revoking
a bridge in Settings drops it immediately, like revoking an account. The token is scoped to one
floor and one account, and it is what the socket presents.

The bridge is **not** authenticated by a browser session cookie. `/ws` requires
`sameOrigin` and a session (`src/server/server.ts:1114`), both of which are right for a browser
and wrong for a CLI; bridges get their own upgrade path, `/bridge`, refused unless the presented
token matches a live one.

### Frames

The office's side is a third `Pty` implementation, so the message shapes are the PTY host's
(`src/server/ptys.ts:64`), which are already newline-delimited JSON and already have a `lost`
story. Office → bridge:

| Frame | What it means |
|---|---|
| `hello {token, floor, agent}` | who I am; answered with `ready {agent, version}` or `refused {why}` |
| `seat {workerId, cwd, env, cols, rows, prompt?, resume?}` | spawn the agent in a PTY, in `cwd`, with `env` |
| `input {workerId, data}` | someone typed in the office |
| `resize {workerId, cols, rows}` | the terminal changed size |
| `stop {workerId}` | send it home |

Bridge → office:

| Frame | What it means |
|---|---|
| `data {workerId, data}` | the agent's output, mirrored office-side like any worker |
| `exit {workerId, exitCode, error?}` | the agent ended |
| `hook {workerId, event, body}` | a status report, forwarded (see below) |
| `bye` | the bridge is going away; its workers go `offline`, resumable |

When the socket drops, the office does what it already does for a lost PTY host
(`src/server/ptys.ts:297`): every worker on that bridge is marked as its terminal having been
lost, and mid-turn workers are flagged interrupted so **R** resumes them rather than pretending
they finished (`src/server/workers.ts:1893`).

### Status without a second protocol

Every status bridge the office already generates reads its endpoint out of the environment —
`AGENT_OFFICE_HOOK_URL` and `AGENT_OFFICE_HOOK_TOKEN` (`src/server/workers.ts:1646`, and
`codex.ts:152`, `opencode.ts:66`, `grok.ts:189`, `muse.ts:257`). None of them knows or cares that
the URL is a port on `127.0.0.1`.

So the bridge opens its own loopback listener and reports the port in `ready`. The office points
`AGENT_OFFICE_HOOK_URL` at **that** instead, and the bridge forwards each request over the socket
as a `hook` frame, adding the worker id and token on the way. Every status path the office has
today — Claude's hooks, the OpenCode plugin, the Codex helper, Grok's and Muse's isolated homes —
then works unchanged, and so do `needs_input`, the jump and the ding, and `office-workers` inside
the remote agent if Phase 3 lands.

The security rule that comes with it: the bridge's own endpoint is unauthenticated on the bridge's
loopback, so it must never be reachable from off the machine, and the office must accept a
forwarded hook **only** for the worker id that socket is paired to, with the same `safeEq` token
check the loopback path uses.

## Mapping onto agent-office

| Concern | File | Change |
|---|---|---|
| Worker state, persistence, restore | `src/server/workers.json` via `src/server/workers.ts:262` | `WorkerInfo.remote?: { bridgeId, host, label }`; a remote worker restores as `offline` and waits for its bridge, like a DeepSeek Harness worker does today (`src/server/workers.ts:1524`) |
| `Pty` implementations | `src/server/ptys.ts` | a third implementation, `BridgePty`, beside `RemotePty` |
| Bridge registry, pairing, `/bridge` upgrade | new `src/server/bridges.ts` | modelled on `accounts.ts` |
| Provider validation | `src/server/agents.ts` | `validateWorkerModel` / `validateWorkerEffort` must refuse an office-side model or effort for a remote worker: the bridge's own settings decide those, and an office that appears to set them would be lying |
| Client frames | `src/shared/protocol.ts` | none. The office speaks to the bridge in bridge frames; browsers see an ordinary worker |
| Status handlers | `src/server/server.ts:296` and the per-provider bridges | none, given the `hook` frame above |
| Sign-ins, `runAs` | `src/server/signins.ts`, `workers.ts:1670` | unchanged and unused: a remote worker runs with the bridge owner's logins, always. `owner` is still recorded so work is attributed |

## What a remote worker cannot do

This is the part worth arguing about, so it is stated as refusals rather than as degraded modes.
A feature that silently does half a thing is worse than one that says no.

| Feature | Why not | What the office should do |
|---|---|---|
| **Own git worktree** | the worktree is a path on the office's disk, cut with `git worktree add` in `src/server/worktrees.ts` | the hire dialog's *own git worktree* is unchecked and disabled for remote |
| **Changes window** | `git status`/`git diff` every two seconds in a folder the office cannot see (`docs/how-it-works.md`) | the window says the worker is remote and offers nothing |
| **O** (push, `gh pr create`) | the office runs `git` and `gh` in the worker's folder | not available; the bridge can do it itself and the office learns the PR number when the agent posts it |
| **Send-home cleanup** | deleting a worktree and branch it never made | keep the token messages, skip the cleanup, and say so |
| **Meetings** | a meeting is one shared worktree on disk, handing files between seats and checking each part's file appeared (`src/server/meetings.ts`) | refuse a remote worker as a meeting seat, at hire time and in the meeting dialog |
| **Across repositories** | a workspace is a folder of `git worktree add`s (`WorkerInfo.repos`) | unavailable |
| **The budget and the ledger** | `--budget` and `.agent-office/usage.json` are Claude-only and read office-side transcripts | remote usage is shown per worker if the bridge reports it, and is explicitly **not** in the budget — say so on the panel rather than showing a number that is not counted |
| **Board agents** (`station-issues`, `station-pulls`, `station-queue`) | they act for the floor and need `office-queue` and the office's `gh` | not offered |

Counting a remote worker against `--max-workers` and the queue's *workers at once* is left as an
open question below. The recommendation is yes: it holds a seat in the room and spends somebody's
tokens.

## Phases

### Phase 0 — spike (throwaway)

A hand-written bridge that connects, seats a Claude in a local PTY, forwards bytes, and answers
one synthetic `hook` frame. Measure: does the office's headless-xterm mirror stay correct through
a laptop's latency and a reconnecting socket, and is there any ordering problem between `data` and
`hook` that the office's status machine cannot absorb? If output and status race visibly, the
design needs a sequence number per frame and that is worth finding out now.

### Phase 1 — the bridge and the pairing

`src/server/bridges.ts`, the `/bridge` upgrade, the `BridgePty`, the `remote` field, the hire
dialog's checkbox disabled with a sentence saying why, and the bridge's loopback hook endpoint.
Deliverable: a remote worker with a terminal, status, `needs_input`, resume and send-home. This
is the whole of the value, and it is one phase of work.

### Phase 2 — polish

Pause/resume across a bridge restart, the reconnecting socket, "3 bridges connected" in the
Workers panel, the toast when a bridge pairs or is revoked, `agent-office bridges` in the CLI
alongside `accounts`.

### Phase 3 — the command, not just the terminal

Write `.agent-office/bin/office-workers` equivalents for the bridge machine: a small client that
speaks the same `/office/workers` and `/office/queue` HTTP shapes through the socket. A remote
agent could then hire, tell and send home workers like any other. Not `office-queue`: board agents
stay office-side.

### Phase 4 — pull requests, if they are wanted

The bridge reports a PR number (its own `gh`, its own identity) and the office records it on the
worker, so the boards and the gong work while the worktree, Changes and cleanup stay refused. The
`workerPr` (`src/shared/status.ts:34`) and `landedWork` (`src/server/leave-on-merge.ts`) logic only
needs the number and the merged state, both of which the bridge can supply.

## Risks and open questions

1. **A bridge is remote code execution on a person's machine, held open.** It is the sharpest new
   security surface in the project. Admin-only approval, one floor per token, immediate
   revocation, the token in a `0600` file, and the paired machine named over the desk in the room.
   Decide whether the office logs a chat line every time a bridge pairs.
2. **The bridge's loopback endpoint is unauthenticated.** Anything running as that user can post
   hook frames. Bind it to `127.0.0.1`, refuse to bind a routable address, and have the office
   treat a forwarded hook as only as trustworthy as the socket that sent it.
3. **Status races output.** Claude's `Stop` hook can beat the last PTY bytes; today the office reads
   them from one process in one order. Phase 0 measures this; if it is real, frames carry a
   sequence number.
4. **Latency and the terminal.** The office resizes the PTY to whoever is typing, and a bridge
   turns that into a round trip. Debouncing resize office-side is likely necessary.
5. **Do remote workers count against the queue?** They consume a seat and money. Recommend yes.
6. **Two offices, one person.** A laptop running its own office *and* bridging into the team office
   is a legitimate and probably common setup. Decide whether that is supported, tolerated, or
   refused, before someone does it and files a bug.
7. **A worker that walks.** A laptop that sleeps mid-turn is a worker whose terminal was lost.
   The office has one honest answer already (`offline`, resumable with **R**) and should use it
   rather than inventing a new state.

## Testing strategy

The suite runs with `node --test` over `tests/*.test.ts` and never needs a real agent installed.
The office's convention is to test the generated status bridge and payload normalisation, not the
upstream CLI, and remote workers should follow it:

- **`tests/bridge.test.ts`** — a fake bridge process (a `WebSocketServer` on an ephemeral port)
  driven through the real `BridgePty` and the real pairing check. Assert the seat handshake, byte
  and resize round trips, exit codes, hook forwarding, and that a forwarded hook for another
  worker's id is refused.
- **`tests/workers.test.ts`** — persistence and restore of a remote worker, including the
  `offline`-until-the-bridge-returns boot path and the interrupted-mid-turn flag on a dropped
  socket.
- **`tests/agents.test.ts`** — model and effort validation refusing a remote worker.
- A lost-socket test that no remote worker is left in `working` forever.

## Appendix: evidence

| Claim | Source |
|---|---|
| The office spawns the agent CLI itself | `src/server/workers.ts:1704` |
| `Pty` is a small interface with two implementations today | `src/server/ptys.ts:41`, `:105`, `:216` |
| The PTY host is a local detached process on a Unix socket | `src/server/ptys.ts:340`, `src/server/ptyhost.ts` |
| A lost host marks its terminals lost and workers resume | `src/server/ptys.ts:297`, `src/server/workers.ts:1893` |
| Clients may only type into an existing PTY | `src/shared/protocol.ts:1146` |
| The hook server binds loopback and checks a per-worker token | `src/server/server.ts:296`, `:493`, `src/server/workers.ts:583` |
| Every status bridge takes its endpoint from the environment | `workers.ts:1646`, `codex.ts:152`, `opencode.ts:66`, `grok.ts:189`, `muse.ts:257` |
| `/ws` needs a same-origin session; accounts use single-use invites | `src/server/server.ts:1114`, `src/server/accounts.ts:113` |
| Workers get rewritten config homes and stripped credentials | `docs/how-it-works.md`, security notes |
| Meetings need one shared worktree on disk | `src/server/meetings.ts`, `docs/how-it-works.md` |
| Cost and the budget are Claude-only, read office-side | `src/server/usage.ts`, `docs/agents.md` |
