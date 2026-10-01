# Plan: the helper at a desk

Bringing a second agent to a worker who is stuck, so you don't have to.

Status: **built.** Press **U** at a worker to bring one; see
[Features](features.md#bring-a-helper-to-a-worker) for what it does and `src/shared/helper.ts` for
the shape of it. Kept below as the design record: what each slice turned out to need, and the
questions that were settled along the way.

Back to the [README](../README.md) · [Ideas](ideas.md) · [Features](features.md)

---

## The idea

You are walking the floor and a worker is stuck — the office already tells you when, see
[The trigger](#the-trigger). You press a key. A second agent walks over, stands at the side of that
desk holding a laptop, reads what the worker is doing, works out what's wrong, and tells **the
worker**. The worker decides what to do about it. It never writes to the branch, never opens a PR,
and never sits down.

You can open its terminal, read its thinking as it happens, and type into it — the same as any
other worker. It stands at the desk, reads what the worker is doing, tells the worker what it found,
and leaves.

## What this is not

Not mob programming, and not a second pair of hands. The distinction is what keeps it safe:

- **A pair** co-drives one terminal. Two agents, one task, shared authorship. The work is divided.
- **A helper** is a visitor with one job: say something useful, then leave. The work isn't divided
  and the authorship never moves.

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

### Slice 5 — sending it home (S)

A helper is a visit, not a colleague. It walks over, reads, reports, and **leaves as soon as it has
reported** — on its own initiative, not waiting to be dismissed.

That single rule is doing real work. It means:

- **The cost is bounded by the finding, not the task.** A helper that exits after reporting is a
  short visit. One that stayed until the host's PR opened would be a second live agent for the whole
  task, on a token that `--budget` may not even be counting. See
  [Cost](#cost-and-the-one-guardrail-id-insist-on).
- **There is nothing to forget.** No helper can be left standing at a desk holding an open terminal,
  because the walk out is part of finishing the job, not a separate chore.
- **The rule is one condition**, not a policy: reported → gone. Nothing to tune, nothing to get wrong.

**X still works at any moment**, before it has reported, for when you sent the wrong thing or it has
gone off the rails. That's the escape hatch, and it needs no design of its own — `X` already works
on any worker, and a helper is one.

If it turns out in testing that a helper's finding sometimes arrives too early to be useful — the
worker wasn't ready to act on it — the fix is a *better prompt*, not a longer visit. That's the
cheaper mistake to make, and it's the reason to start here.

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
Grok, Muse and DSH spend is metered in the panel but does not stop anything. Worth knowing before you
choose: "any provider" includes the five uncapped ones, and leaving on report is what keeps each
visit short enough to be comfortable.

## Cost, and the one guardrail I'd insist on

A helper is a second live agent on your token, metered against `--budget`. Per
`docs/features.md:47` and [agents.md](agents.md) that budget tracks **Claude Code only** — it cannot
cap OpenCode, Codex, Grok, Muse or DSH. So a helper on any of those five is uncapped, and a helper on
Claude is capped only at the day.

Because a helper **leaves as soon as it has reported**, the exposure is one short visit rather than
the host's whole task, and that is the main reason the rule is worth holding to. It's the difference
between a bounded cost and an open-ended one.

The guardrail I'd still insist on:

- **One helper per worker, ever at a time.** Not a technical limit — a signal. If a worker has had
  two helpers and is still stuck, the problem is the task, and the honest response is `X` and
  re-scope. A third helper is never the answer.

Two notes on the ceiling, both still open below: whether a helper counts against `--max-workers` (a
helper that doesn't count is a way to double the office's real ceiling), and whether one worker can
have helpers at two desks at once (deferred — one is enough to test the idea).

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

Answered and folded in above: **the worker is told** (a toast, an introduction in the helper's own
first prompt, a card saying whose desk it is at), and **which agent** (any provider, any model,
office default preselected).

**When it goes home** is settled by the plan rather than by discussion: it leaves as soon as it has
reported. That was the original design and it is the better one — bounded cost, nothing to forget,
one condition instead of a policy. `X` remains available throughout as the escape hatch. See
[Slice 5](#slice-5--sending-it-home-s).

Decided while building, and worth writing down because they are the ones that shaped the code:

- **The key is U**, at a worker in a worktree of its own. H was taken by Controls and G is the emote
  wheel; U reads as "unstuck", which is what you are asking for.
- **A helper counts against `--max-workers`**, like any live agent. A helper that would not spawn
  because the floor is full would be useless exactly when you want one.
- **Only a worker in a worktree of its own can be helped**, and the office says why when you try
  otherwise. A helper reads the checkout it is pointed at, and that is the floor's shared one if the
  worker has no worktree of its own.
- **The first role is diagnose only**, chosen here rather than asked for, because it is the one where
  being wrong costs a paragraph. The prompt is in ⚙️ Settings, so widening it to a picker later is a
  prompt, not a feature.
- **Agents can ask for helpers too**, with `office-workers helper <worker>` and the `get_helper` MCP
  tool, so a worker that spots one can bring a second opinion without a human in the loop. The rules
  are identical and the finding still goes to the worker being helped, never to the asker.

Still open, and none of them blocking:

1. **Can one worker have helpers at two desks at once?** Deferred: one is enough to test the idea.
2. **Should the helper's desk card show a live one-liner?** It says whose desk it is at and what it is
   doing, which covers the common case. A second line of live output would need the worker's own card
   machinery and is not obviously worth it.

---

## Slices at a glance

| # | Slice | Size | Where it landed |
| --- | --- | --- | --- |
| 1 | The prompt alone | S | `helper.brief` and `helper.report` in `src/shared/prompts.ts` |
| 2 | The standing station (`helper:desk-N`) | S | `helperDesk` in `src/shared/helper.ts`, `helperDesk()` in `workers.ts` |
| 3 | The walk, on the dog's path model | S | `route()` in `nav.ts`, `HelperState`, `client/world/helper.ts` |
| 4 | Delivering the finding to the worker | S | `onHelperUpdate` in `server/floor.ts` |
| 5 | Sending it home — on reporting | S | `Helpers.reported` in `server/helpers.ts` |
| 6 | The worker is told | S | the toast, and the report prompt, in `server/floor.ts` |

Slice 1 came first as planned, and it turned out to be the whole risk: everything after it is wiring
in code that already existed.

### What the build changed about the design

Two things turned out differently than planned, both from reading the code rather than imagining it:

**The helper is a first-class worker, not a special case.** It gets a real `WorkerInfo`, so its
terminal, status, hooks, cost, search and resume all come for free — which is what makes "you can
read its thinking and type into it" true without a line of extra work.

**The floor, not the worker manager, owns the walk.** `Floor` holds the `Helpers` and calls
`workers.sendHelper`, so `sendHome` can refuse to touch a helper's worktree — which is the host's —
and a hosted floor keeps the route to itself. That is why `sendHelper` takes a worker id like `spawn`
does, and why `Helpers` is injected rather than constructed inside the manager.
