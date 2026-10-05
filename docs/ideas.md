# Ideas

Ten things the office could grow, and why each one is worth the space. These are proposals, not plans:
nothing here is built, and nothing is promised. They're written against what the office already has,
so each says what it leans on.

Back to the [README](../README.md).

---

## 1. Shift handover, and the office's own lore

Every worker leaves knowing something nobody else does. *This test is flaky on a timer, re-run it.*
*That import is a cycle, don't touch it.* *The deploy needs the flag set first.* Today all of that
dies with the session.

Give a worker one button before it goes home — **📝 Write a handover** — and it writes what it
learned into `.agent-office/lore/`, in its own words. The desk's next worker is handed those notes
when it's hired, the way it already gets a task brief, and there's a **lore shelf** in the office:
every note as a pinned slip of paper, searchable, with the worker who wrote it and what it merged.

The test: hire a worker on a repo you've worked on for a year, point it at a bug, and have it find
the trap in the first five minutes. The lore shelf is also the only part of the office that gets
*smarter* the longer you leave it on, which nothing else here does.

## 2. Standup, on a clock

The meeting room can already call a pattern, seat 2–5 workers, bound the rounds and tokens, and open
a PR on the output file. All it's missing is a reason to call one.

Add **🔁 Standup** under ⚙️: a time, a pattern and an output path. At that time the office seats every
working worker at the table, each says what it did, what it's on and what's blocking it, and the
head of the table writes `docs/standups/2026-10-01.md`. The PR button that already exists opens it.
Skip it when nobody's working and nobody is told.

The value is the *record*. Two standups a week is a fortnight of "the auth change broke the staging
deploy" in git, written by the people who were there, instead of in someone's memory.

## 3. Scrub back through the day

The office is event-sourced already, in a sense: the chat log, every worker's last 3,000 lines, the
history of what was hired and sent home, and the basketball's shot replay (each browser flies the same
ball from the same numbers). Nobody has put those together in time.

Add **⏪ Replay**: the floor keeps a tick of every worker's state — seat, status, task card, PR — and
a timeline under the top bar lets you drag the whole floor back through the working day. Workers
walk their real route, the gong rings again, confetti falls twice. It's a debug tool, a demo tool and
a genuinely strange thing to watch.

Cheap, because the hard half already exists. The ceiling is that a day of a busy floor is a lot of
state, so the tick wants a stride — a sample every few seconds, not every frame.

## 4. The plants are the build's pulse

The greenery is the most-loved thing in the office and it's currently pure decoration. Wire it to the
floor's own CI and it stops being that.

A failed check on the floor's default branch droops the ficus. A red PR on the board turns the desk's
pothos pale. A merge waters everything back up, and the balcony window boxes bloom when the floor's
queue empties. Same toon materials, a per-plant health value the server sends, one lerp in the update.

The point isn't the decoration, it's that a person walking past a screen of red PRs *feels* it before
they read it. A codebase with a sick plant on it is a conversation starter.

## 5. The spend barometer

There's a monitor on the west wall showing the machine, and a per-worker cost in the Workers panel.
Both are read by opening a window. Weather the building instead.

Put a brass barometer by the elevator: **pressure is the day's spend against `--budget`**. Under half
it's a clear day. Approaching the line the glass drops, the needle swings, the wind picks up. Over
the line it storms, and `--budget-pause` lands as a real weather front, since that's exactly what it
does. An admin can set a monthly budget and watch a month pass on a dial.

Cheap, and it makes an invisible cost legible at a glance from across the room — the same trick as
the energy and stress meters, applied to the company instead of the person.

## 6. On-call, a pager, and Game Day

Every team has the thing nobody wants to build: the rotation, the alert, and the drill that proves the
alert works.

An **on-call rota** on a board by the elevator — a name, a week, a coloured hat on the character while
it's their turn. When a check goes red on the default branch, or a PR that's been approved stops
passing, the office pages whoever's on call: a sound, a toast, a **🔔 Pager** panel, the Slack webhook
that's already there. And a **🚨 Game Day** button for admins that deliberately breaks the floor —
merges a bad commit, kills a service, fakes a hung worker — so the rota gets tested on purpose, by
people who agreed to it.

This is the idea most likely to earn its keep on a real team, because the failure mode it rehearses
is the one that costs the most.

## 7. An atrium, so the building is one building

You only see and hear your own floor. That's a clean rule, and it's why the building still feels like
a corridor of separate rooms rather than a place people work.

Put a glass void up the middle of the ground floor — the elevator opens onto it, and you can see every
floor's room at once, from outside, the way you'd see into a doll's house. Workers still can't hear
each other and still can't type into each other's terminals; what changes is that you *see* the other
projects breathing. A floor with nine workers and a storm of green diffs looks like a different
building from a floor where one is stuck on a permission prompt, and that should be visible from the
lobby.

It's also the one idea here that changes the building's silhouette, so it wants the tower and the
exterior to agree — which is most of the work.

## 8. Two workers, one desk

Every worker works alone, even when two are on the same problem. The meeting room does the opposite:
five workers, one question, and none of them typing.

Add a **second chair at a desk**, hired into with **Mob** instead of a solo task. Two workers share
the one terminal: one drives, one navigates, and the role swaps on a timer or on **⇄ Swap**. Both
cards show who's holding the keys, and the person not driving gets the navigation prompt that maps
onto what the driver is actually looking at. When it merges, both are named on the PR and on the gong.

Pairing is the cheapest known way to get a second opinion on a change, and this puts it where the
terminal already is, with no new room and no new pattern to learn.

## 9. Careers, so a worker has a history

A worker is a name, a colour and a status. Give it a length of service and the office gets a
dimension it has no other way to get.

Workers accrue **tenure** from the hours they've actually worked, which the office already tracks
(`workedMs`) and already wears as the castle's greying beards. That becomes a badge: **Intern**,
**Junior**,**Senior**, and past a hundred merged PRs, **Staff** — with the badge on the name tag, a
title on the task card, and a **wall of plaques** by the elevator for the ones that merged something
big. A senior worker offered a PR from someone junior gets **Offer review** in the PR window, and can
accept it as a review with a lens, the way the review panel's reviewers already do.

The risk is gamifying the humans, so it should read as the building's memory rather than a leaderboard:
plaques for what shipped, nothing for speed, and no score for being online.

## 10. Photo mode, and the postcard

An office this carefully dressed deserves to be photographed, and right now the only way to keep an
image is to screenshot the HUD with it.

**📷 Photo mode** hides every panel, frees the camera from the character, and adds a frame: pick a
desk, a floor, the rooftop or the street, set the time of day and the weather, and the office frames
it. Then a **postcard**: the shot with a stamped footer — the project, the floor, the date, and the
floor's numbers for that day, like *14 workers · 9 PRs merged · 1 waiting*. It goes to your downloads,
and posting one is the cheapest advertisement this project will ever get.

Cheap, and it makes everyone a photographer of the thing, which is how the castle and Night City got
their share of attention in the first place.

---

## What these have in common

They're mostly small on the server and large in the room. The office already knows almost everything
these need — the workers' tenure, the costs, the CI, the events, the plants, the weather, the meeting
patterns, the PR reviews. What's missing is a surface, and in every case the surface is the payoff.

If you want one, [Standup](#2-standup-on-a-clock) is the best value for the least work: the meeting
room already does the hard part, and it leaves a git trail.
[On-call](#6-on-call-a-pager-and-game-day) is the one that would most change how a real team uses the
office on a Tuesday.
