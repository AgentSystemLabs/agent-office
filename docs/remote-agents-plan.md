# Remote floors: implementation plan

The plan for building what [remote-agents.md](remote-agents.md) proposes — **with the architecture
revised.** The proposal's bridge is replaced by the floor host below, for the reasons in
[the departure](#the-departure-from-the-proposal).

Status: **plan**, nothing implemented yet. Target: agent-office `main`.

Back to the [README](../README.md).

## What this document is

`docs/remote-agents.md` is the **proposal**: the requirement, the trust-model analysis, the refusal
table, the alternatives. It is a good document and this plan does not argue with its requirements or
its permission model. This is the engineering pass: every claim in it checked against the tree as it
stands, the places where the proposal turns out to be wrong or optimistic, the decisions that have to
be made before code is written, and then the work broken into tasks a person can pick up one at a
time.

Read this next to the proposal, not instead of it. Where the two disagree **on architecture**, this
one is right; where they disagree on a citation, the correction is listed below and the proposal
should be corrected as each phase lands.

## The design, in one page

Everyone joins **one office** — one URL, one chat log, one presence map, one set of boards. That is
not negotiable, because "we are all in the same building" is the requirement.

A **floor** gets a new field saying where it runs:

```ts
// src/server/building.ts
interface FloorDef {
  dir: string;
  // ...existing fields
  /** The floor host this floor executes on; absent, it runs here. */
  host?: HostRef;
}
```

A floor with no `host` behaves exactly as today. A floor **with** a host runs its entire `Floor`
object — checkout, worktrees, PTYs, `gh`, the queue, the Changes window — on someone else's machine.
The office keeps only what is shared: chat, presence, and the browser connections.

```
   Browser ──wss──▶ office (his server)
                      ├─ chat, presence, floors list
                      ├─ Floor A  ── local, runs here
                      └─ Floor B ──┐
                                   │ wss /floor-host
                                   ▼
                          floor host (her laptop)
                            ├─ Floor B: checkout, worktrees
                            ├─ PTYs, scrollback, search
                            ├─ gh, git, Changes window
                            └─ queue, board, spend
```

**The connection is outbound.** Her laptop dials *him*, not the reverse — one WSS connection to
`wss://<office>/floor-host`, authenticated with a pairing token, held open. No open port on her
machine, no NAT traversal, no firewall configuration, nothing inbound. This is the self-hosted-CI
runner pattern, and it is the single most important property in the design.

It also hands her a kill switch that is physically hers: **close the laptop and the floor stops
receiving work immediately**, with no cooperation from the office.

### The two seams

The design rests on two interfaces that already exist.

**Seam 1 — `FloorContext` (`floor.ts:36`).** A `Floor` talks to the office through exactly five
calls, every one addressed by floor or worker:

```ts
emit(floor: Floor, msg: ServerMsg, droppable?: boolean): void;
toast(floor: Floor, text: string, level?: ToastLevel): void;
termData(workerId: string, data: string, viewers: string[]): void;
changes(state: ChangesState, clients: string[]): void;
workerChanged(floor: Floor, w: WorkerInfo | string): void;
```

Today there is one literal implementation, built at `server.ts:625` and handed to every
`new Floor(def, floorContext)` at `server.ts:684`. Make it **per floor**: local floors get today's
object, remote floors get a proxy that serializes over the host socket. `Floor` does not change.

**Seam 2 — `handleMessage` (`server.ts:1477`).** The office's 117-case switch resolves a floor with
`floorOf(c)` (`server.ts:254`) and then calls into it. Those floor-scoped cases become a function
over a `Floor`: called directly for a local floor, shipped verbatim to the host for a remote one.

This matters because `server.ts` makes **66 distinct floor-scoped calls**
(`floor.workers.spawn`, `floor.queue.add`, `floor.forge.claim`, `floor.jukebox.title`, …).
Enumerating those as 66 RPC methods would be the wrong shape and the wrong amount of work. Forwarding
the unions that already exist is not.

### The wire is mostly already written

| Direction | Payload | Notes |
|---|---|---|
| office → host | `ClientMsg`, floor-scoped subset, **plus `floorId`** | already JSON, already validated at the top |
| host → office | `ServerMsg` via `FloorContext.emit`, **plus `floorId`** | already JSON |
| host → office | control: `hello`, `ready`, `bye`, `heartbeat` | new, small; `ready` is **per floor** |
| either | terminal bytes, screen frames | ride the two channels above |

**Every data frame carries `floorId`**, because one connection carries N floors (decision 6, [one
socket, many floors](#one-socket-many-floors)). `ready` is the one control frame that is per floor,
not per socket: the host announces each floor it serves — its roster, seats, and whether it is
accepting — so a disconnect can mark them all offline in a single pass.

The office's own state also reaches the host on `ready` and on change, over the same socket:
`prompts`, `capacity`, `leaveOnMerge`, `people`, `peers`, and each worker's `pr` and
`worktree.branch`. What it deliberately does **not** reach is
[`runAs`, `forgeAs` and `floor(id)`](#what-the-host-receives-and-what-it-must-not).

### Why `workerPr` needs no bypass

Finding 3 is resolved from the code: `workerPr` reads only `w.pr`, `w.worktree.branch`, `pulls` and
`tasks`, and **all four already ride existing `ctx.emit` streams** — `worker.update` carries the whole
`WorkerInfo`, and `gh.pulls` and `queue` carry the boards. A hosted floor therefore needs no
`remote.pr` field, and the office never resolves a PR from a path it cannot see.

Flow control is already signalled: `droppable` is on the `emit` signature and `toFloor`
(`server.ts:261-265`) already skips clients whose `bufferedAmount > 4 * 1024 * 1024`. A transport
that honors `droppable` gets back-pressure for free.

### The protocol surface, measured

Phase B task 7 is "classify `handleMessage`'s cases". That has been done, so the rest of the plan can
size itself. `handleMessage` is three switches: 104 cases at `server.ts:1477`, plus
`handleSignIns` (`:2401`, 7 cases) and `handleAccounts` (`:2430`, 6) — 117 in all.

Classifying by what each body actually calls:

| | Count | Where it goes |
|---|---|---|
| **Calls a method on a `Floor` object** | **43** | **ships to the host** |
| Looks a floor up but calls nothing on it | 9 | stays office-side |
| Never touches a floor | 48 | stays office-side |
| `handleSignIns` + `handleAccounts` | 13 | stays office-side |

(43 + 9 + 48 = 100, plus a `default` arm and three cases that reach a floor through a shared branch —
`car.enter`, `ball.take`, `worker.detach`'s sibling — brings the main switch to its 104.)

**This count is asserted, not remembered.** `tests/floorhost.test.ts` re-derives it from `server.ts`
and fails if `FLOOR_CASES` drifts, so a case added to the switch without a decision about where it runs
breaks the build rather than quietly staying office-side. Building the assertion is what corrected
this table: the first pass said 44, and the real answer is 43.

**The protocol is 43 messages, not 117.** The 12 that look a floor up and leave are worth naming,
because "it mentions a floor" is not the same as "it acts on one":

| Case | Why it stays |
|---|---|
| `floor.go` `:1603` | moves the **client** — `goToFloor(c, floor, spot)` is presence |
| `floor.remove` `:1638` | an admin taking a floor off the building; the lookup only finds it to `closeFloor` |
| `term.typing` `:1857` | notifies other **browsers** on the same terminal; no floor method |
| `gong` `:1931`, `horn` `:1939` | office-wide broadcast |
| `dog.pet` / `dog.name`, `wb.*`, `cabinet.*`, `meeting.stop`/`clear` | looked up, then handed to an office-side manager |

The 43 are exactly the `worker.*`, `station.prompt`, `term.input`/`resize`, `gh.*`, `queue.*`,
`changes.*`, `decor.*`, `desk.label`, `floor.expand`/`shrink`, `jukebox.*` and `car.*` families, plus
`worker.kill` — which resolves through `worker()` and calls `floor.sendHome(...)` (`:1743`), so it
ships even though nothing else about its body looks floor-shaped.

Three accessors do the resolving, and all of them must learn to work without a local `Floor`:

```ts
// server.ts:1466 — the floor the client is standing on
const here = (): Floor | undefined => { const f = floorOf(c); if (!f) warn(c, '…'); return f; };
// server.ts:1472 — a worker, and the floor it sits on. Ids are unique across the building.
const worker = (id: unknown) => { const wid = str(id, 32); const floor = workerFloor(wid); … };
// server.ts:256 — the floor a worker sits on
const workerFloor = (workerId: string) => { for (const f of floors.values()) if (f.workers.get(workerId)) return f; … };
```

`workerFloor` is a **linear scan of `floors`** looking for an id in each floor's `WorkerManager`. For
a hosted floor that scan is asking the wrong machine, so the office needs a worker→host index fed by
the host's roster — which is why `ready` carries the worker list, not just the seat count.

### What the host receives, and what it must not

Decision 9 asks what office-wide state a floor host learns. The answer is already shaped by
`FloorContext` (`floor.ts:36-68`), which has three parts — and only the first is configuration:

**Given to the host** (it cannot construct a `Floor` without these):

| Member | What it is |
|---|---|
| `agentCmd`, `agentArgs`, `dshProfile` | which CLI to run and how |
| `prompts` | the office's prompts and default worker |
| `capacity` | the office's worker limit, so the host can refuse locally |
| `leaveOnMerge()` | whether a landed worker goes home by itself |
| `people(floor)`, `peers(floor)` | presence — office-wide by nature, and meetings need it |
| `hook` | a **host-local** `127.0.0.1` endpoint, per finding 2 — not the office's. `HookEnv.token` stays unused (`server.ts:629`), because the host puts the worker's own token in the worker's env instead (`:1646-1650`) |

**Withheld from the host, deliberately:**

| Member | Why |
|---|---|
| `runAs?` (`floor.ts:48`) | *"Workers hired by an account run on its own sign-ins."* A hosted floor runs on the **host's** sign-ins. Shipping the office's `runAs` would put a member's Claude credentials on another machine — the exact thing the design exists to prevent. This is the interface member that makes the permission model's *"hosted workers never use `runAs`"* enforceable rather than aspirational. |
| `forgeAs(owner, kind)` (`floor.ts:51`) | same shape: a per-account forge sign-in. The host's own `gh` auth applies, and the office has nothing to verify about it. |
| `floor(id)` (`floor.ts:68`) | *"Another floor of the building: a worker across repositories works in its project too."* Left as-is, a worker on a hosted floor would reach into an office-side checkout. It answers `undefined` unless the other floor is on the **same host**, so `repos` across an office boundary is refused — the same refusal meeting gets today, now for a reason that is about placement rather than kind. |

That last one is a finding rather than a choice, and it belongs in finding 9: `floor(id)` is the one
interface member that silently grants a hosted worker filesystem reach outside its own floor.

## The departure from the proposal

The proposal builds a **bridge**: a process seated in the office that reaches out to a laptop and
lets workers be hired onto it. This plan builds a **floor host**: the laptop dials in and hosts a
whole floor.

| | The proposal's bridge | This plan's floor host |
|---|---|---|
| Unit of remoteness | a worker, seated onto a bridge | **a floor** — checkout, board, queue, PTYs |
| Who dials whom | the office reaches the laptop | **the laptop dials the office** |
| Number of offices | two, plus a bridge between them | **one** |
| Shared chat / presence | needs federation to merge | **free** |
| Whose checkout | the bridge's, cut per worker | **the floor's**, unchanged |
| Board and Changes window | the office's `gh` on the office's disk | **the host's**, streamed up |

Why the change:

1. **One server is the requirement, not a preference.** Two offices need Level-2 federation to share
   chat and presence; a floor host needs nothing, because there is only one office.
2. **A floor is already the right boundary.** `floor.ts:111` describes it as *"a project's checkout
   with its own desks and workers, issues and PR boards, task queue, pictures and jukebox, all kept
   in that checkout's `.agent-office` folder."* The queue is already constructed per floor from the
   floor's own `dataDir` (`floor.ts:234`, `queue.ts:73`). You are relocating a component that is
   already whole, not carving one out of a monolith.
3. **Outbound-only beats inbound.** The bridge's direction implied the office reaching a laptop,
   which requires the laptop to be reachable. The floor host removes that entirely.
4. **The kill switch is physical.** Pull the connection; the floor stops. Nothing in the bridge
   design was that immediate or that clearly hers.

What does **not** change: the permission model, the refusal table, the accepting toggle, seats, and
every finding below about what the code actually does. Those were written for a bridge and they hold
for a floor host with the unit renamed. The `--isolate` question does not survive at all — see
[containment](#containment-is-not-built-and-that-is-the-decision).

## What was checked, and what came back

Every `file:line` citation in the proposal's appendix was checked against the tree. The design's
**load-bearing claims all hold**:

| Claim | Verdict |
|---|---|
| The office spawns the agent CLI itself (`workers.ts` `this.host.spawn`) | holds |
| `Pty` is a 10-line interface with two implementations | holds — `RemotePty` and the bare `@lydell/node-pty` object returned inline by `PtyHost.spawn`; there is no `LocalPty` class |
| The PTY host is a detached local process on a Unix socket | holds |
| A lost host marks its terminals lost and workers resume | holds |
| Clients may only type into an existing PTY; no per-desk permission | holds — `worker.attach` checks only that the worker exists |
| The hook server binds loopback and checks a per-worker token | holds |
| Every status bridge takes its endpoint from the environment | holds — none of them assumes `127.0.0.1` |
| `/ws` needs a same-origin session; accounts use single-use invites | holds |
| Scrollback is retained per worker and searchable | holds, with a correction — see finding 4 |
| Cost and the budget are Claude-only, read office-side | holds |

The claims that need correcting are all citation drift, not design errors:

| Proposal says | Actually |
|---|---|
| `workers.ts:1646` hook env injection | `:1643-1650` |
| `workers.ts:1670` `owner` / `createdBy` | `:1670` is the `PATH` key lookup; `createdBy` is set at `:446`, `w.owner` at `:460`, `runAs.apply` at `:1683` |
| `workers.ts:1524` a DSH worker restores as `offline` | `:1524` is inside `shutdown()`; DSH's behaviour comes from `this.closing` suppression at `:1797` |
| `protocol.ts:1146` terminal frames | `:1146` is `{ t: 'sit' }`; the frames are `:1172-1175` |
| `floor.ts:259` the meeting seat | `:266` (`:259` is the `MeetingRoom` constructor) |
| `server.ts:1114` the `/ws` session check | `:1116-1117` |
| `server.ts:583` the hook token check | `workers.ts:584`, inside `WorkerManager.authenticate` |

Two substantive corrections, not drift:

1. **`WorkerInfo.owner` does not exist.** The proposal says "`WorkerInfo.owner` and `createdBy`
   already record who asked". `createdBy` is on `WorkerInfo`. `owner` is on the **internal**
   `Worker` interface only, is persisted as a separate top-level key in `workers.json`, and reaches
   the office through `WorkerManager.ownerOf(id)`. It is never sent to a browser. Any plan that needs
   "whose machine is this" on the client has to add it to `WorkerInfo` rather than read it.
2. **Search reads the live terminal, not the stored scrollback.** `WorkerManager.search()` walks
   `w.term` in memory; `ScrollbackStore` is only the on-disk copy that survives a restart. For a
   remote floor this means search must be answered **by the host**, not by the office — see
   finding 9.

## What the proposal misses

These are the findings that change the work, ordered by how much they change it. Each is marked with
what happened to it when the bridge became a floor host.

### 1. There is no "offline until it returns" mechanism, and the existing one fights it ✅ stands

**Stands unchanged, and gets bigger: it is per floor now, not per worker.**

The proposal's risk 9 says a laptop that sleeps mid-turn is a worker whose terminal was lost, and
that the office should reuse its existing honest answer: `offline`, resumable with **R**. The
existing answer is not reachable from the code as written.

`follow`'s lost branch (`workers.ts:1900-1905`):

```ts
if (lost && !this.closing) {
  if (midTurn(w)) w.interrupted = true;
  this.resume(info.id);
  return;
}
```

It **immediately relaunches**. For a lost local PTY host that is right — the host restarts. For a
dropped host socket it will spin: relaunch, seat, refuse, exit, relaunch.

The boot path has the same problem. `restore()` sets every restored worker to `offline`, and then
`start()` calls `wakeAll()`:

```ts
wakeAll() {
  for (const w of this.workers.values()) if (!w.pty && !w.dsh) this.resume(w.info.id);
}
```

So the proposal's stated precedent — *"restores as `offline` until its bridge returns, like a
DeepSeek Harness worker today"* — describes a mechanism that does not exist, and the nearest
neighbour it names does not work that way either.

**Resolution:** `PtyExit` gains a third shape. It is already `{ exitCode, error?, lost? }` and
`follow` already branches on `lost`, so widening it is small and honest:

```ts
export interface PtyExit {
  exitCode: number;
  error?: string;
  /** The host went away under it; the process is gone. */
  lost?: boolean;
  /** The far end walked. It may come back: hold, don't relaunch. */
  gone?: boolean;
}
```

`gone` means: set `interrupted` if mid-turn, leave `w.pty` undefined, status `offline`, **do not
resume**, do not surface an exit code. `wakeAll` gains the same guard — a worker whose floor has no
host connection stays asleep. Resume becomes an explicit human act (**R**).

Add to it: when the socket drops, **the floor** goes offline, not only its workers. Every floor-scoped
call from `server.ts` then answers with a refusal naming the machine rather than an exception —
*"the laptop is asleep"* — and the queue stays queued (finding 10).

This is the single most important change in the feature. It lands in Phase B, not Phase C.

### 2. `/office/*` has to be forwarded too 🔄 reverses

**Dissolves as written, and inverts.** The bridge needed the office's loopback hook server proxied
because workers ran beside the office while their processes were elsewhere. In a floor host the
**whole floor is on the laptop**, so the hook server, `/office/workers` and `/office/queue` all live
there too. `AGENT_OFFICE_HOOK_URL` points at `127.0.0.1` **on the laptop**, for the workers, hooks
and MCP servers that are also on the laptop. Nothing is forwarded; nothing needs to be.

The finding's substance survives as its mirror image: **what does the host need from the office?**
The office-wide things a floor cannot see for itself — other floors' state, the chat log it must
replay on join, the spend ledger, the default worker and prompts, the account's sign-ins. That list
has to be written down deliberately, because it is the set of things that leak office-wide knowledge
to a member's machine. It is a much smaller and more reviewable list than "every hook call", and it
is the finding's real content.

Note what this buys: today `/office/workers` requires `?worker=<id>`, the per-worker bearer token,
*and* a live PTY or ACP session (`workers.ts:584`). Over a floor host those checks are unchanged and
now enforced where the processes actually are.

**Which is also the whole of decision 7.** The proposal made it *"a forwarded hook frame carries its
bridge's token or the worker's own?"* — a real question for the bridge, whose hook listener is a proxy
and so must speak on a worker's behalf. **A floor host has no such proxy.** Traced:

- The hook server is `http.createServer` inside the office process (`server.ts:296`), bound to loopback
  on an ephemeral port written to `hook-port` (`:505-506`). **There is no module-level export that a
  host could construct a second one from.**
- `launch()` mints `w.hookToken = randomBytes(16)` (`:1640`) and injects three variables — 
  `AGENT_OFFICE_WORKER_ID`, `AGENT_OFFICE_HOOK_URL: this.hook.url`, `AGENT_OFFICE_HOOK_TOKEN`
  (`:1646-1650`).
- Every provider status reader re-checks it locally: `:1128` (Claude), `:1199` (Codex), `:1278` (Grok),
  `:1337` (Muse), `:1405` (OpenCode), all via `safeEq(token, w.hookToken)`.

So on a hosted floor the hook server, the token, the worker process and the check are **all on the
host's laptop**, talking over that machine's own loopback. The host is authoritative for its own floor,
exactly as the office is authoritative for its own. Nothing is forwarded, so nothing needs to be
attributed.

`ctx.hook` (`floor.ts:41`) is the one context member that must therefore be **host-local**: the host
mints its own ephemeral loopback URL, and `HookEnv.token` (`:99-102`) stays unused on that path — it
is already `''` office-side (`server.ts:629`), because the office puts the *worker's* token in the env
instead.

### 3. PR discovery breaks silently, in four separate places ✅ resolved — no shortcut needed

**Answered from the code, not deferred to the spike. `workerPr` works unchanged, and `remote.pr` is
not part of the design.**

`workerPr` (`src/shared/status.ts:34-47`) is the only thing standing between a landed worker and a
worker that sits at a desk forever. It takes exactly three inputs:

```ts
export function workerPr(w: WorkerInfo, pulls: GhPull[], tasks: QueueTask[]): WorkerPr | undefined {
  const mine = new Set<number>();
  if (w.pr) mine.add(w.pr.number);
  for (const t of tasks) if (t.workerId === w.id && t.pr) mine.add(t.pr.number);
  const seen = pulls.filter((p) => mine.has(p.number) || (w.worktree && w.worktree.branch === p.headRefName))…
```

| Input | Where a hosted floor gets it | Already streams? |
|---|---|---|
| `w.pr` | set by `openPr` at `workers.ts:999` / `:1007`, which runs `git` and `gh` **in the worktree** — on the host | ✅ `worker.update` carries the whole `WorkerInfo` (`floor.ts:180`), and `pr?: { number, url }` is part of it (`protocol.ts:117`) |
| `w.worktree.branch` | created on the host by `Worktrees` | ✅ same message; `branch` is a plain string, no path needed |
| `pulls` | the host runs `gh` | ✅ `{ t: 'gh.pulls', state }` (`floor.ts:219`) |
| `tasks` | the queue is per-floor, so it is the host's | ✅ `{ t: 'queue', state }` (`floor.ts:236`) |

**Every input already rides a `ctx.emit` stream.** `workerPr` is not reached by a hosted floor's
missing worktree path — it never touches one; it only ever reads `w.worktree.branch`, which is a
string the host reports like anything else. So the bridge plan's `remote.pr` shortcut, and its
"trust it directly because the bridge is the only party that can have set it" hedge, both disappear.

This is the case the proposal got wrong in the other direction: it built a bypass for a problem the
floor boundary does not have.

What survives from the original finding is the **testing**, not the fix. `workerPr` has four call
sites — `office-workers.ts:66`, `leave-on-merge.ts:104`, and two in `client/main.ts` — and **no test
coverage at all**, which is why the analysis above had to be done by hand. `landedWork`
(`leave-on-merge.ts:104`) is what sends a landed worker home; a silent miss means a worker sits at a
desk forever and the gong never rings, which is the difference between collaboration and a machine
that is quietly busy. `tests/status.test.ts` covers it — see [the test plan](#test-plan).

One caveat the spike still owns: whether the board state arrives **fast enough**. `workerPr` is
correct offline; it is the refresh timing that decides whether the gong is timely, and that is a
latency question, not a correctness one.

### 4. "No retained scrollback" is four switches, not one 🔄 becomes structural

**The office-side half stops being a setting.** Retention today is in four independent places:

| Where | What |
|---|---|
| `workers.ts:1848` `newTerm` | `scrollback: SCROLLBACK` on the office's headless mirror |
| `screen.ts:30` `screenSnapshot` | `ser.serialize({ scrollback: SCROLLBACK })` — what a joining browser replays |
| `workers.ts:2176` `saveScrollback` | the 15-second timer writing `.agent-office/scrollback/<id>.ansi` |
| `workers.ts:1564` `launch` | the prelude read that puts it back on resume |

For a remote floor the office never has the bytes in the first place: the headless mirror, the
snapshot and the save all belong to the host, which is where the PTYs are. So **office-side retention
is zero by construction**, and the four switches become a question the laptop owner answers about
their own disk — which is their decision and not the office's.

One consequence needs stating: `search` (`workers.ts:875`) walks `w.term`, which for a remote floor
is on the laptop. Search becomes an RPC to the host. That is finding 9's territory.

### 5. `resize` is unthrottled, and a remote floor makes that a real problem ✅ stands

**Stands, and matters more** — the round trip now crosses the internet.

```ts
resize(id: string, cols: number, rows: number) {
  ...
  w.pty?.resize(cols, rows);
  w.term.resize(cols, rows);
}
```

On a local PTY that is free. Over a host socket it is a round trip per frame, from every viewer, and
xterm.js emits those continuously during a drag-resize. Put the debounce in the host transport
(coalesce to one outstanding resize, send the latest 80 ms after the last request) rather than in
`WorkerManager.resize`, so local floors pay nothing.

### 6. `spawn()` is at 13 positional arguments ❌ dissolves

**No fourteenth parameter is needed.** All five call sites are already floor-scoped:

| Site | What |
|---|---|
| `server.ts:1721` | a browser hiring |
| `server.ts:475` | an agent hiring through `/office/workers` |
| `queue.ts:336` | the queue — constructed per floor (`floor.ts:234`) |
| `floor.ts:266` | meetings |
| `workers.ts:570` | `station`, board agents |

Each already went through `floor.workers.spawn(...)`. Where the floor runs is a property of the
**floor**, not of the call. `launch()` branches on `this.floor.host` and nothing upstream changes.

Do the `SpawnOptions` refactor anyway, as hygiene, in its own commit before Phase C — thirteen
positionals is already a hazard and `server.ts:475` is the agent-driven hire, the one that must never
get a target it did not intend. But it is no longer on the critical path.

### 7. Model and effort validation has no notion of "remote" 🔄 moves to the host

**Validate where the truth is.** `validateWorkerModel` / `validateWorkerEffort` are pure and take
`(kind, provider, value)`; threading a fourth parameter through `queue.ts:91-94` and
`workers.ts:393-396` makes them lie about what they check.

Do not touch them. Office-side validation keeps checking provider syntax, which is knowable here. The
**host** validates what only it knows — whether its machine has that model at all, whether the
account behind it can run it — and refuses with a message that names the reason: *"the laptop
chooses its own model"*. One gate, at the seat, where the host is already being asked.

### 8. Smaller things worth knowing before starting ✅ mostly stands

- **The upgrade path has exactly one listener.** `server.ts:1101-1119` is the whole `upgrade` handler
  and the only `WebSocketServer`. `/floor-host` must be branched **before** the session gate on
  `:1117`, and note that `:1116` computes `session` only for `pathname === '/ws'`, so a
  `/floor-host` request falls straight through to the refusal. Prefer a **second `WebSocketServer`
  instance** so host frames are a separate type domain with their own payload cap and lifecycle,
  rather than sharing `maxPayload: 2 MiB` and the `ServerMsg` union with browser traffic.
- **There is no runtime schema anywhere.** `ws.on('message')` does `JSON.parse` and `handleMessage`'s
  `switch (msg.t)` has no `default` — an unknown `t` is silently dropped. Every case re-coerces with
  `str`/`num`/type guards. The host protocol therefore needs **its own** validation from scratch.
- **`readMessages` is typed against `net.Socket`** (`ptys.ts:81`). The newline-delimited JSON framing
  is reusable and worth reusing; the WebSocket variant is a five-line change, but do not pretend the
  types line up.
- **`Pty` has no unsubscribe.** `onData`/`onExit` return `void` and hold callbacks forever. Lifetime
  has to be managed by the host registry, not by the callbacks.
- **`Worktrees` is reusable as-is** — it holds one `dir` and no office state. On a floor host it is
  simply constructed on the laptop. It has no method that reports a branch without creating a folder,
  so the branch is reported once at seat time.
- **`safeEq` exists twice, file-local, exported by neither** (`workers.ts:2588`, `ptyhost.ts:247`).
  The host registry needs a third. Lift one copy into `src/shared/` rather than adding a third.
- **Costs are structurally excluded from the budget already.** `ledger.add(...)` runs only on the
  Claude transcript path, so a host-reported cost cannot reach `--budget` or `usage.json` by
  accident. Route it through `reportedUsage()` — it validates the shape a report wants and
  **rejects the whole snapshot rather than zeroing it**, which is right for a number the office
  cannot verify.
- **`ws` is already a runtime dependency**, and `bin/` is already in `package.json` `files`. The only
  packaging change is one `bin` entry for the host CLI.
- **No test in the repo has ever opened a socket.** `tests/floorhost.test.ts` would be the first. The
  closest precedents are a real `http.Server` on an ephemeral port (`tests/office-queue.test.ts`) and
  a narrow interface faked rather than a class (`tests/queue.test.ts`).

### 9. The protocol is 43 messages, and the office must not touch a remote floor's disk 🆕

This is the new one, and it is where the work actually is.

`server.ts` makes **66 distinct calls into a floor** — `floor.workers.get`, `.list`, `.spawn`,
`.resume`, `.prompt`, `.ownerOf`, `.deskOccupied`, `.station`, `.rebuild`, `.openPr`,
`.inspectWorktree`, `.fetchBase`; `floor.queue.state/.add/.remove/.dropIssue`; `floor.forge.refresh`
/`.claim`; `floor.jukebox.*`, `floor.garage.*`, `floor.court.*`, `floor.sendHome`, `floor.arrived`.
Enumerating them as RPCs would be the wrong shape.

The right shape is to classify `handleMessage`'s 117 cases and forward the floor-scoped ones
verbatim. **That classification is done** —
[the protocol surface](#the-protocol-surface-measured) has the full split: **43 ship, 12 stay
office-side despite naming a floor, 48 never touch one, and 13 are account and sign-in handlers.**
It *is* the protocol surface, and it is a third the size the case count suggests.

Four rules follow, and each needs an explicit task:

1. **The office never touches a remote floor's `def.dir`.** `floor.ts:155` puts the floor's `dataDir`
   at `path.join(def.dir, '.agent-office')` — checkout, queue, scrollback and `worktrees/` all live
   under it — and `building.ts:273` silently **drops** a floor whose `dir` is not an absolute string
   (`continue`, no error). A hosted floor's `dir` is a path on the host's machine: absolute, so it
   loads, but unreadable here. Loading, listing and opening it have to ask the host, and the floor
   must survive a host that is not currently connected — which is why this rides alongside finding 1
   rather than after it.
2. **The Changes window reads disk.** `changes.ts` shells out with `execFile(..., { cwd })`
   (`:70`, `:84`) and `readFile`s the working tree (`:130`). It must run on the laptop;
   `FloorContext.changes(state, clients)` (`floor.ts:58`) is already the seam that carries the result.
3. **Search runs on the laptop** for the same reason (finding 4).
4. **`floor(id)` is the one member that reaches outside the floor.** `floor.ts:68` exists so a worker
   can work across repositories, and it hands back another floor's `Floor` — whose `dir`, worktrees
   and board it can then act on. For a hosted floor that is filesystem reach the office never
   granted. It answers `undefined` across an office boundary and resolves normally only between two
   floors on the **same host**. See
   [what the host receives](#what-the-host-receives-and-what-it-must-not).

### 10. The queue must not fail a task whose laptop is asleep 🆕

`queue.ts:338-344` turns any `spawn` refusal into `failed`. A host that is disconnected must not
produce a refusal that reaches it. The gate belongs **before** `spawn`, in the desk choice: a task
aimed at a floor with no connected host stays **queued**, visibly, with the machine named — never
`failed`. Same shape as the bridge plan's, and it is the difference between a sleeping laptop and a
broken feature.

### 11. Latency and bandwidth are now real 🆕

Screen frames go out at `SCREEN_INTERVAL_MS = 250` (`workers.ts:61`) — 4 fps of screenshots per
followed worker — and now cross the internet twice: laptop → office → browser. Terminal output,
`gh` refreshes, and Changes diffs all take the same path.

Honor `droppable` (already on the emit signature, already honored by `toFloor` at
`server.ts:261-265` with a 4 MiB client threshold) so a slow link sheds screen frames instead of
queueing unbounded data in office memory. Measure the two-hop cost in the spike; it is the finding
most likely to change what is feasible.

### 12. Two floors must never share one checkout ✅ stands

`dataDir = path.join(def.dir, '.agent-office')`. Two floors pointed at one folder share
`workers.json`, `queue.json`, the scrollback and each other's `worktrees/` — silent, confusing
corruption. **Separate clones, different paths, different `.git`.** This is independent of where
either floor runs and it holds today.

## The permission model, stated plainly

The proposal leaves this implied in a single sentence — *"Agents may only hire onto a bridge that is
accepting; people may always hire"* — and it is the kind of thing that gets quietly narrowed while
someone is wiring up seats and toggles. It is written out here as a fixed constraint, not a decision
to revisit. **The unit changed from bridge to floor host; the model did not.**

**The office has no per-desk permissions, and this feature does not add any.** Every member of a
floor can do every one of these to every worker on that floor, local or remote, without asking
anyone:

| | Today | With a floor host |
|---|---|---|
| Spawn a worker on any free desk | anyone, no role check | anyone, on a local desk or a hosted one |
| Send a worker home, with cleanup | anyone | anyone; the office sends `stop` and the host tidies its own worktree |
| Type into a worker's terminal | anyone who has it open | anyone — including into a shell on someone else's laptop |
| Prompt, resume, abort (Ctrl+C), attach, rebuild, open a PR | anyone | anyone |
| Be the account a worker runs as (`owner`) | their own sign-ins | the **host owner's** sign-ins, always; hosted workers never use `runAs` |

Verified in the tree: `worker.kill` asks only `worker(msg.workerId)` — does it exist — and nothing
else (`server.ts:1738-1750`). `worker.spawn` likewise (`server.ts:1702-1732`). The only admin gates
in the office are accounts, prompts, the default worker, the worker limit, floors and the workspace
folder. Nothing about workers.

**The single asymmetry is who is doing the hiring.** A person clicking **Hire** has chosen to run
their own prompt on that machine, and may always spawn onto a hosted floor. A queue task or board
agent has not — it is a stranger's prompt arriving by automation — so it may only spawn onto a floor
whose owner has flipped `--accept`. This is decision 2 below, and it is the *only* place the two
differ.

**Refusals are about capacity and kind, never about who you are.** A hosted desk still refuses a hire
past `--seats` (*"the laptop has no free desk"*), a taken desk, `--max-workers`, meetings (one shared
worktree on office disk), and an office-chosen model or effort (the host decides those). None of
those look at the member's role.

What a hosted floor genuinely changes is **blast radius, not permission**. Today everyone typing into
a worker is typing into a shell on the office's own machine, under the office's own operator. With a
floor hosted on a member's laptop, the same open door leads to a shell on that member's laptop, as
them, written by whoever typed the prompt. Every containment measure in this feature — seats, the
accepting toggle, no office-side scrollback — exists for that reason and for no other.

One thing is better than the bridge here and should be said plainly: **the floor's owner holds the
connection.** An accepting toggle can be read as a policy; a closed socket is not. Anyone
implementing Phase D should read the accepting toggle as *an automation gate*, not as a permission
system, and should not add a role check anywhere else without asking first.

### Containment is not built, and that is the decision

**Decision 1 is settled: there is no `--isolate container`.** The proposal called the bridge "the
sharpest surface in the project" and proposed a flag that runs the agent in a container with the
worktree mounted and the host's home not. It is not built. Nothing is refused either, and nothing
downgrades gracefully — a hosted floor is a member's home directory, reachable, by everyone in the
office, to the same degree the office's own machine is today.

That is a deliberate acceptance, and it should be legible in the product rather than buried in a
doc. Two things are cheap and non-negotiable:

1. **The pairing dialog states the exposure in one sentence**, in the member's own terms — that
   workers here run as them and can read `~/.ssh`, `~/.config/gh` and `.env`. That is not a warning
   bolted on; it is the thing being consented to.
2. **The kill switch is the real containment**, and it is the floor's owner's alone. Closing the
   laptop ends it. Nobody in the office can refuse a member's machine and nobody in the office can
   keep it running — which is a stronger position than any flag could give.

The measures that *are* built — seats, the accepting toggle, no office-side scrollback — are about
**capacity and cost**, not about the home directory. Anyone reading them as a security boundary would
be wrong, so Phase D says so where it implements them.

If this decision is ever revisited, the argument for adding isolation later still holds: it is
host-side, it needs no protocol change, and a PTY is a PTY either way. Nothing built here forecloses
it.

### One socket, many floors

**Decision 6 is settled: one connection carries N floors.** One socket from a member's machine serves
any number of floors on it, and **every frame names its floor** — that is the cost, and it is paid
once, in the frame union, rather than in every rule that follows.

It also fixes, deliberately, **the socket as the unit of failure** rather than the floor:

| Event | Consequence |
|---|---|
| Host closes the laptop | **all** its floors go `offline` together; every worker on them is `interrupted` and asleep until **R** |
| Pairing revoked | **all** its floors go inert in the same event, and nothing on that machine can be restarted |
| Socket reconnects | the host re-announces its whole roster; each floor resumes only if a human presses **R** |

Revocation is the one that has to be unambiguous. "Drop one floor" is *not* offered in Phase C —
`hosts.remove()` kills the connection, and every floor that host carried goes with it. That is the
only behaviour the security story supports, and offering a per-floor revoke later would need the
"which floor admitted this host" question answered first.

One consequence worth writing down because it is easy to get wrong: **a socket-level drop is not N
independent `gone` events.** `PtyExit.gone` (finding 1) fires per worker, and the office must
therefore compute "this host is gone" **once**, mark all its floors offline in a single pass, and let
the per-worker `gone` handling follow. Otherwise the first worker's `gone` resumes or marks the host
back online while the rest are still settling — a race on exactly the path the plan calls the most
important change in the feature.

## Decisions to lock before writing code

| # | Question | Recommendation | Consequence of the other way |
|---|---|---|---|
| 1 | Does the office refuse a floor host without `--isolate container` from anyone who is not the operator? (proposal risk 1) | **Decided: no isolation is built.** No `--isolate` flag, no refusal, and the pairing dialog says plainly what hosting a machine exposes | Refusing would exclude exactly the members the feature is for, and the office cannot verify a host-side flag anyway. The exposure is accepted deliberately — see [containment](#containment-is-not-built-and-that-is-the-decision) |
| 2 | Does a hosted floor without seats also need per-hire human approval? (risk 2) | **No.** The accepting toggle is the control — see [the permission model](#the-permission-model-stated-plainly) | Per-hire approval kills the queue automation that is the reason to build this |
| 3 | Do hosted workers count against `--max-workers` and the queue's *workers at once*? (risk 7) | **Yes**, both | Not counting them is how a five-person office spends five people's money on one laptop |
| 4 | Two offices, one machine — supported, tolerated or refused? (risk 8) | **Tolerated**, tested | Refusing breaks a legitimate setup; supporting it properly is more work than it looks |
| 5 | Whose git identity does a hosted floor push with? (risk 10) | **The host's**, shown in the pairing dialog and the desk sign | The office's identity would put a stranger's commits in the operator's name |
| 6 | Is a floor's `host` scoped to that floor only, or may one host serve several? | **Decided: N floors per connection.** One socket carries any number of floors; every frame names its floor | Revocation then has to kill **all** of a host's floors at once, and a dropped socket takes every one of them `offline` in the same event. Both are handled by making the socket, not the floor, the unit of failure — see [one socket, many floors](#one-socket-many-floors) |
| 7 | Does a forwarded frame carry the worker's hook token, or the host's token? | **Settled — finding 2.** There is no forwarding and no proxy: the hook server, the `randomBytes(16)` token (`:1640`), the worker and every `safeEq` check (`:1128`–`:1405`) are on the host's loopback. `ctx.hook` must be host-local; no attribution problem arises | — the bridge's proxy is what created it, and there is no equivalent to build |
| 8 | **New:** does the office keep a scrollback mirror for a hosted floor? | **No.** Search and join-replay are served by the host | A mirror costs every byte twice and re-creates the retention decision finding 4 was meant to remove |
| 9 | **New:** what office-wide state does the host receive (finding 2)? | **Answered** in [What the host receives](#what-the-host-receives-and-what-it-must-not): `agentCmd`, `agentArgs`, `dshProfile`, `prompts`, `capacity`, `leaveOnMerge`, `people`, `peers`. **`runAs`, `forgeAs` and `floor(id)` are withheld** — the first two are sign-ins, the third is cross-floor reach | Shipping `runAs` puts a member's Claude credentials on another machine, which is the one thing the design exists to prevent |

Two of the nine were open questions and are now **answered from the tree**, which leaves six needing
judgment. Question 7 was the one flagged sharpest — the difference between "a host is trusted" and "a
host is trusted only for the workers it is paired to seat" — and the floor boundary dissolves it,
because there is no proxy to attribute frames on. Question 9 is the mirror image of the bridge's
problem: not what the office will do for the host, but what the host is allowed to know.

## The plan

Six phases. Phase A is a throwaway spike that must happen before anything else, because three of its
questions can invalidate the design.

### Phase A — spike (throwaway, no shipped code)

A hand-written floor host: dials `wss://<office>/floor-host`, presents a token, opens one local PTY
for a worker the office asked for, forwards bytes, answers one synthetic `hello`/`ready` pair.
Throwaway — it does not become `bin/agent-office-floors.js`.

**Measure, and write the numbers down:**

Only **two** questions remain here. The third — whether `workerPr` needs a bypass — was answered from
the code while writing this plan, and the answer is no: all four of its inputs already ride existing
`ctx.emit` streams (finding 3). Do not re-derive it.

1. **Does the headless-xterm mirror stay correct through real latency and a reconnecting socket?**
   Force a reconnect mid-stream and confirm the office does not double-render or drop the last
   screen. This is also where the two-hop cost (finding 11) gets its first number.
2. **Does `data` racing status visibly corrupt the status machine?** If yes, frames get a sequence
   number. Learn that here, not after the UI exists.

**Exit criteria:** both answered, in a comment on the issue. If (2) is real, `seq` goes on every host
frame in Phase B and costs nothing to add. Neither answer changes the frame *set* — both only decide
whether frames carry a `seq`. That is the property worth protecting while the spike runs: **the
protocol's shape is settled; only its bookkeeping is open.**

### Phase B — the wire

The pieces everything else needs. No UI, no hosted floor in the product yet.

1. **`src/shared/floorhost.ts`** (new) — `FLOORHOST_PROTOCOL` version, the `ToHost` / `FromHost`
   frame unions, and the small validators. Written from scratch: there is no schema to reuse
   (finding 8). Every data frame carries `floorId` (decision 6), so the registry is
   `host → floors` rather than one floor per socket.
2. **`readMessages` for WebSockets** in `ptys.ts`, or a `frameReader()` both can use. Keep the
   newline-delimited JSON framing; it is already the office's shape.
3. **`src/server/hosts.ts`** (new) — the pairing registry, modelled on `accounts.ts`: `sync()` on
   `mtimeMs:size`, write-tmp-then-rename at `0600`, the `T | string` union return for errors,
   `INVITE_TTL_MS` and `MAX_*` caps. Pairing codes, approve, revoke, token lookup. Plus
   `hostsCommand(argv)` for `agent-office hosts`, slotting into `cli.ts` beside `accounts`.
4. **`hosts.json`** at `cfg.dataDir` — office-level, beside `accounts.json`.
5. **`/floor-host` upgrade** in `server.ts` — a second `WebSocketServer`, branched before the
   session check, refusing anything whose presented token does not match a live host.
6. **Per-floor `FloorContext`** — `contextFor(def)` returning today's object for a local floor and a
   serializing proxy for a hosted one. The literal at `server.ts:625` becomes the local case.
7. **Extract the 43 floor-scoped cases** (finding 9). The classification is already done —
   [the protocol surface](#the-protocol-surface-measured) — so this task is the extraction, not the
   analysis: move those 43 into a function over a `Floor`, called directly for a local floor and
   shipped for a remote one. **A test asserts the count**, so a case added to the switch without a
   decision about where it runs fails rather than silently staying office-side.
8. **The worker→host index** that replaces `workerFloor`'s linear scan (`server.ts:256`) for hosted
   floors, fed from each floor's `ready` roster and keyed `floorId → host`, since one socket carries
   many floors.
9. **`PtyExit.gone` + the `wakeAll` guard** (finding 1). Landing here, not in Phase C, because every
   later test depends on a dropped socket not spinning.
10. **`RemoteFloor`** — the proxy the office uses in place of a `Floor` for a hosted floor,
    implementing the action surface by shipping messages rather than calling methods.

**Exit:** a fake host on an ephemeral port takes a `ClientMsg`, runs it against a real `Floor`,
streams `ServerMsg` back, and a dropped socket leaves the floor and its workers `offline` and asleep
rather than spinning.

### Phase C — a floor that runs somewhere else (the value)

1. `FloorDef.host?: HostRef` in `building.ts`, with a validator beside the existing fields.
2. **The host CLI** — `bin/agent-office-floor-host.js`: dials out, pairs, and on `ready` constructs a
   real `Floor` locally with a `FloorContext` that serializes upward. **It runs the same `Floor`
   class**; nothing about floors forks.
3. **`building.ts:273`'s floor gate** — the `continue` that silently drops a floor whose `dir` is not
   an absolute string — learns to ask the host instead, and a hosted floor with no connection is
   **listed but inert**, never dropped from the building (finding 9).
4. **Board and Changes stream up** through `ctx.emit` (`gh.issues`, `gh.pulls`, `changes`,
   `queue`, `worker.update`). That set is what makes `workerPr` work unchanged (finding 3), so it is
   a correctness requirement, not just plumbing — if any one of those four streams is dropped,
   `landedWork` stops sending landed workers home.
5. **The PTY path** — laptop → office → browser. Resizes debounced at the transport (finding 5),
   `droppable` honored (finding 11), search served by the host (findings 4, 9).
6. **`gone` handling in `WorkerManager`** — workers on a disconnected floor go `offline` and stay
   asleep until **R** (finding 1).
7. **Spend** through `reportedUsage()` so an implausible snapshot is dropped rather than zeroed.
8. **The office never opens `def.dir`** for a hosted floor — a lint-able rule, and worth a test.

**Exit:** a member's agent at a desk on a floor that physically lives on another machine, with a
terminal, status, `needs_input`, a PR on the boards, resume and send-home — and a laptop that sleeps
mid-turn leaves everything `offline`, not spinning.

### Phase D — who may hire, and whose machine it is

1. **Seats and the refusing message.** `--seats` declared at `ready`; a hire beyond capacity names
   the machine: *"the laptop has no free desk"*.
2. **The accepting toggle, defaulting off for a floor host.** Agents may only hire onto an accepting
   floor; people may always hire, without asking the owner and without a toggle of their own.
   Refused at the same call-site gate as meetings and `repos` (finding 7), not in the queue. This is
   the *only* place people and agents differ — the whole rule is in
   [the permission model](#the-permission-model-stated-plainly), and it must not quietly grow.
3. **Queue behaviour when the laptop is asleep** (finding 10) — stays queued, visibly, machine named,
   never `failed`.
4. **The office-wide state list** (finding 2 / decision 9) — already answered in
   [What the host receives](#what-the-host-receives-and-what-it-must-not): eight members go to the
   host, `runAs`, `forgeAs` and `floor(id)` do not. Enforced in one place, with a test that a hosted
   floor's context carries no sign-ins.
5. **The refusals a hosted floor genuinely cannot serve** — meetings, `repos`, the changes window and
   the budget, where the answer needs office-side state — refused outright rather than degraded.
   **No `--isolate container`** (decision 1): the office refuses nothing on those grounds, and the
   pairing dialog is where a member learns what hosting their machine means.
6. **Revocation is immediate and total**: dropping a host connection makes **every floor it carried**
   inert and their workers `offline` in one event. No per-floor revoke — see
   [one socket, many floors](#one-socket-many-floors).
   `offline`, with no way for the office to restart them.

**Exit:** two members hosting floors in one office, with the authority rules enforced by test.

### Phase E — the surfaces

1. ⚙️ Settings → **Floors** shows where each floor runs, with the pairing flow — list, approve,
   revoke, and the one sentence about what someone is admitting. **Revoking names the machine, and
   takes every floor it carried with it** (decision 6), so the confirm dialog counts them.
2. `hosts.*` messages in `protocol.ts`, the `hosts.get` group mirroring `accounts.get`, admin-gated
   the same way.
3. The sign over a hosted desk — *💻 the laptop* — and the desk sign carrying the host's name. Needs
   `owner` on `WorkerInfo` or an equivalent field on `host`.
4. Toasts when a host pairs, is revoked, or goes away.
5. "2 floors hosted, 1 asleep" in the Workers panel.
6. The hire dialog's sentence about whose machine is being used.
7. Reconnecting with backoff, and a lost-socket test that leaves nothing in `working` forever.

### Phase F — the docs, in the same PR as the code

Per `CLAUDE.md`, a change that affects how people use the office updates the docs in the same PR.
The surface is small and known:

- **`docs/AGENTS.md`** — its closing paragraph becomes false in Phase C, and it is the first thing to
  fix and the easiest to forget:

  > Every worker is a process on the machine running the office, with the environment the office sets
  > for it, so an agent from a different machine cannot take a desk today. The bridge that would let
  > one — bringing your own agent, and what it could and could not do — is
  > [proposed in remote-agents.md](remote-agents.md), not built.

  It needs a replacement that says where a worker runs follows the floor, and links here.
- **`docs/remote-agents.md`** — Status flips from *proposed* to *built*, with the phase it landed in.
  Its architecture section changes from bridge to floor host; the citation corrections in the table
  above land here too, so the next reader is sent to the right lines.
- **`docs/how-it-works.md`** — the security notes gain a hosted floor: among the most privileged
  things the office holds, named alongside the sign-in link.
- **`docs/agents.md`** — a hosted worker's model and effort are the host's, not the office's
  (finding 7).
- **`README.md`** — only if it becomes a headline feature. It is deliberately **not** in the README
  doc list today, and that is right for a plan; decide at Phase E, not now.

## Test plan

`node --test` over `tests/*.test.ts`, never needing a real agent installed. The house convention is
to test the generated payload and normalisation, not the upstream CLI; a hosted floor follows it.

| File | What it covers |
|---|---|
| `tests/floorhost.test.ts` (new) | A fake host — a `WebSocketServer` on an ephemeral port — driven through the real pairing check. Message round trips, byte and resize round trips, exit codes. **`ctx.hook` is host-local and no hook frame ever crosses the socket** (decision 7). **The office never opens a hosted floor's `def.dir`.** A dropped socket leaves the floor and its workers `offline` and asleep, not spinning. |
| `tests/floorhost.test.ts` (new) | **The count.** Exactly 43 cases in `handleMessage` act on a `Floor`, and every one of them routes to a hosted floor. A 44th case added to the switch without a decision fails the build rather than silently staying office-side. |
| `tests/floorhost.test.ts` (new) | **No sign-ins cross the wire.** A hosted floor's `FloorContext` carries `agentCmd`, `prompts`, `capacity`, `leaveOnMerge`, `people`, `peers` — and no `runAs`, no `forgeAs`, and a `floor(id)` that refuses to reach across an office boundary (decision 9). |
| `tests/floorhost.test.ts` (new) | **Two floors on one socket stay separate.** A frame naming floor A is never applied to floor B, and a frame with an unknown `floorId` is refused rather than guessed at — the multiplex cost of decision 6, which is the whole reason `floorId` is mandatory on every frame. |
| `tests/floorhost.test.ts` (new) | **The permission model, as a test.** A plain member — not an admin — can spawn onto a hosted desk, type into it, prompt it, and send it home, and every refusal is about seats or kind rather than role. Send-home sends `stop` and the host, not the office, removes the worktree. A member may spawn onto a floor that is *not* accepting; an agent on `/office/workers` may not. |
| `tests/hosts.test.ts` (new) | Pairing codes: single-use, expiring, capped, revocable at once. A revoked token is refused on the next upgrade. The `mtimeMs:size` sync picks up `agent-office hosts approve` while the office runs. **One socket carries three floors; revoking it makes all three inert in one event** (decision 6). **A dropped socket marks all of its floors `offline` in a single pass** — not one `gone` per worker, which would race the host back online. |
| `tests/worktrees.test.ts` (extend) | Two hosted workers get two directories; send-home removes only its own. Mirrors the existing `fixture(t)` pattern — a real git triple in a tmpdir. |
| `tests/workers.test.ts` (extend) | Persistence and restore of a hosted worker, including the `offline`-until-the-host-returns boot path and the interrupted-mid-turn flag on a dropped socket. |
| `tests/queue.test.ts` (extend) | A task aimed at a floor whose host is disconnected stays queued and is **not** failed. A task aimed at a floor that is not accepting is refused with a message naming the machine. |
| `tests/agents.test.ts` (extend) | Model and effort refused by the host with a message that says the host decides. |
| `tests/status.test.ts` (new) | **`workerPr` on a hosted floor's four inputs, and nothing else.** A worker whose `pr` arrives only via `worker.update`, whose branch matches only a streamed `gh.pulls`, and whose PR exists only in a streamed `queue` — resolves to `open`, then `merged`, so `landedWork` sends it home. `workerPr` has no test at all today; this is finding 3's whole surviving lesson, since the fix turned out to be "the streams already carry it." |
| `tests/changes.test.ts` (extend) | The Changes window for a hosted floor is served by the host, not by reading `def.dir` office-side. |

Six properties deserve their own test names because they are the ones that would silently rot:
*no hosted worker is left in `working` forever*; *the office never reads a hosted floor's checkout*;
*a disconnected host leaves its floors listed but inert, never dropped from the building*; *no
sign-in crosses the wire to a host*; *every case in `handleMessage` that acts on a floor reaches
it*; and *a frame never touches a floor it did not name*. The last is new with decision 6 — one
socket, many floors, and `floorId` mandatory on every frame.

The permission model gets the same treatment, for the same reason. It is the easiest thing in the
feature to break by accident — a seat check or an accepting toggle written one role check too early —
and nobody notices until a member is refused something they have always been able to do. The test
above is the guard.

## Open questions for the maintainer

Beyond the nine decisions above, three things this plan cannot settle:

1. **~~Is `--isolate container` a Phase C requirement or a Phase D one?~~ Settled by decision 1: no
   isolation is built, so there is no phase for it to land in.** Nothing in the frame design carries
   an isolation mode, and Phase D refuses nothing on those grounds. The open question this replaces is
   whether the exposure is acceptable *for the group this is for* — which is a judgement about who
   hosts floors, not about code, and belongs in the pairing dialog rather than here.
2. **Who runs the Phase A spike?** It needs two machines and someone who can sleep a laptop on
   purpose. It is the only phase that is not parallelisable, and everything after it depends on its
   answer.
3. **Should a hosted floor ever be able to run something the office did not ask for?** The
   proposal's refusal table says no, and this plan assumes no. If the answer is ever yes — a host
   that offers a desk without the office hiring into it — the whole authority model inverts and none
   of the above holds.
