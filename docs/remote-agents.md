# Remote agents: your machine's workers in someone else's office

Status: **proposed**, not implemented. Target: agent-office `main`.

Back to the [README](../README.md).

## Summary

The requirement this document is written against:

> I am a member in an office that isn't mine. I want some of the agents on my machine to work
> there, at desks, next to everyone else's, and I want the people I work with to be able to use
> them.

**Today, none of that is possible.** Every worker is a child process of the office, on the office's
machine, running as the user that runs the office:

| Where it is decided | What it says |
|---|---|
| `src/server/workers.ts:1704` | `this.host.spawn({ file: commandPath, args, ... })` — the office runs the agent CLI itself |
| `src/server/ptys.ts`, `ptyhost.ts` | terminals live in `agent-office-ptys`, a detached process reached over a **Unix socket** in that project's `.agent-office/` |
| `src/shared/protocol.ts:1146` | a client may only send `term.input`, `term.typing` and `term.resize` — bytes into a PTY that already exists on the office machine |

There is no message that runs something on a client, and no way to make one.

The proposal is a **`remote` worker**: a bridge process on your machine that spawns your agent,
hands the office a terminal and status, and takes instructions back. The terminal and the status
are the easy halves, and there is a clean trick that gets both nearly free. The hard half is that
this is the first feature where **the office's members can reach a machine the office does not
own**, and that has to be designed rather than assumed.

## What this does to the office's trust model

The office's security notes say it plainly today:

> Anyone who can sign in can drive Claude Code, OpenCode, Codex, Grok, Muse or DeepSeek Harness in
> that directory, and through it run commands as the user that runs the office. Treat the password,
> the accounts and the invite links like SSH access.

That sentence has a comforting property: the blast radius is **one machine, and it is the machine
the office already runs on**. Everyone who can type into a worker can already type into a shell at
the desk, because that is what a worker is.

Remote workers remove the property. With a bridge seated, the same sentence means: anyone on that
floor can drive a shell **on your machine**, as you, for as long as the worker is at its desk — and
a member who is not you wrote the prompt that runs there. Three consequences follow, and the
design below is mostly about containing them rather than preventing them, because the people using
this have said they want the collaboration:

1. **Typing is a shell on somebody else's laptop.** The office already gives this to every member
   (there is no per-desk permission anywhere in the codebase), so choosing it costs nothing to
   build. It does mean `~/.claude`, `~/.config/gh`, SSH keys, `.env` files and cloud credentials
   on that machine are reachable by typing. Mitigation in [Containment](#containment-on-the-bridge-machine).
2. **Other people's prompts execute as you.** This is the one with no mitigation in the office
   today. The office isolates a worker by giving it its own git worktree — a path on the
   *office's* disk (`src/server/worktrees.ts`) — which protects the office's checkout and does
   nothing for yours. Two people hiring onto the same machine would also share one directory and
   corrupt each other's work.
3. **Your tokens, your disk, your CPU.** An office that can hire onto your machine can spend your
   provider account and fill your filesystem. That needs a seat limit and a visible bill, below.

The office's own words about its security model stay true and get wider, not narrower. A bridge
socket is now among the most privileged things the office holds, and it should be treated like the
sign-in link: admin-approved, single-use to establish, revocable, and named in the room.

## The easy halves

### The terminal is nearly free

`Pty` (`src/server/ptys.ts:41`) is a small interface — `write`, `resize`, `kill` and the two
subscriptions — and it already has two implementations: a local `pty.spawn`, and `RemotePty`, which
forwards the same operations to the PTY host over a socket (`src/server/ptys.ts:105`, `:216`).
Everything downstream of a PTY is transport-agnostic: `follow` (`src/server/workers.ts:1872`)
writes bytes into a headless xterm and ships them to viewers, `newTerm` (`:1839`) keeps the
screen, and from there the snapshot on join, scrollback, search (`src/server/history.ts`) and
screen sharing all follow without knowing where the process is.

So a third `Pty` implementation — one whose process lives on a member's laptop, reached over the
office's own WebSocket — is a small thing.

### Status is nearly free too

Every status bridge the office already generates reads its endpoint out of the environment:
`AGENT_OFFICE_HOOK_URL` and `AGENT_OFFICE_HOOK_TOKEN` (`src/server/workers.ts:1646`, and
`codex.ts:152`, `opencode.ts:66`, `grok.ts:189`, `muse.ts:257`). None of them knows or cares that
the URL happens to be a port on `127.0.0.1`.

So the bridge opens its own loopback listener and reports the port in `ready`. The office points
`AGENT_OFFICE_HOOK_URL` at **that** instead, and the bridge forwards each request over the socket
as a `hook` frame, adding the worker id and token on the way. Claude's hooks, the OpenCode plugin,
the Codex helper, Grok and Muse then all work unchanged, and so do `needs_input`, the jump, the
ding, and the resume path.

The security rule that comes with it: the bridge's own endpoint is unauthenticated on the bridge's
loopback, so it binds `127.0.0.1` and nothing else, and the office accepts a forwarded hook **only**
for the worker id that socket is paired to, with the same `safeEq` token check the loopback path
uses.

## Containment on the bridge machine

This is the part that makes "everyone can type" and "the office can hire" survivable. It is the
bridge's job, not the office's, because it is the bridge's machine.

**Each seated worker gets its own checkout.** The bridge cuts a git worktree per worker on the
member's machine, exactly as `src/server/worktrees.ts` does on the office's — same code, other
side of the socket. Two people hiring onto one laptop get two directories, not one fight. The
office shows each remote desk its branch, so the team can see whose is whose, and send-home removes
the worktree it made.

**Optionally, each worker gets its own container.** `--isolate container` runs the agent in a
container with the worktree mounted and the host's home **not** mounted, which is the difference
between "the office can read my SSH keys" and "the office can read the project". It costs a
Dockerfile and one flag, needs no office changes, and is what should be recommended in the pairing
dialog to anyone bringing a machine they care about. A `--isolate none` default is honest for a
throwaway machine and wrong for a laptop, so the pairing dialog should say which one is on.

**Scrollback retention is a decision, not a default.** The office keeps each worker's last 3,000
lines and serves `/api/search` over them (`docs/how-it-works.md`). For a remote worker that buffer
may contain a credential somebody typed, and it lands in a file on a machine the typist does not
control. Remote workers should default to **no retained scrollback** — the terminal still works,
the last screen still shows, and what was typed does not outlive the session. Members who want the
history for debugging can opt in per bridge.

## The office hiring onto your machine

Asked for directly, so it is designed rather than left as a limitation.

**Seats.** The bridge declares its capacity when it says `ready` (`--seats 2`, default 1) and the
office refuses a hire beyond it with a message naming the machine: *Bolt's laptop has no free desk*.
A remote worker counts against `--max-workers` and the queue's *workers at once*: it holds a seat in
the room and it spends somebody's money.

**A human may hire freely; an agent needs the bridge to be accepting.** A person in the office
clicking *Hire* has chosen to do that. A queue agent or a board agent writing a task has not — it
is a stranger's prompt landing on your machine, and the board agents are explicitly built to accept
tasks on other people's behalf (`office-queue add`, with `--disallowedTools Edit Write` so they
cannot touch the checkout themselves). So the bridge is **accepting work** or it is not, toggled on
the bridge (`agent-office-bridge --accept`, or a key while it runs) and shown in the room as a
light over the desks. Agents may only hire onto a bridge that is accepting; people may always hire.

**A sleeping laptop must not break the queue.** If no bridge is connected, a remote-targeted task
stays **queued**, visibly, with the machine named. It is never failed and never silently retried
onto somebody else's machine — the failure mode of "your laptop was asleep" should read as a laptop
that was asleep.

**Attribution and money.** `WorkerInfo.owner` and `createdBy` already record who asked and whose
sign-ins a worker runs as (`src/server/workers.ts:1670`); a remote worker reuses `owner` for the
person who brought the machine, and the sign over the desk names it — *💻 Bolt's laptop* — so
nobody in the room mistakes it for an office machine. Cost is reported **by the bridge**, from the
provider's own numbers, and shown per worker. It is explicitly *not* in the office's budget: the
ledger reads office-side transcripts (`src/server/usage.ts`), so a remote worker's spend is labelled
as reported rather than counted, and the panel says so rather than showing a number that isn't in
the total.

**Pull requests are required, not optional.** The boards, the gong and the PR window all find a
worker through its branch and worktree, both on the office's disk. An agent on your machine has
neither, so without this your workers are invisible on every board and the gong never rings — which
is the difference between collaborating in a shared office and a stranger's machine being quietly
busy. The bridge reports the PR number and its state (`workerPr`, `src/shared/status.ts:34`;
`landedWork`, `src/server/leave-on-merge.ts`) from its own `gh` and its own git identity, and the
office records it. It is Phase 1 work, not a later phase.

## What a remote worker cannot do

Stated as refusals rather than degraded modes: a feature that silently does half a thing is worse
than one that says no.

| Feature | Why not | What the office should do |
|---|---|---|
| **The office's worktree** | a path on the office's disk | the bridge makes its own; the office shows the branch, not the folder |
| **Changes window** | `git status`/`git diff` every two seconds in a folder the office cannot see | says the worker is remote and offers nothing |
| **Meetings** | a meeting is one shared worktree on disk, handing files between seats and checking each part's file appeared (`src/server/meetings.ts`) | refuse a remote worker as a meeting seat, at hire time and in the meeting dialog |
| **Across repositories** | a workspace is a folder of `git worktree add`s in the office's checkout (`WorkerInfo.repos`) | unavailable |
| **Send-home cleanup** | the office has no worktree to delete | the bridge cleans up its own; the office says who did |
| **The budget and the ledger** | `--budget` and `.agent-office/usage.json` are Claude-only and read office-side transcripts | reported by the bridge, shown as reported, never counted in the budget |
| **Board agents** (`station-issues`, `station-pulls`, `station-queue`) | they act for the floor and need the office's `gh` and its checkout | not offered; they may only *enqueue* onto an accepting bridge |
| **Another member's machine** | one bridge may not reach another's workers | enforced in the authority rule below |

### The authority rule for a remote agent inside the office

Every worker, whichever machine it runs on, gets the `office-workers` command and the `agent-office`
MCP server (`docs/how-it-works.md`). A remote worker therefore has the office's own authority, and
that has to be narrowed once "the office" is more than one machine:

- A remote worker may list, hire, tell and send home **office-local** workers, and workers **on its
  own bridge**.
- It may **not** send home or interrupt a worker on a **different member's bridge**, and may not
  hire onto one that is not accepting. Cross-machine authority is the office's, not a worker's.
- It still cannot send itself home, and `createdBy` on anything it does is the bridge owner, so the
  toast in the room says whose machine did it.

## The bridge

`agent-office-bridge` — a plain-Node CLI sitting in `bin/` next to `office-workers.js` and
`office-queue.js`, and the only new moving part. It runs on the machine that owns the agent.

One difference from its two neighbours, which matters: those are copied into a floor's
`.agent-office/bin/` and put first on every worker's `PATH`, because they run *inside* the office. A
bridge runs on a machine that may never have run an office at all, so it also has to be installable
there — `npm i -g agent-office`, or one file copied over — and has to work with no office checkout,
no floors and no accounts to read.

```bash
agent-office-bridge --office https://their-office.example.com --name laptop --seats 2 --isolate container
# → a one-time code: 4F2A-9C
# an admin approves it in ⚙️ Settings → 🌉 Bridges, or `agent-office bridges approve 4F2A-9C`
```

### Pairing

Modelled on the existing single-use invite links (`src/server/accounts.ts:113`): the bridge
generates a short code, an **admin of that office** approves it, and the office writes a token to
`.agent-office/bridges.json` (mode `0600`) that the bridge stores in its own `0600` file. Revoking
a bridge in Settings drops it at once, like revoking an account.

Note what the admin is approving, because it is not what it looks like: the admin is admitting a
member's machine to the floor, and granting that machine's members a shell on it. The dialog should
say that in one sentence, and the pairing should be logged in the room — *laptop paired by
webdevcody* — so that the people sharing the office know whose machine is in it.

The bridge is **not** authenticated by a browser session cookie. `/ws` requires `sameOrigin` and a
session (`src/server/server.ts:1114`), both right for a browser and wrong for a CLI, so bridges get
their own upgrade path, `/bridge`, refused unless the presented token matches a live one. The token
is scoped to one floor and one account, and it is what the socket presents.

### Frames

The office's side is a third `Pty` implementation, so the message shapes are the PTY host's
(`src/server/ptys.ts:64`): already newline-delimited JSON, and already have a `lost` story. Office →
bridge:

| Frame | What it means |
|---|---|
| `hello {token, floor, agent}` | who I am; answered with `ready {agent, version, seats, hookPort, accepting, isolate}` or `refused {why}` |
| `seat {workerId, cwd, branch, prompt?, resume?}` | cut a worktree for this worker and spawn the agent in it |
| `input {workerId, data}` | someone typed in the office |
| `resize {workerId, cols, rows}` | the terminal changed size |
| `stop {workerId}` | send it home, and clean up its worktree |
| `ping` | liveness; the office marks the bridge lost after two missed rounds |

Bridge → office:

| Frame | What it means |
|---|---|
| `data {workerId, data}` | the agent's output, mirrored office-side like any worker |
| `exit {workerId, exitCode, error?}` | the agent ended |
| `hook {workerId, event, body}` | a status report, forwarded (above) |
| `report {workerId, pr?, cost?, tokens?}` | what the office cannot read from its own disk |
| `bye` | the bridge is going away; its workers go `offline`, resumable |

When the socket drops, the office does what it already does for a lost PTY host
(`src/server/ptys.ts:297`): its workers are marked as having lost their terminal, mid-turn workers
are flagged interrupted so **R** resumes them rather than pretending they finished
(`src/server/workers.ts:1893`), and a remote-targeted queue task goes back to waiting.

## Mapping onto agent-office

| Concern | File | Change |
|---|---|---|
| Worker state, persistence, restore | `src/server/workers.json` via `src/server/workers.ts:262` | `WorkerInfo.remote?: { bridgeId, host, seats }`; restores as `offline` until its bridge returns, like a DeepSeek Harness worker today (`src/server/workers.ts:1524`) |
| `Pty` implementations | `src/server/ptys.ts` | a third implementation, `BridgePty`, beside `RemotePty` |
| Bridge registry, pairing, `/bridge` upgrade | new `src/server/bridges.ts` | modelled on `accounts.ts`, with seats and accepting state |
| Who may hire onto a bridge | `src/server/queue.ts:336`, `src/server/floor.ts:259` | an agent-driven hire needs `accepting`; a seat free, or the task stays queued |
| Authority inside the office | `src/server/office-workers.ts`, `src/server/server.ts:296` | a forwarded `/office/*` call carries its bridge; the handler refuses workers on another bridge |
| Provider validation | `src/server/agents.ts` | `validateWorkerModel` / `validateWorkerEffort` must refuse an office-side model or effort for a remote worker: the bridge's own settings decide those, and an office that appeared to set them would be lying |
| Scrollback retention | `src/server/workers.ts` | remote workers default to no retained scrollback; per-bridge opt-in |
| Client frames | `src/shared/protocol.ts` | none. The office speaks bridge frames to the bridge; browsers see an ordinary worker |
| Status handlers | `src/server/server.ts:296` and the per-provider bridges | none, given the `hook` frame |
| Sign-ins, `runAs` | `src/server/signins.ts`, `workers.ts:1670` | unused for remote workers: they run with the bridge owner's logins, always. `owner` still records whose machine it is |

## Alternatives considered

### A wrapper script as `--agent`

`--agent` takes one executable (`resolveCommand`, `src/server/workers.ts:2432`) and `--agent-args`
adds arguments, so this works today with no code:

```bash
agent-office /path/to/project --agent /usr/local/bin/my-agent-wrapper
```

where the wrapper `ssh`es to the laptop, or `docker exec`s into a container, or attaches to a
`tmux` session. It is labelled **Custom** (`src/server/agents.ts:21`) and gets a real desk.

What you get: the terminal, the avatar, the desk, sharing, scrollback, the queue seating it, and
other members typing into it — which is most of the collaboration asked for. What you do not get:
**status**. The agent's hooks run on the far machine and post to `AGENT_OFFICE_HOOK_URL`, which is
`http://127.0.0.1:<port>` on the *office's* loopback, so every hook fails, the desk sits at *idle*
from launch and stays there, `needs_input` never fires, and there is no cost, no PR and no gong.

A determined wrapper can route that port: the office asks for the same hook port on every restart
and falls back to a random one only when it is taken (`src/server/server.ts:498`), so `ssh -R
<port>:127.0.0.1:<port>` plus a listener on the far machine often does bring status back. That is
also the whole fragile part of the hack, and it does not survive the port moving.

**Verdict: the honest answer to give someone who asks today**, and the baseline this design has to
beat — a low bar for the terminal, a high one for status.

### Mounting the member's filesystem instead

Share the checkout over NFS or SSHFS and let the office spawn locally into it. Rejected: the office
would still rewrite the child's environment and write its hook settings into the worktree,
`changes.ts` would `git status` across a network mount every two seconds, and every failure would
look like a flaky agent rather than a wrong architecture. It is also strictly worse than a bridge,
which needs no filesystem sharing at all.

### The `agent-office` MCP server or `office-workers` from the laptop

Already built, but it is the other direction and not a route in: the hook server binds `127.0.0.1`
only, and `/office/workers` requires the calling worker's own id and random per-worker bearer token
(`src/server/office-workers.ts:174`, checked at `src/server/workers.ts:583`). A laptop has neither.
Those tools are for agents **inside** an office managing each other.

### A second office on the laptop

`agent-office ~/code --agent opencode` gives you your own agents, your own logins and your own
configuration, on your machine, today. What it cannot do is the thing being asked for: nobody else
in that office can see those workers, steer them, or queue work onto them. It is the right answer
for "I want my agents on my machine" and the wrong one for "I want to work with my friends on
mine". A bridge is the difference between two buildings and one room.

## Phases

### Phase 0 — spike (throwaway)

A hand-written bridge that connects, seats a Claude in a local PTY, forwards bytes and answers one
synthetic `hook` frame. Measure the two things that could sink the design: does the office's
headless-xterm mirror stay correct through a laptop's latency and a reconnecting socket, and is
there an ordering problem between `data` and `hook` that the office's status machine cannot absorb?
If output and status race visibly, frames need a sequence number, and that is much cheaper to learn
now than after the UI exists.

### Phase 1 — seat a remote worker

`src/server/bridges.ts`, the `/bridge` upgrade, `BridgePty`, the `remote` field, the bridge cutting
a worktree per worker, the loopback hook endpoint, PR and cost reporting, and no retained scrollback
by default. Deliverable: a member's agent at a desk in someone else's office, with a terminal,
status, `needs_input`, a PR on the boards, resume and send-home. **This is the whole of the value
and it is one phase.**

### Phase 2 — pairing, seats and hiring

Seats and the refusing message, the accepting toggle, queue behaviour when a laptop is asleep,
attribution and the sign over the desk, `--isolate container`, and the authority rule in
`/office/workers` with its cross-machine refusals.

### Phase 3 — polish

Reconnecting sockets, "2 bridges, 1 seat free" in the Workers panel, toasts when a bridge pairs or
is revoked, `agent-office bridges` in the CLI beside `accounts`, and the hire dialog's sentence
about whose machine is being used.

## Risks and open questions

1. **A bridge is a shell on a member's machine, held open to everyone in the office.** The sharpest
   surface in the project, and the reason `--isolate container` and per-worker worktrees are Phase 1
   and 2 rather than a later nicety. Decide whether the office refuses a bridge without isolation
   from anyone who is not the office's own operator.
2. **Other people's prompts run as you.** Contained per worker, but not eliminated. The
   accepting toggle is the control; a stricter option is a per-hire approval in the office, at the
   cost of the automation that makes this worth building.
3. **A stranger's prompts can spend your money and fill your disk.** Seats, the accepting toggle and
   reported cost. A hard token ceiling is worth asking the providers about; the office cannot
   enforce one it cannot see.
4. **The bridge's loopback endpoint is unauthenticated.** Anything running as that user can post
   hook frames. Bind `127.0.0.1` only, refuse a routable bind, and treat a forwarded hook as only
   as trustworthy as the socket that sent it.
5. **Status races output.** Phase 0 measures it; sequence numbers if it is real.
6. **Latency and the terminal.** The office resizes the PTY to whoever is typing, which a bridge
   turns into a round trip. Debouncing resize office-side is likely necessary.
7. **Do remote workers count against the queue?** Recommended: yes. They hold a seat and cost money.
8. **Two offices, one machine.** A laptop running its own office *and* bridging into a team office
   is a legitimate and probably common setup. Decide whether it is supported, tolerated or refused
   before someone does it and files a bug.
9. **A worker that walks.** A laptop that sleeps mid-turn is a worker whose terminal was lost. The
   office has one honest answer already — `offline`, resumable with **R** — and should use it rather
   than inventing a new state.
10. **Whose git identity?** The bridge's, not the office's. Two members pushing to the same repo
    means two identities and an audit trail somebody will have to explain.

## Testing strategy

The suite runs with `node --test` over `tests/*.test.ts` and never needs a real agent installed.
The office's convention is to test the generated status bridge and payload normalisation, not the
upstream CLI, and remote workers should follow it:

- **`tests/bridge.test.ts`** — a fake bridge (a `WebSocketServer` on an ephemeral port) driven
  through the real `BridgePty` and the real pairing check. Assert the seat handshake, byte and
  resize round trips, exit codes, hook forwarding, that a forwarded hook for another worker's id is
  refused, and that a forwarded `/office/*` call cannot touch another bridge's worker.
- **Worktree isolation** — two seated workers get two directories, and send-home removes only its
  own, mirroring `tests/worktrees.test.ts`.
- **`tests/workers.test.ts`** — persistence and restore of a remote worker, including the
  `offline`-until-the-bridge-returns boot path, and the interrupted-mid-turn flag on a dropped
  socket.
- **Queue** — a remote-targeted task with no bridge connected stays queued and is not failed; a
  task aimed at a bridge that is not accepting is refused with a message naming the machine.
- **`tests/agents.test.ts`** — model and effort validation refusing a remote worker.
- A lost-socket test that no remote worker is left in `working` forever, and that a remote worker
  keeps no retained scrollback unless its bridge opted in.

## Appendix: evidence

| Claim | Source |
|---|---|
| The office spawns the agent CLI itself | `src/server/workers.ts:1704` |
| `Pty` is a small interface with two implementations today | `src/server/ptys.ts:41`, `:105`, `:216` |
| The PTY host is a local detached process on a Unix socket | `src/server/ptys.ts:340`, `src/server/ptyhost.ts` |
| A lost host marks its terminals lost and workers resume | `src/server/ptys.ts:297`, `src/server/workers.ts:1893` |
| Clients may only type into an existing PTY | `src/shared/protocol.ts:1146` |
| Anyone on a floor can type into any of its workers' terminals; there is no per-desk permission | `worker.attach` checks only that the worker exists (`src/server/server.ts:1780`); `term.input` checks only that the caller has it open (`:1848`) |
| The hook server binds loopback and checks a per-worker token | `src/server/server.ts:296`, `:493`, `src/server/workers.ts:583` |
| Every status bridge takes its endpoint from the environment | `workers.ts:1646`, `codex.ts:152`, `opencode.ts:66`, `grok.ts:189`, `muse.ts:257` |
| `/ws` needs a same-origin session; accounts use single-use invites | `src/server/server.ts:1114`, `src/server/accounts.ts:113` |
| Workers get rewritten config homes and stripped credentials | `docs/how-it-works.md`, security notes |
| Worktrees are office-side paths; meetings need one shared worktree | `src/server/worktrees.ts`, `src/server/meetings.ts`, `docs/how-it-works.md` |
| Scrollback is retained per worker and searchable | `src/server/history.ts`, `docs/how-it-works.md` |
| Cost and the budget are Claude-only, read office-side | `src/server/usage.ts`, `docs/agents.md` |
| Board agents add tasks for others and may not edit the checkout | `docs/how-it-works.md`, `src/server/queue.ts` |
