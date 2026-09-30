# Remote agents: implementation plan

The plan for building what [remote-agents.md](remote-agents.md) proposes.

Status: **plan**, nothing implemented yet. Target: agent-office `main`.

Back to the [README](../README.md).

## What this document is

`docs/remote-agents.md` is the **proposal**: the requirement, the trust-model analysis, the refusal
table, the alternatives. It is a good document and this plan does not argue with it. This is the
engineering pass: every claim in it checked against the tree as it stands, the places where the
proposal turns out to be wrong or optimistic, the decisions that have to be made before code is
written, and then the work broken into tasks a person can pick up one at a time.

Read this next to the proposal, not instead of it. Where the two disagree, this one is right and the
proposal should be corrected as each phase lands.

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

The claims that need correcting are all citation drift, not design errors. These are worth fixing in
the proposal as each phase lands, because a plan that points at the wrong line teaches the next
reader the wrong place:

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

1. **`WorkerInfo.owner` does not exist.** The proposal's hire section says "`WorkerInfo.owner` and
   `createdBy` already record who asked and whose sign-ins a worker runs as". `createdBy` is on
   `WorkerInfo`. `owner` is on the **internal** `Worker` interface only, is persisted as a separate
   top-level key in `workers.json`, and reaches the office through `WorkerManager.ownerOf(id)`. It is
   never sent to a browser. Any plan that needs "whose machine is this" on the client has to add it to
   `WorkerInfo` rather than read it.
2. **Search reads the live terminal, not the stored scrollback.** `WorkerManager.search()` walks
   `w.term` in memory. `ScrollbackStore` is only the on-disk copy that survives a restart. This is
   good news for the retention decision: "no retained scrollback" is one decision with two
   independent halves, and they can be made separately.

## What the proposal misses

These are the findings that change the work. Ordered by how much they change it.

### 1. There is no "offline until its bridge returns" mechanism, and the existing one fights it

The proposal's risk 9 says a laptop that sleeps mid-turn is a worker whose terminal was lost, and that
the office should reuse its existing honest answer: `offline`, resumable with **R**. The existing
answer is not reachable from the code as written.

`follow`'s lost branch (`workers.ts:1900-1905`) does this:

```ts
if (lost && !this.closing) {
  if (midTurn(w)) w.interrupted = true;
  this.resume(info.id);
  return;
}
```

It **immediately relaunches**. For a lost local PTY host that is right — the host restarts. For a lost
bridge it is wrong, and it will spin: relaunch, seat, refuse, exit, relaunch.

The boot path has the same problem. `restore()` sets every restored worker to `offline`, and then
`start()` calls `wakeAll()`, which resumes every worker that has neither a pty nor a dsh session:

```ts
wakeAll() {
  for (const w of this.workers.values()) if (!w.pty && !w.dsh) this.resume(w.info.id);
}
```

So the proposal's stated precedent — "restores as `offline` until its bridge returns, like a DeepSeek
Harness worker today" — describes a mechanism that does not exist, and the nearest neighbour it names
does not work that way either.

**Resolution:** `PtyExit` gains a third shape. `PtyExit` is already `{ exitCode, error?, lost? }` and
`follow` already branches on `lost`, so widening it is small and honest:

```ts
export interface PtyExit {
  exitCode: number;
  error?: string;
  /** The host went away under it; the process is gone. */
  lost?: boolean;
  /** The far end walked (a bridge socket dropped). It may come back: hold, don't relaunch. */
  gone?: boolean;
}
```

`gone` means: set `interrupted` if mid-turn, leave `w.pty` undefined, set status `offline`, **do not
resume**, do not surface an exit code in the terminal. `wakeAll` gains the same guard — a worker with
`info.remote` and no bridge is left asleep. Resume is then an explicit human act (**R**), which is what
the proposal wants anyway. This is the single most important change in the whole feature and it should
land in Phase 1, not Phase 3.

### 2. `/office/*` has to be forwarded too, not just hooks

The proposal's authority rule says a remote worker may hire, tell and send home office-local workers
and workers on its own bridge, and that "a forwarded `/office/*` call carries its bridge; the handler
refuses workers on another bridge". The frames table lists only `hook`.

But `/office/workers` and `/office/queue` are **HTTP endpoints on the office's loopback hook server**
(`server.ts:303-304`), not frames. `bin/office-workers.js` builds its URL from
`AGENT_OFFICE_HOOK_URL` — the same variable the status bridges read. Point that at the bridge and the
agent's MCP server and CLI both call the bridge, not the office. So the bridge's loopback listener has
to be a **reverse proxy for the whole hook server surface**: `/hooks/*`, `/office/workers*` and
`/office/queue`, not just `/hooks/*`.

That changes the security story in a way worth stating plainly. Today `/office/workers` requires
`?worker=<id>` plus the per-worker bearer token, and `WorkerManager.authenticate` additionally requires
that worker to have a live PTY or ACP session. Over a bridge those checks are unchanged, which is good,
but the office now has to add the bridge identity to the forwarded request and compare it. See the
task list; the point for the plan is that the proxy surface is larger than the proposal's frames table
implies.

### 3. PR discovery breaks silently, in four separate places

The proposal is right that "pull requests are required, not optional" and right that it is Phase 1
work. It does not say why it is hard, and the reason is that `workerPr` is **derived**, not stored:

```ts
export function workerPr(w: WorkerInfo, pulls: GhPull[], tasks: QueueTask[]): WorkerPr | undefined
```

It matches a worker to a pull request by PR number, or by `w.worktree.branch === p.headRefName`. A
remote worker has no office-side worktree path, so:

- the branch match never fires;
- the bridge's `report { pr }` frame has nowhere to land, because `WorkerInfo.pr` is set by the
  office's own `worker.pr` handler after the office runs `gh`;
- `landedWork` (`leave-on-merge.ts:104`) is how a merged PR sends its worker home, so a remote worker
  would sit at a desk forever after landing its work;
- the gong never rings, which the proposal names as the difference between collaboration and a stranger's
  machine being quietly busy.

`workerPr` has four call sites — `office-workers.ts:66`, `leave-on-merge.ts:104`, and two in
`client/main.ts` — and **no test coverage at all**, which is why this would have been found late.

**Resolution:** `WorkerInfo.remote` carries `{ bridgeId, host, branch?, pr? }`. `workerPr` gains a remote
branch that trusts `remote.pr` directly, because the bridge is the only party that can have set it and
the office has nothing to cross-check it against. That is one function and one union field, and it
fixes all four call sites at once. Synthesising a `GhPull` and appending it at each call site also
works and is worse: four edits, each one a chance to forget.

### 4. "No retained scrollback" is four switches, not one

The proposal says remote workers should default to no retained scrollback, and is right about why. The
code has retention in four independent places:

| Where | What |
|---|---|
| `workers.ts:1848` `newTerm` | `scrollback: SCROLLBACK` on the office's headless mirror |
| `screen.ts:30` `screenSnapshot` | `ser.serialize({ scrollback: SCROLLBACK })` — what a joining browser replays |
| `workers.ts:2176` `saveScrollback` | the 15-second timer writing `.agent-office/scrollback/<id>.ansi` |
| `workers.ts:1564` `launch` | the prelude read that puts it back on resume |

Search (`workers.ts:875`) walks the live `w.term`, so it follows the first switch for free. The fourth
needs the load suppressed as well as the save, or a resume will resurrect a transcript the retention
decision was meant to drop. `SCROLLBACK` is one exported constant; make the retention decision per
worker and thread it through all four.

### 5. `resize` is unthrottled, and a bridge turns that into a real problem

The proposal's risk 6 says debouncing resize office-side is "likely necessary" without saying where.
`WorkerManager.resize` clamps the dimensions and calls through on every single `term.resize` frame:

```ts
resize(id: string, cols: number, rows: number) {
  ...
  w.pty?.resize(cols, rows);
  w.term.resize(cols, rows);
}
```

On a local PTY that is free. On a bridge socket it is a round trip per frame, from every viewer, and
xterm.js emits those continuously during a drag-resize. Put the debounce in `BridgePty` (coalesce to
one outstanding resize, send the latest 80 ms after the last request) rather than in
`WorkerManager.resize`, so only bridges pay for it.

### 6. `spawn()` is at 13 positional arguments and needs a 14th

`spawn(deskId, by, prompt?, worktree?, kind?, provider?, model?, effort?, meeting?, owner?, repos?, via?)`
has five call sites: `server.ts:1721` (browsers), `server.ts:475` (an agent hiring through
`/office/workers`), `queue.ts:336` (the queue), `floor.ts:266` (meetings), and `workers.ts:570`
(`station`, board agents). Adding `remote` as a fourteenth positional is possible and will be
regretted.

**Resolution:** do the small refactor in the same PR. Replace the tail
`meeting?, owner?, repos?, via?, remote?` with one `opts?: SpawnOptions` object, update the five call
sites in one commit, and leave the leading required parameters alone. This is the moment where it is
cheap; after Phase 1 it is a migration across a live protocol. `server.ts:475` matters most here: it is
the agent-driven hire, so it is the one that must never get a `remote` target it did not intend.

### 7. Model and effort validation has no notion of "remote"

The proposal's mapping table says `validateWorkerModel` / `validateWorkerEffort` "must refuse an
office-side model or effort for a remote worker". Both are pure and take `(kind, provider, value)`; they
have nothing to plug a bridge into, and threading a fourth parameter through `queue.ts:91-94` and
`workers.ts:393-396` makes them lie about what they check.

**Resolution:** do not touch them. Refuse at the call sites, where the bridge is known — in `spawn`,
once the target bridge is resolved, before anything is written. The message should name the reason:
*"laptop chooses its own model; the office can't set it"*. The same call site is where meetings,
`repos` and board agents get their refusals, so it is one gate, not four.

### 8. Smaller things worth knowing before starting

- **The upgrade path has exactly one listener.** `server.ts:1101-1119` is the whole `upgrade` handler and
  the only `WebSocketServer`. `/bridge` must be branched **before** the session gate on `:1117`, and
  note that `:1116` computes `session` only for `pathname === '/ws'`, so a `/bridge` request falls
  straight through to the refusal. Prefer a second `WebSocketServer` instance for `/bridge` so bridge
  frames are a separate type domain with their own payload cap and their own connection lifecycle, rather
  than sharing `maxPayload: 2 MiB` and the `ServerMsg` union with browser traffic.
- **There is no runtime schema anywhere.** `ws.on('message')` does `JSON.parse` and `handleMessage`'s
  `switch (msg.t)` has no `default` — an unknown `t` is silently dropped. Every case re-coerces with
  `str`/`num`/type guards. A bridge frame protocol therefore needs **its own** validation from scratch.
  There is nothing to piggyback on.
- **`readMessages` is typed against `net.Socket`.** The newline-delimited JSON framing is reusable and
  worth reusing; the WebSocket variant is a five-line change, but do not pretend the types line up.
- **`Pty` has no unsubscribe.** `onData`/`onExit` return `void` and hold their callbacks forever. One
  bridge socket holds N `BridgePty` instances; lifetime has to be managed by the bridge registry, not by
  the callbacks.
- **`Worktrees` is reusable as-is.** It holds one `dir` and no office state, so the bridge can
  `new Worktrees(projectDir)` and get identical behaviour. It has no method that reports a branch
  without creating a folder, so the office learns the branch over the socket.
- **`safeEq` exists twice, file-local, and is exported by neither** (`workers.ts:2588`,
  `ptyhost.ts:247`). The bridge registry needs a third. Lift one copy into `src/shared/` in the same
  PR rather than adding a third.
- **Costs are structurally excluded from the budget already.** `ledger.add(...)` runs only on the
  Claude transcript path, so a bridge-reported cost cannot reach `--budget` or `usage.json` even by
  accident. Route it through `reportedUsage()` — it already validates the exact shape a
  `report { cost, tokens }` frame wants and **rejects the whole snapshot rather than zeroing it**, which
  is the right behaviour for a number the office cannot verify.
- **`ws` is already a runtime dependency**, so `bin/agent-office-bridge.js` needs no new dependency, and
  `bin/` is already in `package.json` `files`. The only packaging change is one `bin` entry.
- **No test in the repo has ever opened a socket.** `tests/bridge.test.ts` would be the first. It gets
  to pick its own pattern; the closest precedents are a real `http.Server` on an ephemeral port
  (`tests/office-queue.test.ts`) and a narrow interface faked rather than a class (`tests/queue.test.ts`).

## Decisions to lock before writing code

These are the questions the proposal explicitly leaves open. Each has a recommended answer and a
consequence; they are listed as questions because a human has to own them, not because they are hard.

| # | Question | Recommendation | Consequence of the other way |
|---|---|---|---|
| 1 | Does the office refuse a bridge without `--isolate container` from anyone who is not the operator? (proposal risk 1) | **No**, refuse nothing; make the setting loud and default it on | Refusing makes the feature unusable for the group it is for, and the isolation flag is a bridge-side choice the office cannot verify anyway |
| 2 | Does a bridge without a bridge seat also need a per-hire human approval? (proposal risk 2) | **No.** The accepting toggle is the control | Per-hire approval kills the queue automation that is the reason to build this |
| 3 | Do remote workers count against `--max-workers` and the queue's *workers at once*? (risk 7) | **Yes**, both | Not counting them is how a five-person office spends five people's money on one laptop |
| 4 | Two offices, one machine — supported, tolerated or refused? (risk 8) | **Tolerated**, tested | Refusing breaks a legitimate setup; supporting it properly is more work than it looks |
| 5 | Whose git identity does a bridge push with? (risk 10) | **The bridge's**, shown in the pairing dialog and the desk sign | The office's identity would put a stranger's commits in the operator's name |
| 6 | Is the bridge token scoped to one floor or the whole office? | **The whole office**, with a floor id chosen at pair time | A per-floor token means an admin approving a machine cannot see which floor admitted it |
| 7 | Does a hook frame carry the worker's hook token, or the bridge's token? | **The worker's own token**, checked with `safeEq` per worker id | A bridge-wide token would let one worker's compromised bridge speak for another |

Question 7 is the one to be most careful about, because it is the difference between "a bridge is
trusted" and "a bridge is trusted only for the workers it is paired to seat". The proposal is right that
a forwarded hook should be accepted only for the worker id that socket is paired to; carrying the
worker's own token makes that check the existing one, unchanged.

## The plan

Six phases. Phase A is a throwaway spike that must happen before anything else, because two of its
questions can invalidate the design.

### Phase A — spike (throwaway, no shipped code)

The proposal's Phase 0, with the exit criteria written down so it can actually end.

A hand-written bridge: connects, seats a Claude in a local PTY, forwards bytes and answers one
synthetic `hook` frame. Throwaway — it does not become `bin/agent-office-bridge.js`.

**Measure, and write the numbers down:**

1. Does the headless-xterm mirror stay correct through a laptop's latency and a reconnecting socket?
   Force a reconnect mid-stream and confirm the office does not double-render or drop the last screen.
2. Does `data` racing `hook` visibly corrupt the status machine? If yes, frames need a sequence number.
   Learn that here, not after the UI exists.
3. **How does the office learn the branch?** This is the finding-3 question in miniature, and it is the
   one most likely to change the frame design. If PR discovery needs a synthesised `GhPull` rather than
   a `remote.pr` field, the frame shape changes and every later phase inherits that.

**Exit criteria:** all three answered, in a comment on the issue. If (2) is real, `seq` goes on every
bridge frame in Phase B and costs nothing to add.

### Phase B — the wire

The pieces everything else needs. No UI.

1. **`src/shared/bridge.ts`** (new) — `BRIDGE_PROTOCOL` version constant, the `ToBridge` / `FromBridge`
   frame unions, and the small validators. Written from scratch: there is no schema to reuse, per
   finding 8.
2. **`readMessages` for WebSockets** in `ptys.ts`, or a `frameReader()` in the new file that both can
   use. Keep the newline-delimited JSON framing; it is already the office's shape.
3. **`src/server/bridges.ts`** (new) — the registry, modelled on `accounts.ts`: `sync()` on
   `mtimeMs:size`, write-tmp-then-rename at `0600`, the `T | string` union return for errors,
   `INVITE_TTL_MS` and `MAX_*` caps. Pairing codes, approve, revoke, token lookup. Plus
   `bridgesCommand(argv)` for `agent-office bridges`, slotting into `cli.ts` beside `accounts`.
4. **`bridges.json`** at `cfg.dataDir` — office-level, beside `accounts.json`, not per floor. A bridge
   is admitted to an office, and `Accounts` already establishes that precedent at `server.ts:209`.
5. **`/bridge` upgrade** in `server.ts` — a second `WebSocketServer`, branched before the session
   check, refusing anything whose presented token does not match a live bridge. The socket then
   presents its token, per decision 6.
6. **`BridgePty`** in a new `src/server/bridge-ptys.ts`, beside `RemotePty`. Copy its three patterns
   exactly: held output drained on first subscribe, memoized exit delivered to a late subscriber, and
   a `gone` exit that does not relaunch (finding 1). Coalesce resizes (finding 5).

**Exit:** a fake bridge on an ephemeral port seats a worker, bytes and resizes round trip, and a
dropped socket leaves the worker `offline` and asleep rather than spinning.

### Phase C — seat a remote worker (the value)

This is Phase 1 in the proposal, and per the proposal it is **the whole of the value in one phase**.

1. `WorkerInfo.remote?: { bridgeId; host; branch?; pr? }` in `protocol.ts`, threaded through
   `persist()` and `restore()` — both are hand-rolled projections, so both need it, plus a validator
   beside the existing `validRepos`.
2. The `spawn` signature refactor (finding 6) in its own commit, before `remote` is used.
3. `launch()` branches on `info.remote`: instead of `this.host.spawn(...)`, send a `seat` frame with the
   worker id, the bridge's cwd, the branch, and the prompt. Everything downstream — `follow`,
   `newTerm`, `adopt`, the snapshot on join, screen sharing — is transport-agnostic already and does
   not change.
4. **The hook loopback listener in the bridge**, and the office's `AGENT_OFFICE_HOOK_URL` pointed at
   it. This is the trick the proposal is most right about: because every provider reads its endpoint
   from the environment and none of them assumes loopback, no provider bridge changes at all. Bind
   `127.0.0.1` only and **refuse a routable bind** rather than trusting the flag.
5. **`gone` / `wakeAll` guards** (finding 1). Phase B's `BridgePty` emits it; this is where the worker
   manager learns what to do with it.
6. **`report { pr, cost, tokens }`** landing in `remote.pr` and `info.usage`, the latter through
   `reportedUsage()` so an implausible snapshot is dropped rather than zeroed. Plus the `workerPr`
   change (finding 3) so the boards, the PR window and `landedWork` see the PR at all.
7. **No retained scrollback** by default, all four switches (finding 4).
8. The bridge cutting a worktree per worker — reuse `Worktrees` as-is.

**Exit:** a member's agent at a desk in someone else's office, with a terminal, status, `needs_input`,
a PR on the boards, resume and send-home.

### Phase D — who may hire, and who may reach across

Phase 2 in the proposal.

1. **Seats and the refusing message.** `--seats` declared at `ready`; a hire beyond capacity names the
   machine: *"Bolt's laptop has no free desk"*.
2. **The accepting toggle.** Agents may only hire onto an accepting bridge; people may always hire.
   Refused at the same call-site gate as meetings and `repos` (finding 7), not in the queue.
3. **Queue behaviour when a laptop is asleep.** A remote-targeted task with no bridge connected stays
   **queued**, visibly, with the machine named — never `failed`. `queue.ts:338-345` turns any `spawn`
   refusal into `failed`, so the gate must reject *before* `spawn`, in `seat()`'s desk choice.
4. **The authority rule.** The bridge's loopback listener proxies `/office/workers*` and `/office/queue`
   as well as `/hooks/*` (finding 2), and the office's handler refuses workers on another bridge. The
   check goes right after `authenticate` resolves the caller, which is the only handle on "which bridge
   asked".
5. **`--isolate container`**, and the office refusing meetings, `repos`, the changes window and the
   budget for a remote worker as refusals rather than degraded modes.

**Exit:** two members bridging into one office, with the authority rules enforced by test.

### Phase E — the surfaces

Phase 3 in the proposal, plus the parts the proposal lists without saying where.

1. ⚙️ Settings → **🌉 Bridges**, modelled on `src/client/ui/accounts.ts` — list, approve, revoke, and
   the one sentence about what an admin is admitting.
2. `bridges.*` messages in `protocol.ts`, the `bridges.get` group mirroring `accounts.get`, admin-gated
   the same way.
3. The sign over a remote desk — *💻 Bolt's laptop* — and the office default worker name carrying the
   machine. Needs `owner` on `WorkerInfo` or an equivalent field in `remote`.
4. Toasts when a bridge pairs, is revoked or goes away.
5. "2 bridges, 1 seat free" in the Workers panel.
6. The hire dialog's sentence about whose machine is being used.
7. Reconnecting sockets with backoff, and a lost-socket test that leaves nothing in `working` forever.

### Phase F — the docs, in the same PR as the code

Per `CLAUDE.md`, a change that affects how people use the office updates the docs in the same PR. The
surface is small and known:

- `docs/AGENTS.md` — its closing paragraph ("Every worker is a process on the machine running the
  office… [proposed in remote-agents.md], not built") becomes false in Phase C. This is the first
  thing to fix and the easiest to forget.
- `docs/remote-agents.md` — Status flips from *proposed* to *built*, with the phase it landed in. The
  citation corrections in the table above land here too, so the next reader is sent to the right lines.
- `docs/how-it-works.md` — the security notes gain a bridge: a bridge is among the most privileged
  things the office holds and should be named alongside the sign-in link.
- `docs/agents.md` — a remote worker's model and effort are the bridge's, not the office's.
- `README.md` — only if it becomes a headline feature. It is deliberately **not** in the README doc list
  today, and that is right for a proposal; decide at Phase E, not now.

## Test plan

`node --test` over `tests/*.test.ts`, never needing a real agent installed. The house convention is to
test the generated bridge and payload normalisation, not the upstream CLI; a remote worker follows it.

| File | What it covers |
|---|---|
| `tests/bridge.test.ts` (new) | A fake bridge — a `WebSocketServer` on an ephemeral port — driven through the real `BridgePty` and the real pairing check. Seat handshake, byte and resize round trips, exit codes, hook forwarding. **A forwarded hook for another worker's id is refused** (decision 7). **A forwarded `/office/*` call cannot touch another bridge's worker.** A dropped socket leaves the worker `offline` and asleep, not spinning. |
| `tests/bridges.test.ts` (new) | Pairing codes: single-use, expiring, capped, revocable at once. A revoked token is refused on the next upgrade. The `mtimeMs:size` sync picks up `agent-office bridges approve` while the office runs. |
| `tests/worktrees.test.ts` (extend) | Two seated workers get two directories; send-home removes only its own. Mirrors the existing `fixture(t)` pattern — a real git triple in a tmpdir. |
| `tests/workers.test.ts` (extend) | Persistence and restore of a remote worker, including the `offline`-until-the-bridge-returns boot path and the interrupted-mid-turn flag on a dropped socket. No retained scrollback unless the bridge opted in. |
| `tests/queue.test.ts` (extend) | A remote-targeted task with no bridge connected stays queued and is **not** failed. A task aimed at a bridge that is not accepting is refused with a message naming the machine. |
| `tests/agents.test.ts` (extend) | Model and effort refused for a remote worker, with a message that says the bridge decides. |
| `tests/status.test.ts` (new) | `workerPr` returns the bridge-reported PR for a remote worker, so `landedWork` can send it home. There is no such test file today; `workerPr` has none at all. |

Two properties deserve their own test names because they are the ones that would silently rot:
*no remote worker is left in `working` forever*, and *a remote worker keeps no retained scrollback
unless its bridge opted in*.

## Open questions for the maintainer

Beyond the seven decisions above, three things this plan cannot settle:

1. **Is `--isolate container` a Phase 1 requirement or a Phase 2 one?** The proposal puts it in Phase 2
   and its risk 1 calls the bridge "the sharpest surface in the project". Those pull in opposite
   directions. The plan follows the proposal (Phase 2) on the grounds that `Worktrees` reuse and the
   hook proxy carry the value, and isolation is a Dockerfile — but if the answer is Phase 1, the frame
   design needs the isolation mode in `ready` from the start.
2. **Who runs the Phase A spike?** It needs two machines and someone who can sleep a laptop on purpose.
   It is the only phase that is not parallelisable, and everything after it depends on its answer.
3. **Should the bridge ever be able to run something the office did not ask for?** The proposal's
   refusal table says no, and this plan assumes no. If the answer is ever yes — a bridge that offers a
   desk without the office hiring into it — the whole authority model inverts and none of the above
   holds.