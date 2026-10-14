# Ambient Dunder Mifflin coworkers

Back to the [README](../README.md) · [Features](features.md)

The 3D office includes an independent background cast based on the supplied *Ambient NPC & Workplace Character Bible*. The staff work, chat, eat lunch, gather and go home without asking you to participate. They do not consume worker seats or start agent sessions. There are no quests, attendance requirements, notifications or camera takeovers.

## Cast and era

The fixed Season 6 ensemble includes Michael, Dwight, Jim, Pam, Ryan, Kelly, Angela, Kevin, Oscar, Stanley, Phyllis, Meredith, Creed, Andy, Toby and Erin. Darryl comes upstairs for shipments and breaks. Holly visits from Nashua; David Wallace visits from corporate. Pam works in administration and Erin handles reception. Jim and Pam are married; Dwight and Angela's private conversations do not disclose their history to the rest of the branch. The visitor beats are original simulation scenes, not claims about a particular episode.

The bible's historical and later-era supporting cast (Jan, Karen, Roy, Jo, Gabe, Packer, Bob, Hank, Mose, the warehouse ensemble and Season 7–9 additions) is reference material for future era-specific scenes; those characters are not spawned in this ensemble. The component uses the existing cartoon character rigs, distinct clothing colors, hairstyles, nameplates and original dialogue rather than copied television scripts or audio.

## Use it

The cast works in its own [Scranton replica extension](scranton-extension.md). Walk through **Dunder Mifflin →** on the original office's east wall, between the Services board and TV, and follow the hallway north, then left into the annex. Reception, the bullpen, accounting, Michael's office, the conference room, kitchen and break room are all connected. These are dedicated character workstations, separate from the coding-agent desks.

Click the **Dunder Mifflin** clock near the top left to open the coworker directory, or look at a coworker and press **E**. Say hello, ask about their day, or use their optional work scratchpad. **✕** and **Esc** close the window through the office's standard focus handling and restore mouse-look.

**Show coworkers** hides or reveals the cast. **Quiet work** hides conversation bubbles while keeping staff visible. Both choices are saved in this browser. Ambient dialogue does not enter the shared chat or generate sound. Characters appear only on the regular office floor, not on the roof, in the garage, during elevator travel or on custom maps. The directory remains available during their off shift, without summoning absent staff.

**Pam and Erin can organize notes into a task checklist.** Your notes are private to this browser and floor and are saved as you type. Each other coworker can prepare a role-appropriate work brief for you to copy to a connected worker. This is a local preparation tool, not an AI answer to the underlying request. The component cannot send messages, create reminders, schedule appointments, modify spreadsheets or act on external accounts. It explicitly reports that no external action occurred. If browser storage is blocked, the window tells you to copy your notes before closing. Clearing browser storage removes the notes and preferences.

Helping pauses that present character's movement locally until you close the window or select another coworker. Everyone else continues their day. No cast member is hired as a coding agent, and no model calls or additional credentials are needed.

## Independent working day

The displayed clock runs a fictional 8:30–17:30 workday in **40 real minutes**. Arrivals are staggered; most time is ordinary work, with staggered lunches and departures. Stanley leaves at 17:00. The branch has a short after-hours interval before the next simulated day. These times are simulation choices, not canonical dates or the user's local clock.

Scenes occupy part of a two-minute slot, leaving quiet intervals between conversations. Staff gather using the office's existing navigation grid and disperse back to their routines. Scenes cover reception handoffs, client calls, Jim/Dwight pranks, accounting checks, Kelly/Ryan misunderstandings, party planning, supplier orders, presentations, HR forms, a sales briefing and private conversations. Pretzel Day and a Dundies rehearsal occur on different virtual days, with most slots reserved for ordinary life. No fictional birthday date is labeled canon.

Personalities also choose visible actions. Each exchange has a gathering interval, six-second speaking/reaction turns, a coordinated closing moment and a pause before everyone returns to work. Speakers and listeners turn toward each other once both arrive. Speech ends before the listener's reply gesture: Jim facepalms at Dwight's investigation; Dwight answers Jim by pointing; Pam and Erin acknowledge each other; Michael and Toby react awkwardly to each other. Stanley withholds applause during ordinary meetings but acknowledges Pretzel Day. The Dundies participants clap together, and Andy dances at the end of musical conversations while his coworkers respond in their own ways. These are original procedural sequences using the office's cartoon rigs, not imported animations or assets from the inspiration games.

Use the existing player **Wave** emote within 3.5 meters of an idle coworker to get a visible acknowledgment. The nearest available coworker turns to you and waves or gives a thumbs up; Stanley simply looks over. There is a ten-second acknowledgment cooldown, and coworkers in an exchange, walking or helping you keep their attention on that activity. This acknowledgment is local to your browser. Quiet work hides dialogue while retaining body gestures, and hiding coworkers hides all of their performance.

All gesture phases come from the same scheduled clock, so a late observer joins the current pose rather than restarting the gesture. Walking or helping takes priority over gestures. A speaker waits for a stationary, present conversation partner before displaying their bubble or gesture; missed beats are skipped rather than talking at an absent or moving partner. Shared timing does not make client-local movement server authoritative, and out-of-sync device clocks can still show different moments.

The schedule is a pure function of wall-clock time and floor ID. Browsers with synchronized clocks on the same floor see the same scheduled conversations; movement and assistance are local, not server-authoritative multiplayer NPC positions. Reloading, hiding the cast or leaving a floor does not restart its schedule. The directory's **Around the branch** section reconstructs the last three completed scene outcomes, including the previous virtual day. This is bounded deterministic continuity, not open-ended character memory or a persistent narrative service.

## Implementation and checks

The module is `src/client/features/ambient-office/`: `cast.ts` describes characters; `scenes.ts` contains original group dialogue; `simulation.ts` schedules independent routines and outcomes; `choreography.ts` chooses relationship reactions and coordinated phases; `performance.ts` seeks the existing rig to the current gesture; `world.ts` animates the existing rigs and navigation; `ui.ts` and `notes.ts` implement optional conversation and local assistance. A space dependency from `features/scranton/` relocates routines into the replica and seats staff at their assigned workstations. The feature registers world ticks, moving usables and the `ambientnpc` interaction. No protocol, server or core-store changes are needed.

`tests/ambient-office.test.ts` verifies deterministic schedules, offscreen continuity, autonomous group events, departures, rare rituals, cast identities and walkable paths, and meaningful checklist and handoff behavior. Validate changes with `npm run typecheck`, `npm test`, `npm run build` and a headless browser screenshot of the cast and directory.
