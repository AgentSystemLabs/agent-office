# Plan: the helper at a desk

Bringing a second agent to a worker who is stuck, so you don't have to.

Status: **proposal.** Nothing built. Most of the design is settled; the open questions are at the
bottom, and the first one — what the helper is *for* — is the only thing between this and a first
commit.

Back to the [README](../README.md) · [Ideas](ideas.md) · [Features](features.md)

---

## The idea

You are walking the floor and a worker is stuck — the office already tells you when, see
[The trigger](#the-trigger). You press a key. A second agent walks over, stands at the side of that
desk holding a laptop, reads what the worker is doing, works out what's wrong, and tells **the
worker**. The worker decides what to do about it. It never writes to the branch, never opens a PR,
and never sits down.

You can open its terminal, read its thinking as it happens, and type into it — the same as any
other worker. It stands at the desk while the work gets finished, and it leaves when the visit is
over: you press **X**, or the worker's tests start passing again, or its pull request opens.

## What this is not

Not mob programming, and not a second pair of hands. The distinction is what keeps it safe:

- **A pair** co-drives one terminal. Two agents, one task, shared authorship. The work is divided.
- **A helper** is a visitor with one job: say something useful, then leave when it's no longer
  needed. The work isn't divided and the authorship never moves.

The helper has no seat, so it has no desk of its own, no queue task, no branch, no PR. That is what
makes "it can't take the work over" a property of the design rather than a rule someone has to
enforce.

## Why the mechanism already exists

Four things are built, and reusing them is most of the work:

| Need | What exists | Where |
|---|---|---|
| A worker with no chair | Board agents stand at kiosks, not seats, and are first-class workers | `STATIONS` in `src/shared/layout.ts:146` |
| A real terminal, free | `launch()` gives any worker a PTY, a headless terminal, hooks, status, cost, search, resume | `src/server/workers.ts:1598` |
| Walking an avatar across the floor | `route()` + `deskPoint()`, server-side, sent as a path and animated by every client | `src/shared/nav.ts:335`, `src/server/dog.ts:193` |
| A worker getting out of a seat and walking | The send-home walk already detaches the avatar and walks it out | `src/client/world/leaving.ts:148` |

The dog is the closest template: `DogState { path, speed, face }` on the wire, no per-frame sync, every
browser animates the same numbers. A helper is a dog that carries a laptop.

## The trigger, and why you don't build it <a id="the-trigger"></a>

The office already knows. `failStreak` counts consecutive failed test runs; at `FAILS_TO_DESPAIR`
the worker's action flips to `'failing'` and it puts its head in its hands
(`src/server/workers.ts:1531`, rendered at `src/client/world/character.ts:1371`).

So the office tells you a worker looks stuck, **and you decide**. That is the office's existing
thesis — a human decides — and it has one large benefit: because a worker can never summon a
helper, there is no crutch. A worker that found help too easy would stop attempting hard problems
and start farming them, and the escalation would be invisible. You being the only trigger makes that
structurally impossible.

The flip side is that no scheduler, quota or help-request state is needed. That removes most of what
an autonomous version would have cost.

---

## The build

### Slice 1 — the prompt (S, and prove it here first)

The smallest thing that could possibly work, and the part with all the uncertainty. No 3D, no
walking, no new state: type a prompt into a worker whose `cwd` is another worker's worktree, and
judge whether what it reports is worth anything.

- A prompt in `PROMPTS` (`src/shared/prompts.ts`), beside the other office-written prompts, so it's
  editable in ⚙️ Settings like the rest.
- It needs the host's task, branch, recent tool calls and failing output in its brief. The
  information exists on the `Worker` already; the work is deciding how much to hand over.
- The brief has to say, in the prompt itself: report a finding, don't edit files, don't commit, and
  the worker decides.

**Done when:** you point it at a genuinely stuck worker and its finding saves you time. If the
finding is generic, the idea is weak and we should know that before building chairs.

### Slice 2 — the standing station (S)

A worker with no chair. `DESK_BY_ID` merges `SEATS`, `STATIONS` and `MEETING_SEATS`
(`src/shared/layout.ts:194`); a helper needs a fourth kind, addressed per-desk. Note the guard at
`workers.ts:415`: an occupied desk is refused with a message, so that check has to learn about
helpers.

```
helper:desk-3   →  { id: 'helper:desk-3', host: 'desk-3', standing: true, ... }
```

It has to be resolvable by `DESK_BY_ID` without a chair existing, because `launch()` looks the id up
and the client asks `plan().byId.get(w.deskId)`. Stations already do exactly this: `main.ts:2154`
special-cases their standing offset, and `layout.ts:203` resolves them from `w.plan.stations` — a
per-map list, so a map of your own can place helpers too.

- `spawn()` must allow the host's desk to be occupied when the newcomer is a helper
  (`deskOccupied`, `workers.ts:394`).
- Standing point: the side of the desk, `deskPoint(d, t, s)` with `s` off the chair's 0.9.
- One helper per worker at a time.

### Slice 3 — the walk (S)

Server owns the path, clients animate it, exactly like `DogState`.

```
HelperState { hostId, path: Pt[], speed, face, at, phase: 'walking'|'reading'|'reporting' }
```

`phase` is a cheap state machine and it maps to the body language the office already has:
`walking` (moving), `reading` (stands at the desk, holds up papers — the `read` action every worker
already has), `reporting` (types). No new animation work.

Arrival spawns the worker in the host's worktree, so its `cwd` is the host's branch and it reads
real files. It walks in from the door of the host's own floor — the elevator is a floor-switcher, and
a helper crossing floors to help one worker reads oddly.

### Slice 4 — delivering the finding (S)

One call, and it's the one that keeps authorship where it belongs:

```ts
floor.workers.prompt(hostId, text, helperName)   // same path /office/workers/tell uses
```

The finding goes **to the worker**, not to you. You assigned the helper; the worker receives the
answer. The worker reads it, decides, and acts. Your view is the result, not a second opinion
competing for your attention.

This is the line, stated exactly:

> The helper produces a question, a finding, or a verified fact. It never produces a decision.

### Slice 5 — when it goes home (M)

A helper is not a one-shot delivery. It stands at the desk while the work is finished, and it leaves
when the visit is over — by any of four ways, whichever comes first:

| It goes home when | |
| --- | --- |
| You press **X** | always available, at any time |
| The worker gets itself unstuck | its status returns to `working` and its `failStreak` resets — the same signal that summoned the helper, so the cure dismisses the cure |
| The host opens its PR | `openPr()` resolves; the helper's job was to get the worker to this point |
| You send it home from the Workers panel | same as `X`, for when you've lost track of it |

The middle two are worth spelling out, because they are the same signal used twice. The office
already knows a worker is unstuck — `failStreak` resets on a passing test run
(`src/server/workers.ts:1528`). Reusing it means the helper's departure needs no new concept, and it
means a helper that failed to help quietly leaves rather than standing there for the rest of the
session.

This also means the helper is **live for a long time**, which is the one real cost of the design. See
[Cost](#cost-and-the-guardrail-id-insist-on).

The send-home path already exists and already carries a character out of a seat, so the walk out is
free. The PR stays the host's, the branch stays the host's, and the host's own send-home flow is
untouched.

### Slice 6 — the worker knows (S)

Decided: **the worker is told a helper arrived.** A stranger materialising at your desk and then
telling you what to do is worse than useless — it reads as a hijack, and a worker that thinks its
terminal is being driven by something else may stop trusting its own session.

Three cheap touches, all reusing what exists:

- A toast on the floor: `🆘 Sprocket is helping at Desk 3`. `toastFloor` is already how the office
  announces hires and departures (`src/server/server.ts:283`), though it is a local closure there, so
  this needs either a toast off the `Floor` or the same call reached from wherever the spawn is
  handled.
- A line in the helper's own first prompt, saying who it is and why it's there, so the finding
  arrives with an explanation attached rather than out of nowhere.
- The helper's name on the host's task card, so you can see at a glance that a desk has a helper
  standing at it.

---

## Which agent the helper is

Decided: **any provider, any model** — the same picker the hire window uses, with the office default
preselected. The helper is an ordinary worker in every respect except that it has no desk of its
own, so it inherits the whole provider surface for free: status, hooks, cost, resume, `/office/*`
MCP tools.

Two things follow from that, worth knowing before you pick:

**A second instance of the same model is a fresh context, not a second opinion.** The stuck worker's
window is full of its own wrong assumptions; a helper with a clean one reads the same red test
without that history in the way. That is genuinely valuable. What it is *not* is independent
judgement — same weights, same blind spots. So the same model is the right pick when you want the
work re-read, and a different model is the right pick when you want a judgement re-opened. The
default should probably be a different model from the host's, since that is the case a human can't
already do themselves.

**A helper on a non-Claude provider is uncapped.** Per [agents.md](agents.md) and
`docs/features.md:47`, `--budget` and `--budget-pause` track **Claude Code only**. OpenCode, Codex,
Grok, Muse and DSH spend is metered in the panel but does not stop anything. Since a helper now
lives for a whole task rather than one report, that is a wider hole than it looks, and it's worth
knowing that "any provider" includes the uncapped ones.

## Cost, and the guardrail I'd insist on

A helper is a second live agent on your token, for as long as its host is working. Metered against
`--budget` on Claude, and against nothing at all on the other five providers.

The guardrail that matters is not the budget — it's that **a helper should not outlive its
usefulness**, and the office already knows when that is. `failStreak` resets when the host's tests
pass (`workers.ts:1528`), and that is the moment the helper has done its job. Leaving on that signal
means the common case costs one short visit rather than a whole task.

Two more, both cheap:

- **One helper per worker, ever at a time.** Not a technical limit — a signal. If a worker has had
  two helpers and is still stuck, the problem is the task, and the honest response is `X` and
  re-scope.
- **It counts against `--max-workers`.** Still an open question below, but a helper that doesn't
  count is a way to double the office's real ceiling.

## Verification

Per `CLAUDE.md`: `npm run typecheck`, `npm test`, `npm run build`, plus a headless screenshot of the
helper standing at a desk, since this is visual.

New tests, matching the existing ones:

- `tests/helper.test.ts` — one helper per host, host desk stays occupied, a non-helper still can't
  take a taken desk
- `tests/nav.test.ts` — the standing point is walkable and reachable from the door

## What this deliberately does not do

- **No editing, no commits, no branches, no PRs.** Slice 1's prompt says so; nothing else permits it.
- **No self-service.** A worker cannot ask for a helper. See [The trigger](#the-trigger).
- **No multi-agent chains.** A helper cannot hire a helper. One host, one helper, one hop.
- **No cross-floor.** A helper works on its host's floor, in its host's worktree.
- **The helper doesn't become a colleague.** It has no seat, no sign, no desk of its own, and no
  place in the queue. It is a visitor, and the office's own vocabulary already has a word for
  someone who is leaving: everything else about a worker is a colleague.

---

## Open questions

Answered and folded in above: **when it goes home** (four ways, `X` at any time), **the worker is
told** (toast, an introduction in the helper's first prompt, a chip on the task card), and **which
agent** (any provider, any model, office default preselected).

Still open:

1. **What is the helper for, when you press the key?** One role (diagnose only) or a small picker
   (diagnose / verify / second opinion)? This is the first prompt in slice 1, so it wants an answer
   before that. It is now the only thing standing between the plan and a first commit.
2. **Does the helper count against `--max-workers`?** It's a live agent, so arithmetically yes. But
   the ceiling is a safety valve, and a helper that refuses to spawn because the floor is full is
   useless exactly when you need it.
3. **Can you have two at once, at two different desks?** Deferred on the grounds that one is enough
   to test the idea, but it's a fair question.
4. **Should the helper's own terminal be visible while it stands there?** In 3D, the laptop is small
   and unreadable from a doorway, so seeing its thinking means pressing `E` at the desk. The Workers
   panel and search already reach it. Worth deciding whether the desk card shows a live one-line
   "what it's doing", which is what the worker's own card does.

---

## Slices at a glance

| # | Slice | Size | Needs |
| --- | --- | --- | --- |
| 1 | The prompt alone | S | **question 1** — the role |
| 2 | The standing station (`helper:desk-N`) | S | |
| 3 | The walk, on the dog's path model | S | |
| 4 | Delivering the finding to the worker | S | |
| 5 | When it goes home (four ways) | M | |
| 6 | The worker is told | S | |
| | 3D, seat identity, walk, prompt plumbing | | questions 2–4 |

Slice 1 is first on purpose: it needs no 3D, no walking and no new state, and it answers the only
question that can kill the idea — whether a helper's finding is actually worth the tokens. If that
works, everything after it is plumbing in code that already exists.
