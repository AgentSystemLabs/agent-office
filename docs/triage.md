# Issue triage

Back to the [README](../README.md).

With `--triage`, the office classifies every open issue on each floor with [TypeSafe Jev](https://docs.typesafe.ai), labels it on GitHub, and puts the ones an agent can take on by itself on the floor's task queue, with a model picked by the issue's size. The code is in `src/server/triage/`.

## Turning it on

```bash
export JEV_API_KEY=…            # or TYPESAFE_API_KEY, or --jev-key-file <file>
agent-office --triage            # or AGENT_OFFICE_TRIAGE=1
```

| Variable | What it does |
| --- | --- |
| `JEV_API_KEY` / `TYPESAFE_API_KEY` | Your TypeSafe API key. Read once at start; workers never see it. |
| `JEV_MODEL` | `jev-latest` by default. Pin a version (`jev-1.13.0`) once you've tuned thresholds against it. |
| `JEV_API_URL` | Only to point at another endpoint; `https://api.typesafe.ai/v1/systemone` by default. |

Each floor is then in **shadow mode**: issues are classified and the 📌 Issues board shows a badge on each, but nothing is written to GitHub and nothing is queued. Turn on the rest per floor in `<project>/.agent-office/triage.json`:

```json
{
  "writeLabels": true,
  "autoQueue": true,
  "commentOnNeedsDetail": true,
  "dailyCap": 10,
  "description": "The billing service: API, workers and admin UI",
  "areas": [
    { "name": "api", "description": "HTTP handlers and validation, src/api" },
    { "name": "ui", "description": "The admin web app, web/" }
  ],
  "thresholds": { "agentReady": 0.85, "needsHuman": 0.5, "label": 0.6 },
  "sizeMap": {
    "xs": { "provider": "claude", "model": "sonnet", "effort": "low" },
    "s":  { "provider": "claude", "model": "sonnet", "effort": "low" },
    "m":  { "provider": "claude", "model": "sonnet", "effort": "medium" },
    "l":  { "provider": "claude", "model": "opus", "effort": "high" },
    "xl": null
  },
  "authors": []
}
```

Every field is optional; what's shown is the default, except `writeLabels` and `autoQueue`, which start off, and `description` and `areas`, which start empty. The file is read again on each look at the board, so changes take without a restart. `"enabled": false` turns triage off for one floor.

## What it asks

One Jev call per issue, with the repo (name, description, areas, top-level folders), the issue (title, body, author, labels) and its last 10 comments as the state:

| Question | Kind | Used for |
| --- | --- | --- |
| `type` | Choice: bug, feature, docs, chore, question, duplicate-or-spam | `type:*` label |
| `area` | Choice from the floor's `areas` (asked only when there are some) | `area:*` label; one queued task per area at a time |
| `agent_ready` | Noul (yes/no) | The gate for queueing |
| `size` | Choice: xs, s, m, l, xl | `size:*` label and the model |
| `priority` | Choice: p0–p3 | `prio:*` label and queue order |
| `needs_human` | Noul | Never queued |
| `cross_repo` | Noul | A human picks the floors |

## What it does

The first rule that matches wins:

1. `needs_human` ≥ 0.5: `triage:needs-human`, never queued, not even by **Queue anyway**.
2. A question, duplicate or spam: labelled only.
3. `agent_ready` under 0.85: `triage:needs-detail`, and one comment asking for what's missing (the `🏷️ Triage: asking for detail` prompt in ⚙️ Settings).
4. `cross_repo`: `triage:cross-repo`, and a toast.
5. Size xl (or any size whose `sizeMap` entry is null): `triage:split-me`.
6. Otherwise `triage:queued`, onto the queue with the size's worker, unless a gate stops it, in which case it's `triage:ready`. The gates:
   - an answer was too unsure to label,
   - the author isn't a collaborator with write access (or listed in `authors`),
   - `autoQueue` is off,
   - the daily cap is reached.

Any answer whose probability is under 0.6 isn't written as a label; the issue gets `triage:low-confidence` instead.

Triage's queued tasks wait by priority (p0 first, a task added by hand counts as p2), and two tasks in the same area don't run at once.

## You stay in charge

- **Change a label by hand** (any `type:`, `area:`, `size:`, `prio:` or `triage:` one) and triage leaves that issue alone. So does an issue that already had such labels when triage first saw it.
- **🏷️ Re-classify** in the issue window classifies it again and takes it back.
- **📋 Queue anyway** queues it whatever the rules said, unless it needs a human.
- An issue is classified again only when its title, body, comments or other labels change, never because triage labelled or commented on it.

## Checking it's right

Before turning `autoQueue` on, hand-label 30 to 50 past issues in `<project>/.agent-office/triage-eval.json`:

```json
[{ "number": 12, "type": "bug", "size": "s", "agentReady": true }]
```

and, with shadow mode having classified them, run:

```bash
npx tsx scripts/triage-eval.ts <project>
```

It prints how often type and size agree with yours, and the precision of `agent_ready`. Keep auto-queue off until precision is high (90% or better): a false yes costs a whole agent run.

Every decision is a line in `<project>/.agent-office/triage.log`, with its probabilities. The queue board shows the day's count against the cap and Jev's spend (input tokens at $0.042 per million).

## Files

| File | What's in it |
| --- | --- |
| `<project>/.agent-office/triage.json` | The floor's settings (above) |
| `<project>/.agent-office/triage-cache.json` | Each open issue's answers and decision, and the daily counts |
| `<project>/.agent-office/triage.log` | One JSON line per decision |
