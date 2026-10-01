# Plan: the helper at a desk

Bringing a second agent to a worker who is stuck, so you don't have to.

Status: **proposal.** Nothing built. Open questions at the bottom — the first four change the
design, so they're worth answering before any code.

Back to the [README](../README.md) · [Ideas](ideas.md) · [Features](features.md)

---

## The idea

You are walking the floor and a worker is stuck — the office already tells you when, see
[The trigger](#the-trigger). You press a key. A second agent walks over, stands at the side of that
desk holding a laptop, reads what the worker is doing, works out what's wrong, and tells **the
worker**. The worker decides what to do about it. It never writes to the branch, never opens a PR,
and never sits down.

You can open its terminal, read its thinking as it happens, and type into it — the same as any
other worker.

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

A helper that finishes has nowhere to be dismissed to, so: it leaves once it has reported, on its own
initiated. The send-home path already exists and already carries a character out of a seat. The PR
stays the host's, the branch stays the host's, and the host keeps its own send-home flow intact.

---

## Cost, and the one guardrail I'd insist on

A helper is a second live agent on your token, metered against `--budget`. Per
`docs/features.md:47` that budget tracks **Claude Code only** — it cannot cap OpenCode, Codex, Grok,
Muse or DSH. So a helper on any of those five is uncapped, and a helper you forget about is an
uncapped agent holding a terminal open.

Two cheap guards:

- **One helper per worker, ever at a time.** Not a technical limit — a signal. If a worker has had
  two helpers and is still stuck, the problem is the task, and the honest response is `X` and
  re-scope.
- **It leaves when it's done**, so there's nothing to forget.

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
- **Not "which helper do I need".** The roles from an earlier pass — repeating itself / confidently
  wrong / context exhausted / missing a fact — are a guess at what stuck means. You assign at the
  desk while watching, so you know better than any list. The first version is one role, and the
  prompt is editable.

---

## Open questions

The first four change the design; the rest can be answered while building.

1. **What is the helper for, when you press the key?** One role (diagnose only) or a small picker
   (diagnose / verify / second opinion)? This is the first prompt in slice 1, so it wants an answer
   before that.
2. **Who leaves, and when?** It goes home the moment it reports, or stays until you press `X`? The
   walk out is a good ending, but you may want to interrogate its terminal first.
3. **Does the host's worker know?** Does the struggling worker get told a helper arrived (a toast, a
   card), or does it just receive the finding with no explanation? Telling it costs a prompt; not
   telling it leaves a strange stranger at its desk.
4. **Same model or different?** Your original question. Note the finding: a second instance of the
   *same* model is valuable for **independence of context** (the stuck worker's window is full of its
   own wrong assumptions), not for independence of judgement. So the same model is genuinely useful
   if the helper is given a fresh *reading* task — but a different model is better if you want a
   real second opinion on a judgement.
5. **Does the helper count against `--max-workers`?** It's a live agent, so arithmetically yes. But
   the ceiling is a safety valve, and a helper that refuses to spawn because the floor is full is
   useless exactly when you need it.
6. **Can you have two at once, at two different desks?** Deferred on the grounds that one is enough
   to test the idea, but it's a fair question.
