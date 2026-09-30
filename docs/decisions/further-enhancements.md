# Further enhancements — the whole table

**Pattern:** 🗣️ Debate · 3 rounds · **Output:** this file
**Called by:** the boss (Mellow Sagar) · **Chair:** Byte

> **The question:** the office is the busiest it has ever been and the least trustworthy. Every bot at a
> desk is doing work, the queue board is full of failures that never happened, the meeting room has
> never once finished a round, and nothing tells you what any of it cost. This meeting takes the
> office's own floor as the client and asks what to build next.

## How it was held

Five seats, the room's full table, in the debate pattern's roles: **Chair** (Byte), **Pragmatist**,
**Skeptic**, **Simplifier**, **User advocate**. Round 1 each read the code and the live
`.agent-office/` state and put up proposals. Round 2 cross-examined them. Round 3 is this file.

The table sat in a git worktree rather than in the 3D meeting room. That is a real limitation and
it is worth stating plainly: `.agent-office/meetings.json` holds **6 meetings and all 6 stopped in
round 1**, five of them the same way ("the Correctness … never started on its part"). Convening a
seventh one through the room would have been the riskiest possible way to have this conversation.

**Every number below was re-checked against the live floor when this file was written.** The office
was running throughout, so the counts move; the shapes do not.

| What the floor looked like | |
| --- | --- |
| Workers at desks | 13, **every one of them `opencode`** |
| …with a session id, usage or worked-time the office can see | **0 of 13** |
| …whose terminal is in the pty host (so it survives a restart) | 13 of 13 |
| Queued tasks | 25, of which **17** are stamped *"The office restarted while it was running"* |
| …of those 17, how many actually shipped | **11 have a merged PR**; 6 have none |
| Meetings ever recorded | 6 — **6 stopped in round 1** |
| `office/*` branches | 18, of which 10 are already merged into `main` |

## Round 1 — what was proposed

Twenty proposals, grouped. The evidence column is the thing to check before believing any of it.

### Reliability — the office loses work it has already done

| # | Proposal | Evidence |
| --- | --- | --- |
| R1 | **`workers.json` is written in one shot and read back unguarded.** A torn or unreadable roster restores as *zero workers*, and the constructor then prunes every scrollback file (`workers.ts:301`) and `start()` kills every terminal the roster doesn't claim (`workers.ts:334`). A failure designed to lose data. | `workers.ts:2270` is a bare `writeFileSync`; `restore()`'s catch is `// corrupt state file: start fresh`; `accounts.ts:269`, `hosts.ts:133` and `whiteboard.ts:163` already do `tmp`+`rename` — the pattern exists in the repo and was not applied to the one file that says *who exists*. |
| R2 | **The queue calls every running task dead on restart**, while the worker behind it is restored, resumed and still holding its task. | `queue.ts:406-412` is unconditional. The comment above it — "whatever was running died with the old office process" — is false for a terminal the pty host kept alive. 17 tasks carry it; 11 shipped. |
| R3 | **Meetings decide a worker is dead by a stopwatch.** `START_GRACE_MS` is 60s of *terminal silence*, and the re-prompt's return value is thrown away — so a prompt that never left the office is blamed on the worker. | `meetings.ts:52`, `:369`, `:380`. |
| R4 | **On a hosted floor, "send home" reports the wrong answer, silently.** `worker.kill` returns `r.error ?? r.note` — a *string* — and the wire's own convention reads any string return as a **refusal**. A success is reported as a refusal; a sleeping host resolves `"<Machine> is asleep"` into the same slot. | `host-floor.ts:250-253` against `host-floor.ts:224-229`; `remote-floor.ts:246` casts the answer with no check, where all eight of its siblings use `String(…)`. |
| R5 | **Nothing in the office knows a worker stopped making output.** `w.outputAt` is written on every byte (`workers.ts:1936`) and read by exactly one caller — the meeting room. It never reaches a browser. | grep: one reader. |
| R6 | **No disk-space check anywhere, and no `uncaughtException` handler.** A full disk makes a floor vanish at boot, or kills the office outright. | `grep -rn "statfs\|ENOSPC" src/` → nothing. `cli.ts` registers `unhandledRejection` but no `uncaughtException`. |

### Operations — the office leaks everything it is given

| # | Proposal | Evidence |
| --- | --- | --- |
| O1 | **Merged workers never go home.** The sweep exists (`floor.ts:344`) and is gated on a setting that is **off by default** and has never been switched on. | `leave-on-merge.ts:24`, `this.saved?.on ?? false`; there is no `leave-on-merge.json` on disk. |
| O2 | **A hosted floor can never sweep at all**, whatever its settings say. | `host-floor.ts:201` hardcodes `leaveOnMerge: () => false`. Not on anyone's list until round 2. |
| O3 | **A worker's dev servers outlive it.** | Two `vite --port 5199` processes running from a worktree that no longer exists. |

### The human on shift

| # | Proposal |
| --- | --- |
| U1 | Nothing tells you what happened while you were away — toasts are DOM nodes that die with the tab, and both the desktop notifier and the webhook require a status *transition* to fire. |
| U2 | A hung or dead worker looks exactly like a working one; `exited` is not in `waitingOnSomeone` (`notify.ts:27`), so a dead bot raises no ding, notification, arrow, title count or webhook. |
| U3 | The Workers panel is sorted by hire order with no clocks, while the phone view (`/lite`) sorts by urgency and shows them. `byUrgency` exists, is tested, and is unused there. |
| U4 | Merging a PR and sending its worker home are two rituals that never meet. `notLeaving()` already computes eight human-readable reasons and **no caller ever shows one to a human**. |
| U5 | "What did that task cost?" has no answer: `QueueTask` has no usage field, the ledger is Claude-only, so `--budget-pause` is decorative the moment you leave Claude. |

### Weight that no longer earns its keep

One hook pipeline for `codex`/`grok`/`muse` (~650 lines, three identical validators); one
`PROVIDER` capability table instead of six hand-written copies; ~150 lines of dead hosted-floor
control-panel scaffolding (`LiveFloor.seats`, `counts()`, `HostState` — a protocol message with no
sender and no receiver); one prompt dialog instead of two (`ask.ts` and `prompt.ts` are the same
dialog, and both declare the same `WT_KEY` literal); one loopback hook server instead of two, with
`readBody` implemented twice **with different behaviour**.

And the docs: `docs/remote-agents-plan.md` is 937 lines whose own header says "the host does not yet
run a real `Floor`" — which `bcf6048` shipped. `docs/remote-agents.md` still reads *"Status:
proposed, not implemented"* over a table of things that now work. `tests/docs.test.ts` only checks
that links resolve, so both stay green while false.

## Round 2 — what the critique changed

The cross-examination did more work than round 1. Four corrections, all of which survive the
chair's own re-check:

1. **"The pty host is up with no client, so every worker is in-process and dies on restart" — false,
   and it was the most quotable claim on the table.** The socket has a live client; 13 of 13 workers
   are hosted and survive a restart. The real, much smaller defect is that `connect()`'s boolean is
   discarded at `workers.ts:324` and `onClose` (`ptys.ts:303-314`) never reconnects. **This is why
   every number in this file was re-checked rather than trusted.**
2. **The seat-count story was stale.** Commit `1e6b0ea` (shipped the same evening) already fixed
   the first half of the meetings item. What survives is the discarded re-prompt return, `halt()`
   interrupting only seats whose status it can see, and the fact that the token budget
   (`meetings.ts:317`) counts only provider-reported usage — which is **0 for every worker on this
   floor**, so a meeting here currently has no spend ceiling at all.
3. **"Leave on merge" is a settings flip, not a feature.** The sweep is wired and timer-driven;
   turning it on in ⚙️ reaps the merged workers with no code. The genuinely broken version —
   a *hosted* floor can never sweep — was not on anyone's list.
4. **"Let a stuck seat leave instead of halting the table" was blocked, and correctly so.**
   `meetings.ts:322` non-null-asserts the seat's worker, and the comment at `:296-302` says the
   later hand-over halting on a missing seat is *deliberate*. Allowing a seat to leave turns a
   TypeError into a week of debugging.

**One thing the table missed entirely, and found only in round 2:** there is **no lock on the data
directory**. Two office processes were seen running against one `.agent-office` during this meeting
— same cwd, same `dataDir`, nothing guarding it. That is two writers for `workers.json` (which
manufactures exactly the corruption R1 fears), and `ptyhost.ts`'s "newest office wins" eviction is
what pushes the loser into in-process spawning. Adding `tmp`+`rename` without a lock would leave the
cause in place.

**The same defect wearing three hats:** R1, R2 and R5 are one thing — *the office has no durable,
single-writer, recoverable boot story*. R3 and U2 are one thing — *there is no liveness field on
`WorkerInfo`*, which is why the meeting room had to invent `activeSince`. Fix each once.

## Round 3 — the decision

**The table's ruling: the office does not need a new feature. It needs one restart not to cost the
floor.** Twenty proposals were tabled; eight ships are planned, and the rest are deferred on
purpose.

**PR 1 — A restart is not an event.** *(R1 + R2 + a lock on the data directory + guarded constructor
writes. ~5h.)* `persist()` → `tmp`+`rename`, a `.bak` to fall back to, and `restore()` reporting
failure so that `scrollback.prune` and `killUnclaimed` are skipped — an empty roster must read as
*unknown*, not *empty*. Queue: a running task whose worker came back stays running. **This lands
first not because it is the worst bug but because everything else on this list is verified by
restarting the office, and a restart is currently the thing that destroys it.**

**PR 2 — A dead worker must not look like a working one.** *(U2. ~4h.)* `exited` reaches the
notifier, the compass, the title count and the webhook; `lastOutputAt` reaches the browser. ⚠️ **Do
not widen `waitingOnSomeone` itself** — it also drives the arcade pause and the `N` key. Add a
sibling `needsAttention()` and point the notifiers at that.

**PR 3 — The host link stops lying.** *(R4. ~1.5h.)* Return the note as a note, never as a
refusal. Disjoint files from PR 1: a bot can hold this while PR 1 is in review.

**PR 4 — Workers whose work landed, visible and sendable.** *(O1 + O2 + U4. ~4h.)* The sweep
already exists — the work is making it visible and honest (`notLeaving()`'s reasons, on screen).
Turn the setting on. **Suggest, never auto-kill.**

**PR 5 — Meetings stop halting on a stopwatch.** *(R3, subtractive half only. ~5h.)* A seat with a
moving `outputAt` is never "never started"; `halt()` interrupts by the seat's own `sentAt`; a failed
re-prompt halts with *that* reason. Every change removes a wrong termination; none adds a state.

**PR 6 — A newcomer can find the controls and the docs.** *(U6 + retiring the plan doc. ~3h.)*
`H` is not listed in the help modal, nothing in the office links to the office's own docs, and the
hire → PR → review → merge → send-home order is written down nowhere.

**PR 7 — A silent worker is loud.** *(The loud half of R5. ~1.5h.)* The in-process fallback is
correct and documented; its defect is that it is silent.

**PR 8 — Delete the dead hosted-floor control panel.** *(~150 lines. ~3h. Last, and a bot's.)*

### Deferred on purpose, and what would change that

| Deferred | Why not now | What would change it |
| --- | --- | --- |
| Merging the three hook pipelines | It rewrites the code that produces *every agent's status*, and the failure mode is precisely the symptom PR 2 exists to kill. Ugly is not broken. | A recorded fixture driving a fake provider through all three. |
| The "while you were away" digest | Downstream of PR 2: a digest built on today's status model cheerfully reports "12 tasks done" for 12 tasks that died in a restart. | PR 2 merged and `exited` + `lastOutputAt` stable through a week of real use. |
| Reconnect/backoff for the pty host | 6h of terminal-lifecycle surgery whose failure mode is "the office does not boot" — an outage you cannot get into to fix. The fallback costs one restart. | Evidence the host socket drops in normal single-machine use more than once a fortnight. |
| Killing a worker's dev servers | Process-group kills are the classic way to kill the wrong process. Show whose port it is first; kill in a later PR titled about ownership. | Orphaned servers actually holding a port the maintainer needs twice a week. |
| Freezing DeepSeek Harness (`dsh.ts`, 1148 lines, zero users here) | A feature *removal* with a protocol surface, and it collides with PR 6's docs test. | Nothing this fortnight; a quarter-scale decision. |

### The decision, in the fewest words that are still true

> Ship PRs 1–8 in that order. PR 1 is a precondition for safely testing the others, not a big scary
> project. Bundle only what shares a trigger or a call site. Do not touch the hook pipelines, the
> away-digest or dsh this fortnight. **One restart should no longer cost the floor.**

---

*Decided by the table on 2026-10-01. Every PR above is small enough for one bot; the two that are not
(the meeting room's round semantics, and the budget for a provider that reports nothing) are the
next meeting's business.*