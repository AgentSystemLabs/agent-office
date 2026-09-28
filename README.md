# 🏢 Agent Office

A cartoon 3D office your team walks around in together. Sit a Claude Code, OpenCode or Codex worker at any empty desk, watch its terminal on the laptop in front of it, and jump into that terminal with everyone else. Issues and pull requests hang on cork boards on the wall. You can talk over voice and put your screen on the lounge TV.

Every project is **a floor of the building**. Ride the elevator, pick one of your GitHub repositories, and the office clones it and opens a new floor for it, painted its own colors. Every worker, terminal, board and queue on a floor works in that project's checkout.

```
agent-office
```

## What's inside

- **A floor per project.** The first time the office runs you start inside the elevator, and it asks for your first project: pick one of the repositories your `gh` login can see (or type `owner/name`) and the office clones it into `~/agent-office/<owner>/<repo>`. To add another project, or go to one, walk into the elevator on the north wall and press **E**. Or click the project name in the top-left corner for the list of floors: pick one and you're there in a blink, standing on the same spot in the office. Each floor has its own desks, workers, issues and PR boards, task queue, services and pictures, and its own wall and floor colors, so you always know where you are. You only see and hear the people on your floor. The elevator panel shows how many workers are busy or waiting on someone on each floor, and you get a heads-up when a worker on another floor starts waiting. An admin can take a project off the building with the **🗑** beside its floor in the elevator: its workers stop, and everyone on it rides the elevator to another floor. Nothing is deleted. The checkout stays on disk with its workers, queue and pictures, and adding the same repository again moves back into it (as long as the workspace folder hasn't moved since). The project the office was started in (`agent-office <dir>`) can't be taken off.
- **Walk around.** Use WASD, Space to jump, and drag the mouse to orbit the camera. Everyone in the office sees everyone else move in real time.
- **A quiet screen.** The office stays in view: the top bar holds just the floor you're on, **🤖 Workers** and the **☰** menu (or **Tab**). The menu opens every window (issues, PRs, the queue, services, the whiteboard, search, voice, screen sharing, settings) and lists what can show on screen: the workers, who's in the office, spend, Claude limits, the chat and the floor details. Turn each one on or off there, or hide a panel with its **✕**. Pin anything you use a lot to the top bar. The choices are kept in your browser. Chat lines fade after a few seconds; hover the chat or press **T** to read back. What needs you shows up on the top bar by itself: the workers waiting on someone (click to go to them, like **N**), the mute button while you're in voice, **Sharing** while you share your screen, and **⬆️ Update** when there's a new version.
- **Coffee.** Press **E** at the coffee machine in the kitchen for a mug and a minute of quicker walking and higher jumps. A little meter under the project name shows how much buzz is left. Drink a third cup before the last one wears off and you get the jitters for a few seconds.
- **Boss office.** Stairs along the back wall climb to a glass-walled office on the loft in the corner. From up there you can look down over every desk and watch your workers go.
- **Ladder and fire poles.** The floors are stacked like a real building, with a ceiling over each. A ladder up the west wall goes through trapdoors in the ceiling and the floor: press **E** to grab it, **W** / **S** to climb, and **E** (or **Space**) to get off. Climb past the ceiling and you come up through the floor of the floor above. To go down in a hurry, walk into the hole round the fire pole (or press **E** at it). You slide down it spinning and come out of the ceiling below. The pole runs the whole way down the building, so a slide takes you one floor down and swings you off beside its hole there, ready to go again. On the bottom floor you land on a mat and a firehouse bell rings, and pressing **E** at the pole there gives you a twirl.
- **Upstairs, over the garage.** The office is the second floor. Its windows are real glass, so you can look out over the street, the trees and the neighbours. Walk out the EXIT door in the west wall and down the stairs to the street. Underneath is an open garage full of Lambos and Ferraris, and you can jump up onto them.
- **A tower that grows with your projects.** Every floor is a storey of the same building, so from outside it's as tall as you have projects: add enough of them and it's a skyscraper, a balcony off every floor, windows lit here and there at night and a cornice round the top. Up on a higher floor the street is that many storeys further down. Only the bottom floor has the EXIT door and the stairs down; the floors above it have wall there, so take the elevator down to leave.
- **Day and night, and weather.** Outside the windows it's the office's own time of day: the sun comes up and goes down with the clock of the machine running it, and at night the street lamps, the balcony's string lights and the windows across the street come on while the office lights warm up. The weather comes and goes by itself (sun, clouds, rain, thunderstorms, fog, and snow in winter), with raindrops on the glass, wet streets and snow settling outside. Start the office with `--city Berlin` and the sky follows that city's sunrise, sunset and live forecast instead. Everyone sees the same sky, and **⚙️** shows what it's doing.
- **Halloween and Christmas.** Under **⚙️** → *Holiday theme*, anyone can dress the whole building up, for everyone on every floor. For Halloween the workers turn into shambling zombies with stitched grins and bandages, your first-person hands become an undead warlock's, bony and clawed with green witch-fire curling round them, everyone wears a crooked warlock's hat, and the dog gets bat wings and a witch's hat. The sky goes creepy, purple overhead and blood orange at the horizon, with a big harvest moon, bats crossing it and circling the building, and the odd far-off flash. Jack-o'-lanterns glow everywhere: on every desk, the window sills, the counter, the balcony rail and down the street, with gravestones on the lawn and cobwebs in the corners. For Christmas the workers are elves, your hands are in mittens, everyone wears a Santa hat, the dog is Rudolph, the potted plants turn into little decorated trees with presents under them, and it snows outside, onto a big lit tree and a few snowmen out front. *By the calendar* (the default) puts up Halloween through October and Christmas through December, by the office's clock.
- **Smoke breaks.** Glass doors on the south wall slide open onto a balcony with string lights, a bench and a bistro table. Press **E** at the ashtray to light up. Everyone sees you puffing away until you stub it out or step back inside.
- **Golf off the balcony.** Next to the ashtray there's a tee: a square of turf, a ball on a tee and a bag of clubs. Across the street, where the neighbours leave a gap, a fairway runs up to a green with a flag on it, 43 m out and a storey down (further down from the floors above). Press **E** at the tee to step up with a club. The camera drops down behind the ball. The mouse or **A**/**D** aims, **W**/**S** set the loft (too flat and it hits the railing), and holding **Space** takes the club back while the power meter runs up and down: let go to hit. The camera follows the ball out and down, and a label says where it stopped and how far from the pin. Everyone on your floor sees you swing and your ball fly, landing in the same spot. Hole one and the green goes up in confetti. Your closest shot and your holes in one are kept in your browser. **E** puts the club back.
- **Take a seat.** Press **E** at the lounge couch, a beanbag, the balcony bench or a stool at its bistro table, or the couch or the boss's chair up in the boss office to sit down. Walk off, jump or press **E** again to get up. Everyone on your floor sees you sitting. Sit on the couch facing the TV while someone's sharing their screen and it opens full screen for you.
- **Minesweeper on the boss's monitor.** In the boss's chair, **E** plays Minesweeper on the monitor: the camera moves in close and the board sits right on the screen. Click to dig, right-click (or Shift-click) to flag, and click a number to dig around it once its mines are flagged. The first click is never a mine. **Stop playing** leaves your game up on the monitor, with its clock paused, until you come back. Walk off to get up.
- **Pick your character.** The first time you join, a character select screen lets you choose your skin tone, hair style, hair color and shirt, with a spinning preview. Change it any time from **⚙️** or by clicking your name under *In the office* (turn on **👥 People** in the **☰** menu).
- **Hire workers.** Walk up to an empty desk and press **E** to choose Claude Code, OpenCode or Codex, or press **P** to write a task first. A little worker sits down, a laptop opens, and the agent's live screen appears on it. Choose the agent for each queue task too.
- **Bean bags for the overflow.** There are 16 desks. Once they're all taken, a bean bag comes out on the floor with a low lap desk in front of it. Hire a worker there the same way as at a desk, and the next bean bag comes out, up to 12 around the room. The task queue seats workers on them too. A bean bag stays out while a worker sits on it, and the empty one goes away again as soon as a desk frees up.
- **Shared shells.** Press **B** at an empty desk to open a plain login shell for dev servers, git or tests. It's shared the same way as a Claude terminal.
- **Isolated branches.** When you hire with a task, you can tick *own git worktree*. The worker then gets its own `office/<name>` branch under `.agent-office/worktrees/`, so parallel workers never share a checkout. When you send that worker home you choose whether to keep the worktree and branch, delete the worktree, or delete both, and the office warns you first about uncommitted changes or commits no remote has. `agent-office prune` clears out whatever was kept, once it is safe.
- **One-click PRs.** When a worktree worker is done, press **O** at its desk. The office pushes the branch and opens a pull request with a title and body drafted from the task (work handed over from the issues board gets a `Closes #n`). The PR shows up on the PR board right away, tagged with the worker's desk, and **Go to desk** takes you there. Press **O** again to see the PR.
- **Shared terminals.** Press **E** at an occupied desk to open the real terminal (a PTY, over WebSockets). Several people can type into the same session at once, and anyone who joins late gets the full scrollback. The terminal's header shows a face for everyone who has it open, and a line like *Sam is typing…* while someone else types, so you don't talk over each other.
- **See what teammates are up to.** A line under each person's name tag says what they have open (*💻 in Pixel's terminal*, *🔀 reading PR #12*, *📋 at the issues board*) or where they are (*🌇 on the balcony*, *👔 in the boss's office*, *🛋️ on the couch*). The same line shows under their name in the sidebar. Click someone there to walk over to them, riding the elevator first if they're on another floor. Any key of your own takes over.
- **Changes at the desk.** Press **C** at an occupied desk (or click **🌿 Changes** in its terminal) to see what the worker changed: the changed files and their diff against the branch the office was opened on, refreshed every couple of seconds while it works. From there you can commit, discard, or push the branch and open a pull request.
- **Live status.** Claude Code and Codex hooks plus an OpenCode plugin drive each worker's status: *working*, *needs input* or *done*. When a worker needs a human or has finished, it jumps up and down and you hear a ding. Its antenna bulb shows the status from across the room.
- **Workers act out what they're doing.** A working worker acts out its latest tool call, so you can tell what it's doing from across the room without reading its card. Reading files, it holds up a stack of papers and flips through them. Editing, it hunches over the keys and types flat out. Running tests or a build, it leans back with its hands behind its head. Searching or fetching the web, a globe spins beside its laptop. When its tests or build fail twice in a row, it puts its head in its hands. Waiting on you, it jumps for a couple of seconds, then crosses its arms and taps its foot. When it finishes, it does a little spin and a puff of confetti goes up. Claude Code hooks tell a shell command that runs tests from one that only reads, and they report failures. Codex and OpenCode report only the tool's name, so their shell commands are acted out as plain typing.
- **Next worker that needs you.** Press **N** to go straight to the worker that has waited longest on someone (it needs input, or it's done and nobody has looked), standing behind it and looking at its laptop. Press **N** again for the next one, oldest first, and after the last you start over. A pin at the edge of the screen points the way to each waiting worker you can't see, red for *needs input* and green for *done*, and the top bar counts them (`🙋 2 waiting · ✅ 1 done`; click it to do the same as **N**). With nobody waiting on your floor, **N** tells you which floor has someone.
- **Notifications.** You don't have to be in the office tab. The tab title counts the workers waiting on someone, like `(2) my-project · Agent Office`. Allow desktop notifications (the office asks when you first hire a worker, or turn them on under **⚙️**) and a worker that needs input or finishes while you're in another tab or app pops one up. Click it to jump straight to that worker's terminal. For the whole team, paste a Slack or Discord incoming webhook under **⚙️** → *Team notifications* (or start with `--webhook <url>`), and the office posts to that channel when a worker has needed input or been done for a few seconds with nobody at its terminal.
- **Task cards.** A card over each worker's head names what it's on ("Fix Login Redirect") and says in one line what it's doing right now. For Claude workers, Claude Haiku writes it from prompts and recent tools through the `claude` CLI. OpenCode and Codex use local task summaries and never invoke Claude to name their tasks.
- **Survives restarts.** Workers are saved to disk with their agent choice and session ID, and their terminals run in a small process of their own. When the server restarts (a dev-server reload, a `kill` of its process), the agents keep working through it, and the new server picks every terminal back up, scrollback and all. Open terminals reconnect by themselves. Ctrl+C stops the workers, and so does restarting the systemd service, which stops everything in it; the next start wakes them back up in their sessions, and **R** resumes the Claude Code, OpenCode or Codex session of one that exited. The chat and each worker's last 3,000 lines of terminal are kept too, so after a restart (or a crash) you can still scroll back through what the workers printed and what everyone said.
- **Search.** Press **/** (or **🔎 Search** in the **☰** menu) to search the chat and every worker's terminal at once, including what they showed before the office restarted. Click a terminal line to open that terminal scrolled to it, with the line lit up.
- **Cost per worker.** Claude Code workers show tracked session cost and tokens. OpenCode workers show tokens and model/provider-reported cost estimates, including child-session usage, with a cache/reasoning breakdown in tooltips. These estimates are not billing; missing cost is shown as unavailable. Codex workers show the root session’s recorded tokens, including cache and reasoning breakdowns; cost and API-call count are unavailable. Today's and all-time totals, `--budget` warnings and `--budget-pause` use tracked Claude Code spend only; they cannot cap OpenCode or Codex spending. Once the tracked budget is spent, the hiring pause applies to all new workers. OpenCode and Codex session snapshots and Claude totals survive restarts. Current-desk totals disappear when their workers are sent home.
- **Machine monitor and worker limit.** A monitor on the west wall, between the windows, shows how busy the office's machine is: CPU and memory right now, the last five minutes of each, and how many workers the office runs. Start with `--max-workers <n>`, or have an admin set a limit under **⚙️** → *Worker limit*, and the office runs at most that many workers at once across every floor (shells and board agents count too). Hiring past it is refused with a message saying why, and the task queue waits for room instead of failing its tasks. In the office, the limit can be lowered but never raised past `--max-workers`. When memory is 90% used, or the CPU has been 90% busy for half a minute, the monitor says the machine is under pressure, the hint at an empty desk says so, and the hire dialog warns you before you hire.
- **Plan limits.** Turn on **⏳ Claude limits** in the **☰** menu and a meter shows how much of your Claude plan's 5-hour session and week is used, plus any per-model weekly limit (like Fable's), and when each one starts over. These are the same numbers Claude Code's `/usage` shows for the account the Claude workers run on, on every floor. While anyone is in the office, it asks `claude` for them every two minutes, which starts no conversation and costs nothing. Click the meter to read it again. It stays hidden when Claude runs on an API key instead of a plan, and it doesn't count OpenCode or Codex.
- **Issues board.** A tack board shows GitHub issues in *Open*, *In progress* and *Closed*. Click a column's header to filter it by label: pick one or more and the column shows only the cards with any of them. Your filters stay put for each floor, in your browser. Click an issue to read it and its comments, or add a comment of your own (it posts as the account `gh` is signed in as on the server; the window names it), then choose **Hand to a worker** to seat a worker with a ready-made prompt, or **Add to queue**. Or take its card straight off the board, without opening it: point at the note (the crosshair in first person, the mouse in third) and press **E** or click (**O** opens it instead). **✋ Pick it up** in an issue's window does the same. You carry the card across the office in your hands, where everyone on the floor sees it (and sees it missing from the board): press **E** at an empty desk to hire a worker for it, at a worker's desk to hand it to that worker, or at the task queue to queue it. A worker that takes the card gets the issue assigned on GitHub, so it moves to *In progress*. **Q** puts the card back. **Close issue…** closes it as completed or not planned, with an optional comment, and takes it off the queue if it was waiting there. **🏷️ Edit** next to an issue's labels (**Add labels** when it has none), or the 🏷️ that shows when you hover its card on the board, picks its labels from the repo's own: tick them on and off, filter by typing (**Enter** ticks the first match), then **Save labels**. An *in progress* (or *doing*, *wip*) label moves the issue to *In progress*.
- **PR board.** A second tack board shows pull requests in *Draft*, *In review*, *Approved*, *Merged* and *Closed*, with CI status and diff size. Its column headers filter by label too. Click a PR to read its description, comments, reviews and checks, and comment on it. **Files changed** shows the diff, with the files listed on the left as a folder tree or a flat list, and review comments under the lines they're on. Tick a file **Reviewed** (or press **V**; **J**/**K** step through files) and it folds away. Your ticks are kept in your browser, and a file you ticked that changes again is flagged. **Merge…** squashes, merges or rebases it, and can have GitHub merge it once its checks pass. **Close PR…** closes it without merging, with an optional comment, and can delete its branch. **Review** and **Fix comments & merge** hand the PR to a worker; the second one addresses the review comments, gets the checks green and merges. When the PR conflicts with its base, that button becomes **Fix conflicts & merge**: a new worker is picked by default, merges the base in, resolves the conflicts and merges. Its labels change the same way as an issue's: **🏷️ Edit** in the PR window, or the 🏷️ on its card.
- **The merge gong.** A brass gong stands by the elevator, on the far side from the PR board. When a pull request merges, it rings for everyone on the floor, confetti rains down from the ceiling all over the floor (the loft too) and bursts over the desk the PR came from (with no worker there, over the gong), and every worker that's awake climbs up on its desk for a quick dance, its light flashing like a disco ball, before it hops back into its seat. Workers on bean bags dance on the bag, and the board agents on their kiosks. It rings however the PR merged: from the PR window, by a worker's `gh pr merge`, by auto-merge or on GitHub itself. When the last task on the task queue gets done, the gong rings three times and confetti flies over every desk. Walk up and press **E** to bang it yourself.
- **Ask a worker about anything on a board.** Every issue and PR has **✍️ Ask a worker…**: type your own prompt, and the worker gets it along with which issue or PR it's about. Send it to a new worker at a free desk, or to one already sitting at a desk.
- **Board agents.** An agent stands at a little kiosk beside each of the issues board, the PR board and the task queue. Walk up and press **E**, type what you want, and it runs as a Claude Code (or your configured) agent that already knows its job. The issues agent files, finds, triages, labels and closes issues with `gh`. The PR agent sums up, reviews, comments on and merges pull requests. The queue agent turns what you ask for into tasks on the queue, one per piece of work, and can tell you what's queued or take tasks off. It never does the work itself, not even a one-line fix: it queues it and tells you what it queued. The first prompt hires it; after that your prompts go into the same session, so you can follow up, and a sleeping one wakes up with your prompt. Press **O** there to watch its terminal and **X** to send it home, and the next prompt starts a fresh one. The agents work in the floor's main checkout, so they're told not to change code there: work that needs code changed goes on the queue, where a fresh worker does it in its own worktree.
- **The meeting room.** Under the boss office there's a glass meeting room with a long table. Press **E** at it (or **🤝 Meeting room** in the **☰** menu, which sits on the top bar while a meeting is on), or **🤝 Meeting…** on an issue or **🤝 Review panel…** on a PR, to call a meeting: 2 to 5 workers step out of the elevator one after another, walk over and sit down round the table, each with a role you can rename, and work through one question or task together in a pattern. **Debate**: everyone proposes, then critiques the others, and the head of the table writes the decision. **Lead & team**: the lead splits the task into a part for each of the others, they each do theirs, and the lead merges the work. **Map-reduce**: the same task over a list of parts (files, modules, issues) shared out between the mappers, then one worker combines what they found. **Red / blue**: red attacks the change (bugs, security holes, edge cases) and blue fixes what holds up, round after round, until red finds nothing more. **Review panel**: reviewers each read a PR through their own lens (correctness, security, performance…), and the head of the table merges them into one review, every finding tagged with its lens, which the office posts on the PR. Every meeting declares its output file up front (`docs/decisions/….md`, a review…) and ends when that file is written: the office commits it on the meeting's own branch (**🔀 Open PR** in the meeting window opens a pull request for it). Meetings are bounded: a round limit per pattern, and a token budget for the whole table (a million tokens per worker unless you set it). Over the budget, when a worker won't write its part, or when someone is sent home, the meeting stops and says why. The sign on the door shows the pattern, the round, the tokens and the cost as it goes, and a one-line summary once it's over; the board on the back wall shows the output as it's written, and the card over each worker says whose turn it is and which round. The workers stay at the table so you can read their terminals until **🧹 Clear the room** or the next meeting sends them home.
- **Task queue.** A whiteboard on the north wall, between the issues and PR boards, and **📋 Task queue** in the **☰** menu. Click **Add to queue** on any issue, or type a free-text task, and walk away. Whenever a desk is free and fewer than *workers at once* of its tasks are running (3 by default; 0 pauses the queue), the next task gets a fresh worker in its own git worktree. Workers you hire yourself don't count against it; the office's worker limit, if there is one, counts everyone. The issue is assigned on GitHub, so it moves to *In progress* on the issues board, and the pull request is linked on the whiteboard as soon as it shows up. Finished workers stay at their desks so you can read their terminals, until the queue needs the desk for the next task. The queue survives restarts.
- **Services board.** When a worker starts a web server (`npm run dev`, a preview build, `python -m http.server`), it appears within a few seconds on the **🌐 Services** board, which hangs on the wall by the lounge and is also in the **☰** menu. Each entry shows the worker, its branch and the page's title. Click a row to copy one command that opens that server on your own computer. Hire a worker with its own worktree, ask it to run the dev server, and your designer can review the branch in their own browser.
- **Pictures on the walls.** Press **F** (or **🖼️ Hang a picture** in the **☰** menu) and paste a link to any image online: a team photo, a diagram, a meme. Pick one of six frames, then aim at a wall and click to hang it. Scroll to size it first. Where it can't go, over a window or a board, the preview turns red. Everyone sees it right away, and it stays up across restarts. Look at a picture and press **E** for a closer look, or to move, edit or take it down.
- **A whiteboard to draw on together.** A whiteboard on wheels stands out on the floor between the desks and the lounge. Press **E** at it (or **📝 Whiteboard** in the **☰** menu) and [Excalidraw](https://excalidraw.com) opens, with shapes, arrows, freehand, text and pasted pictures. Everyone on the floor who opens it draws on the same board at once: you see their strokes as they draw, their cursors with their names, and what they have selected. The top of the window shows who's drawing, and so does the hint at the board. Whatever is drawn shows on the whiteboard in the office for everyone walking past, and stays there across restarts. Each floor has its own. Press Esc once to finish what you're doing and again to close it.
- **A bookshelf of the project's docs.** A bookshelf stands against the south wall, between the balcony doors and the window. Press **E** at it to read every Markdown file in the project: the README, the docs folder, each package's notes. Type in the filter box to narrow the list down. The letters only need to be in order, so `gs` finds `getting-started.md`, and each extra word narrows it again. Use **↑ ↓** and **Enter** to open one, and **Page Up/Down** to read on without leaving the box. Docs look the way GitHub shows them, with tables, code, callouts, task lists and the project's own pictures. A link to another doc opens it right there, **☰ Contents** jumps to any heading, and the shelf reopens on the doc you last read. While you read, your character holds an open book, turning a page now and then. Everyone else sees it, along with what you're reading under your name tag.
- **An office dog.** Every floor has a dog. It naps under the desks of workers who are busy, trots after people for a while, sniffs around and hangs out on the lounge rug. When a worker needs input, it drops everything, runs to that desk and barks until someone opens that worker's terminal, so you can see from across the room who's waiting. It stays there until the worker is answered. Walk up and press **E** to pet it, and everyone sees it wag. Name it under **⚙️** → *Office dog*.
- **Sent home with a box.** A worker you send home (**X** at its desk) doesn't just vanish. Its light goes out, its face falls, and its things go into a cardboard box: a plant, a framed photo, its mug and a rubber duck. Its laptop snaps shut, and it hops off its chair and trudges out with the box in its arms, out the exit door, down the steps and off along the sidewalk. Floors above the bottom one have no exit door, so there it walks out onto the balcony instead, climbs up on the railing and jumps: its parachute pops open and it circles down onto the lot out front, box and all, then walks off along the sidewalk. The desk is free straight away, so you can hire someone new while the last one is still on the way out.
- **Voice.** Browser-to-browser WebRTC voice. Volume depends on how close you stand, but people are never fully silent. **V** joins, and once you're in, **V** is push to talk: hold it to talk, and you're muted when you let go. **M** mutes and unmutes. Pick **Push to talk** under **⚙️** to join muted, or keep an open mic. Leave voice from the **☰** menu.
- **Office sounds.** Busy workers clatter away at their keyboards, footsteps pad past, the fridge hums, birds chirp outside the windows by day and crickets at night, rain patters on the glass, thunder rolls in a storm, the coffee machine grinds and gurgles, the gong booms when a PR merges and the dog barks. It's all synthesized in the browser and placed where it happens, so it gets louder as you walk closer. Turn it down or mute it under **⚙️**, which also covers the worker dings but not voice chat.
- **Arcade cabinet.** Workers take minutes, so there's an arcade cabinet in the lounge, next to the jukebox. Press **E** at it and the camera glides up to its screen to play BLOCKFALL, a falling-blocks game: arrows (or WASD) move and turn, **Space** drops, **C** holds a piece for later, **P** pauses. Everyone else on your floor sees your game on the cabinet as you play, and anyone can walk up and press **E** to watch it up close over your shoulder. When one of your workers needs input, the game pauses and says which one, with a button to its terminal. Walk away and your game waits, paused, until you come back. The high-score table is the whole building's: it shows on every floor's cabinet, and it survives restarts.
- **Basketball.** Every floor has a hoop on the west wall, by the exit door, with a key painted on the floor in front of it and a ball waiting underneath. Walk up to the ball and press **E** to pick it up. Hold **E** (or the mouse button, in first person) to wind up: a meter runs up and down, and letting go in its green band sinks it, while a little late banks in off the glass and too early or too late misses. In first person the ball goes where you look, so put the crosshair on the rim. In third person your character squares up to the hoop when you're facing roughly its way. **Q** drops the ball. Everyone on the floor sees the ball in your hands and the same shot fly, bounce off the rim and swish through the net, and grab the rebound (**E**, even in mid-air). A basket from past 6.75 m is worth three, and you're told how many you've sunk in a row. The ball stays on its floor: take the elevator with it and it goes back under the hoop.
- **The rooftop bar.** The elevator goes up to the roof, over every floor. A DJ plays drum and bass on a stage under a rig of moving lights and lasers, with an LED wall behind and a dance floor lighting up in front, all flashing in time with the music. The Sky Bar is under a pergola hung with string lights, there's a lounge round a fire pit, and sun loungers look out over the street. The city goes on all around, and its windows, street lamps and traffic light up at night. Press **E** at the bar (or sitting on a stool at it) for a drink: a beer, wine, a cocktail or a shot goes to your head for a minute or so, and the view sways, doubles and smears while you stagger a little. The more you have, the worse it gets, until the bartender pours you a water. Everyone up there sees the glass in your hand and hears the same bar of music. Press **E** at the DJ booth to blow the air horn for all of them.
- **Jukebox.** A jukebox glows in the corner of the lounge. Walk up and press **E** to put on one of its four lo-fi tunes, skip to the next, turn it off, or paste a link to internet radio or an audio file. Everyone on the floor hears the same song from the same bar, coming from the jukebox: loud on the couch, faint at the desks. The tunes are synthesized in the browser like the office sounds, and it keeps playing when you switch tabs. The jukebox has its own volume under **⚙️**, just for you.
- **Screen sharing.** Your screen appears on the lounge TV for everyone, and there's a full-screen viewer.
- **An account for everyone.** Open **🔑 Accounts** from the **☰** menu and make an invite link. Whoever opens it picks a password and gets an account in their own name. That name is the one on their character, in chat and on every terminal they type into (**⌨️** in the terminal header shows who typed last), and nobody else can take it. Admins see everyone's accounts there, can make someone an admin, and can revoke an account, which signs that person out at once. The shared office password keeps working alongside the accounts until an admin switches it off. Sessions are signed cookies, and login attempts are rate limited.

## Requirements

On the machine that runs the office (your laptop or a VPS):

- **Node.js 20+**. Prebuilt PTY binaries ship for Linux, macOS and Windows, x64 and arm64, so no compiler is needed.
- **Claude Code** (`claude`), **OpenCode** (`opencode`) and/or **Codex CLI** (`codex`), installed and configured as the user that runs the office. Install each provider you want to use. Codex requires native command-hook support (tested with CLI 0.154.0).
- **git**, plus the **GitHub CLI** (`gh`) logged in (`gh auth login`) if you want the issue and PR boards.
- `curl` is optional. The status hooks use it when it's there and fall back to Node when it isn't.

## Install & run

One line installs the latest release and starts the office. You don't need to clone anything:

```bash
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/install.sh | bash
```

Anything after `bash -s --` goes to the office, such as a project directory or a port:

```bash
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/install.sh | bash -s -- ~/code/my-project --port 4700
```

The script checks for Node.js 20+ and npm, downloads the newest [release](https://github.com/AgentSystemLabs/agent-office/releases) into `~/.local/share/agent-office` and installs its dependencies there. It also puts an `agent-office` command in `~/.local/bin`, so after the first run `agent-office` on its own starts the office. Run the curl line again to update. Set `AGENT_OFFICE_VERSION=v0.1.68` to install a particular release, or `AGENT_OFFICE_INSTALL_ONLY=1` to install without starting. The other settings are listed at the top of [`install.sh`](install.sh). It runs on macOS and Linux.

**On Windows**, one line in PowerShell does the same:

```powershell
irm https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/install.ps1 | iex
```

To pass the office a project directory or a port, run it as a script block instead:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/install.ps1))) C:\code\my-project --port 4700
```

It installs releases into `%LOCALAPPDATA%\agent-office` and puts an `agent-office` command in `%LOCALAPPDATA%\agent-office\bin`, which it adds to your user PATH. Open a new terminal after the first install and `agent-office` starts the office from PowerShell, cmd or Git Bash. Run the irm line again to update. It takes the same settings as `install.sh`, set the PowerShell way (`$env:AGENT_OFFICE_VERSION = 'v0.1.68'` before the irm line), plus `AGENT_OFFICE_NO_MODIFY_PATH=1` to leave your PATH alone, and `AGENT_OFFICE_BIN_DIR=none` skips the command. They're listed at the top of [`install.ps1`](install.ps1). It works in Windows PowerShell 5.1 and PowerShell 7. You can also run `install.sh` inside WSL.

Or install from a clone, to work on the office itself:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
npm install          # also builds the client and server
npm install -g .     # puts `agent-office` on your PATH
```

Then run it, from anywhere:

```bash
agent-office --password 'correct horse battery staple'
```

It prints the URLs your teammates can open. If you leave out `--password`, it generates one, saves it in `~/agent-office/.agent-office/config.json` and prints it. Open the office and the elevator asks for your first project.

The office keeps its data in `~/agent-office` (`--home` or `AGENT_OFFICE_HOME` to move it) and clones projects next to it, as `~/agent-office/<owner>/<repo>`. To clone them somewhere else, like `~/Workspace`, an admin picks the **Workspace folder** in ⚙️ Settings (or start with `--projects` or `AGENT_OFFICE_PROJECTS`). Floors you already have stay where they are, and a checkout of the same repository that's already in the new folder is used as it is. The list of floors is `~/agent-office/.agent-office/floors.json`. Each floor keeps its workers, queue, pictures and worktrees in its own checkout's `.agent-office/`.

To start the office in a project you already have, pass its folder: `agent-office ~/code/my-project`. That project becomes a floor, and the office keeps its data in `~/code/my-project/.agent-office` as it always did. An office that already ran in a project (from before there were floors) carries on in it when you start `agent-office` there again.

### Accounts

The office password gets you in until everyone has an account, and whoever signs in with it is an admin. Open **🔑 Accounts** and make an invite link for each person. Give the invite a name, or leave it empty and they pick their own, and make them a *Member* or an *Admin*. Send them the link: it works once, for 7 days, and they choose their own password. Make one for yourself too, as an admin.

Once everyone has an account, switch off the shared password in the same panel. You have to be signed in with your own admin account to do that. From then on, revoking someone locks them out for good. While the shared password still works, anyone who knows it can get back in.

The same works from a terminal on the office's machine, even while the office runs:

```bash
agent-office accounts                      # accounts, open invites, and the shared password
agent-office accounts invite ada --admin   # prints a single-use /join#… link
agent-office accounts revoke ada           # signed out within seconds
agent-office accounts role ada member
agent-office accounts password on          # if every admin is ever locked out
```

```
agent-office [dir] [options]

      --home <dir>        Where the office keeps its data without a [dir] (default ~/agent-office)
      --projects <dir>    Where new floors are cloned, as <dir>/<owner>/<repo> (default ~/agent-office;
                          also settable from ⚙️ Settings)
  -p, --port <n>          Port (default 4600, env PORT)
  -H, --host <addr>       Bind address (default 0.0.0.0)
      --password <pw>     Office password (env AGENT_OFFICE_PASSWORD)
      --agent <cmd>       Default agent command (default "claude")
      --agent-args <str>  Extra args for the configured agent, e.g. "--model opus"
      --tls-cert <file>   Serve HTTPS with this cert…
      --tls-key <file>    …and key
      --self-signed       Serve HTTPS with a generated self-signed cert
      --trust-proxy       Trust X-Forwarded-* (behind Caddy/nginx)
      --turn <url>        Add a TURN server for voice, e.g. turn:user:pass@host:3478
      --budget <usd>      Daily tracked Claude Code budget (OpenCode/Codex excluded)
      --budget-pause      ...and nobody can hire a new worker until the next day
      --max-workers <n>   Run at most n workers at once, across every floor (env AGENT_OFFICE_MAX_WORKERS)
      --webhook <url>     Post to this Slack / Discord webhook when a worker needs input or finishes
      --city <name>       Put the office in a real city: its sun and live weather (open-meteo.com)
      --weather <kind>    Pin the weather: clear, cloudy, rain, storm, snow or fog

agent-office prune [dir] [-n|--dry-run] [-f|--force]

  Removes leftover worker worktrees under .agent-office/worktrees/ and their
  office/* branches, in one floor's checkout (dir). Anything with uncommitted changes or unpushed commits is
  kept unless --force is given.

agent-office accounts [list | invite [name] [--admin] | revoke <name> | role <name> admin|member | password on|off] [-d <dir>]

  Invite, list and revoke people's own accounts, and switch the shared password
  off or on. Works while the office runs.
```

## Choosing an agent

Every new worker starts on the office's **Default worker**: a provider, model and effort an admin picks in ⚙️ Settings (the `--agent` with its own default model until someone does). The hire, ask, queue, issue and meeting windows show it on one line; click **✏️ Edit** there to pick **Claude Code**, **OpenCode** or **Codex**, a model and an effort for just that worker or task, and **↺ Use the default** to go back. Board agents and tasks the Queue agent adds, which nobody picks for, start on the default too. Existing workers keep their provider when prompted or resumed, and queued tasks keep their choice when retried or restored after a restart.

For OpenCode, the optional **OpenCode model** field selects the initial model for a new worker or queue task. Suggestions come from `opencode models`; you can also enter a `provider/model` ID. Leave it empty to use your OpenCode settings (including configured CLI arguments). An explicit choice overrides configured model arguments for that launch and stays with a queued task when retried.

For Claude Code, the **Model** and **Effort** fields pick `--model` (Fable, Opus, Sonnet or Haiku) and `--effort` (low, medium, high, extra high or max) for that worker or queue task, overriding whatever `--agent-args` set office-wide. Leave either on **Default** to use the office's configured value. The choice stays with a worker across resumes and with a queued task when retried, and shows up next to the worker in the Workers panel and on its task card so you can tell at a glance who's on what — and the per-worker cost there reflects the actual model used.

In an open OpenCode terminal, **Models** opens the native model picker using the default `Ctrl+X M` shortcut. Select a model there to change the active worker without restarting it or losing a draft. If you customized that binding, use your configured shortcut or `/models` inside the terminal. Resuming a saved session lets OpenCode restore its current model instead of forcing the initial Office selection again.

Claude Code remains the default. To default to OpenCode:

```bash
agent-office /path/to/project --agent opencode
```

`--agent-args` applies only to the provider configured by `--agent`; choosing another provider uses its normal command and settings. OpenCode model flags therefore never reach Claude Code, and vice versa. An arbitrary `--agent` executable remains available as **Custom**.

## The office's prompts

Everything the office tells a worker by itself can be rewritten in ⚙️ Settings → **📝 Prompts**: what **🤖 Hand to a worker**, **🔍 Review**, **Fix up & merge**, **Fix conflicts & merge** and **✍️ Ask a worker** send from the boards, what a meeting about an issue or a review panel starts with, the note the queue adds to a worktree task, the three board agents' briefs, every part the meeting room hands out, and the instructions for the model that writes the signs over workers' heads. Each one lists its `{{placeholders}}` (the issue number, the PR's branch, the file a meeting waits for…), which the office fills in when it sends it, and warns when one the office counts on is missing. **↺ Default** puts the office's own wording back. Admins edit them; they're the same on every floor and kept in `.agent-office/prompts.json` with the Default worker.

OpenCode receives prompts through `--prompt` and resumes its saved session through `--session`. The office adds a local event plugin through `OPENCODE_CONFIG_CONTENT`, preserving existing inline JSON settings and plugin entries. Inline settings must be a JSON object; configuration files continue to use OpenCode's own loader. The office does not edit your OpenCode configuration files or bypass permission prompts. The bridge reports worker status to a loopback endpoint authenticated by a per-worker token. OpenCode and Codex must be installed separately on machines provisioned with the existing AWS script, which still installs Claude Code only.

Codex uses its interactive CLI with `--no-alt-screen`, preserves native sandbox and approval settings, and resumes through `codex resume <session-id>`. Set it as the default with `--agent codex`; use `/model` inside its terminal to choose a model. The office supplies command hooks through per-process config overrides, without editing your Codex configuration. On first use, open the terminal, complete any login/setup, and review the generated Office commands in `/hooks`. Hooks need your native trust approval before session/status tracking works; the office never bypasses that review. Workers that do not report startup are marked as needing input. Codex tasks use local summaries and do not launch Claude for task naming. Its token metrics come from the root rollout identified by the trusted hook, under `CODEX_HOME/sessions` or `CODEX_HOME/archived_sessions` (default `~/.codex`). The reader checks the session identity, bounds file reads, and sends only normalized counters to the browser. Snapshots update after hooks and on a 10-second poll, survive restarts, and reset for a new session. Cache and reasoning are counted once. Child-session usage is excluded; USD cost and API-call counts are shown as unavailable. The rollout format is version-dependent (verified against 0.154.0); missing or unsupported records remain unavailable instead of being shown as zero. Reads inspect at most a 1 MiB header and the latest 4 MiB of a rollout; if no newer counter is found in that tail, the last known snapshot remains visible.

OpenCode metrics come from assistant-message token/cost records exposed by its plugin SDK. Updated messages replace prior values so streaming updates do not add the same call twice; existing root and child sessions are loaded on resume. History that is still loading or unavailable is labeled as partial. These snapshots update usage only, so a report cannot dismiss a permission request. The daily budget and historical ledger remain Claude-only.

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Walk (hold Shift to run); on the ladder, W and S climb |
| Space | Jump (you can land on desks, couches and the cars in the garage) |
| Mouse drag / wheel | Orbit / zoom the camera |
| E | Interact: hire a worker, open its terminal, read a board, take an issue's note off the board, prompt a board agent, call a meeting in the meeting room, draw on the whiteboard, read the docs at the bookshelf, watch the TV, sit down (or get up), ride the elevator, climb the ladder (or get off it), slide down a fire pole, grab a coffee, take a smoke break, tee off at the golf tee, pet the dog, pick up the basketball (then hold E and let go to shoot), order a drink at the rooftop bar, blow the DJ's air horn |
| P | Prompt: give a task to a new worker, or to the one at this desk |
| C | Changes: the files the worker at this desk changed and their diff; commit, discard or open a PR |
| B | Open a shared shell at an empty desk |
| R | Resume a sleeping worker (or restart a shell) |
| X | Send a worker home (frees the desk; a worker with its own worktree asks what to do with it) |
| O | Open a pull request for a worker on its own branch, or see the one it has |
| N | Go to the worker that has waited longest on someone; again for the next one |
| F | Hang a picture from the web on a wall (scroll to size it, click to hang it) |
| Q | Put back the issue card you're carrying, or drop the basketball |
| T / Enter | Chat |
| G / 1–6 | Emote: hold G for the wheel (point and let go) or press 1–6 to wave, give a thumbs up, clap, dance, point or facepalm; everyone on your floor sees it |
| / | Search the chat and every terminal on your floor |
| V | Join voice; in voice, hold to talk (you're muted when you let go) |
| M | Mute / unmute in voice |
| Tab | The ☰ menu: every window, and what shows on screen |
| Esc | Close any window (a terminal too) and get back to looking around |
| Ctrl + [ | Send Esc to a terminal (e.g. to interrupt Claude) |

You can also click a nearby desk to interact with it, or click a worker in the Workers panel (**🤖 Workers**, top right) to open its terminal.

## One command on AWS

If you have the AWS CLI logged in, one command gives you your own office on EC2. No Terraform needed:

```bash
git clone https://github.com/AgentSystemLabs/agent-office && cd agent-office
deploy/aws.sh up
```

After that, the whole lifecycle is four more commands:

```bash
deploy/aws.sh open      # tunnel to the office and open it in your browser
deploy/aws.sh pause     # stop the machine to save money (asks first); only the disk and IP are billed
deploy/aws.sh resume    # start it again: same address, same files, then open it
deploy/aws.sh destroy   # delete the machine, disk, IP, security group and key pair (asks first)
```

What `up` does, in about 2 minutes:

1. Creates an SSH key pair (kept in `~/.config/agent-office/aws/<name>/`).
2. Creates a security group that opens **only SSH (port 22), and only to your current IP**. The office itself is never on the internet.
3. Gives the machine a fixed Elastic IP and launches a **t3.xlarge** (4 vCPU, 16 GiB) Ubuntu 24.04 instance with a 50 GiB disk.
4. Installs Node 22, git, the GitHub CLI and **Claude Code**. It clones the latest agent-office from GitHub, runs `npm i`, and clones your project.
5. Runs the office under systemd with `Restart=always`, so it comes back after a crash or a reboot. It listens on `127.0.0.1:4600` on the machine, so the only way in is an SSH tunnel.
6. Opens an SSH tunnel and your browser at `http://localhost:4600`. **The first page shows the office password once. Write it down.** The server then keeps only a hash, so nobody can display the password again.

Everything goes through SSH, so there are no certificate warnings, and `localhost` counts as a secure origin: voice and screen sharing just work. Keep the terminal open while you use the office; Ctrl-C closes the tunnel. Next time, run `deploy/aws.sh open`. If port 4600 is taken on your machine, it picks the next free one.

**Inviting your team.** Teammates don't need AWS access or this repo, just `ssh`. In the office, click **👥 Invite teammates** in the **☰** menu and type their GitHub username. That installs the SSH keys from `github.com/<username>.keys`. The panel then gives you one command to send them, for macOS, Linux or Windows. It opens the tunnel and, once it's up, the office in their browser:

```
ssh -o ExitOnForwardFailure=yes -o PermitLocalCommand=yes -o LocalCommand="open http://localhost:4600" -L 4600:localhost:4600 office@<your-office-ip>
```

**Copy invite message** copies the command, plus the server fingerprint to check on first connect. The panel also lists who's invited and can remove them. The same works from your terminal:

```bash
deploy/aws.sh invite octocat        # uses the SSH keys on github.com/octocat
deploy/aws.sh allow 203.0.113.7     # their IP (SSH answers only allowed IPs)
```

They leave that command running and sign in with the office password. Their keys log in as a separate `office` user that can **only** forward to the office port. It has no shell, no other ports, no `-R`, and no agent forwarding. So a leaked teammate key still doesn't get past the office password.

**Reviewing what workers build.** Every web server a worker runs is listed on the **🌐 Services** board. Clicking a row copies a command like this one:

```
ssh -N -o ExitOnForwardFailure=yes -o PermitLocalCommand=yes -o LocalCommand="open http://localhost:5173" -L 5173:localhost:4600 office@<your-office-ip>
```

It opens http://localhost:5173 on their computer. The tunnel ends at the office's own port, and the office relays it to the worker's server on 5173. So the same invited keys work, nothing new is opened on the machine, and every page still asks for the office password (anyone signed in to the office already is). Keep one terminal per service open while you look. You set the office up yourself? Run `deploy/aws.sh service 5173` instead.

If chasing teammates' IPs gets old, `deploy/aws.sh allow anywhere` opens SSH to every IP. That's a reasonable trade: SSH only accepts your key and invited keys, and the office stays behind the tunnel.

```bash
deploy/aws.sh open                 # tunnel + open the office in your browser
deploy/aws.sh service 5173         # open a worker's web server from the 🌐 Services board
deploy/aws.sh invite <gh-user>     # let a teammate tunnel in (or: invite <name> <key.pub>)
deploy/aws.sh uninvite <name>      # remove their keys and drop open tunnels
deploy/aws.sh team                 # who's invited
deploy/aws.sh allow 203.0.113.7    # let an IP reach SSH (CIDR ok; "me", "anywhere")
deploy/aws.sh revoke 203.0.113.7   # …and take it back
deploy/aws.sh status               # instance, address, office up?, team, allowed IPs
deploy/aws.sh resize t3.2xlarge    # bigger or smaller machine; same address, ~1-2 min of downtime
deploy/aws.sh update               # install the latest agent-office and restart
deploy/aws.sh reset-password       # new password, shown once; signs everyone out
deploy/aws.sh ssh | logs           # get on the box / follow the office logs
```

**Upgrading from the office.** **⬆️ Upgrade the office** in the **☰** menu checks GitHub for new commits on the branch the office was installed from. When there are any, an orange **⬆️ Update** button shows up on the top bar, and it lists them. **Upgrade now** builds the new version next to the running one. Meanwhile the office keeps working and everyone sees a banner. A failed build changes nothing. Once the build succeeds, the office swaps it in and restarts, and everyone gets a *"🛠️ Upgrading the office"* dialog. A few seconds later their page reloads on the new version. Workers that were awake wake back up at their desks by themselves. Anything they were in the middle of gets interrupted, and the panel names those workers before you click.

An office created before the SSH tunnel served HTTPS on port 443 with a self-signed certificate. Run `deploy/aws.sh up` once to move it over: 443 closes and the office moves behind the tunnel. Offices created before **👥 Invite teammates** and **⬆️ Upgrade the office** also need one `deploy/aws.sh up` before those show up in the **☰** menu. `update` alone isn't enough, because `up` installs the key helper and turns on self-upgrade in the systemd unit.

Useful options for `up`:

- `--project owner/repo` chooses which GitHub repo the office works on. The default is the GitHub origin of the directory you run it from.
- `--instance-type`, `--disk` and `--region` set the machine size, disk size and region.
- `--allow <ip>` lets more IPs reach SSH from the start.
- `--name <name>` runs several offices side by side.

**Claude sign-in.** Workers run Claude Code on the machine, so it has to be signed in there. You can do this either way:

- Pass `--claude-token "$(claude setup-token)"`, which uses your Claude subscription, or `--anthropic-api-key <key>`.
- Do nothing, and the first worker jumps with *"Claude isn't signed in — type /login"*. Open its terminal and run `/login`.

**GitHub.** By default, your local `gh auth token` is used to sign in the GitHub CLI on the machine. It's needed for private repos, the issue and PR boards, and for workers to push branches and open PRs. Anyone who can use the office can use that token, so pass `--github-token <fine-grained token>` or `--no-github-token` if that's too much.

## Running it on a VPS for your team

The simplest private setup needs no certificates at all. Run `agent-office --host 127.0.0.1` and have everyone connect with `ssh -L 4600:localhost:4600 you@server`, then open http://localhost:4600. Browsers treat `localhost` as secure, so voice and screen sharing work.

To serve it on a real domain instead, put the office behind HTTPS. Voice and screen sharing need a secure context. The simplest setup is Caddy, which gets certificates automatically:

```caddy
# /etc/caddy/Caddyfile
office.example.com {
    reverse_proxy 127.0.0.1:4600
}
```

```bash
cd /srv/my-project
agent-office --host 127.0.0.1 --trust-proxy --password "$(openssl rand -base64 18)"
```

Caddy proxies WebSockets out of the box. With nginx, forward the Host and Upgrade headers:

```nginx
location / {
    proxy_pass http://127.0.0.1:4600;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1d;
}
```

To keep the office running, use a systemd unit:

```ini
# /etc/systemd/system/agent-office.service
[Unit]
Description=Agent Office
After=network.target

[Service]
User=dev
WorkingDirectory=/srv/my-project
# generate with: openssl rand -base64 24
Environment=AGENT_OFFICE_PASSWORD=<a long random password>
ExecStart=/usr/bin/env agent-office --host 127.0.0.1 --trust-proxy
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

If you don't have a domain, `--self-signed` serves HTTPS directly. Browsers will warn once per person.

**Voice across strict NATs.** Peers connect directly using public STUN. If some teammates can't hear each other (common on corporate networks), run a TURN server such as coturn and pass `--turn turn:user:pass@turn.example.com:3478`.

## How it works

```
browser ──HTTPS/WSS──▶ agent-office (Node)
                         ├─ node-pty ─▶ claude / opencode (one PTY per worker, cwd = project dir)
                         │    └─ headless xterm mirror ─▶ laptop screen frames + late-join snapshots
                         ├─ loopback-only hook server ◀── curl from Claude Code hooks (per-worker token)
                         ├─ gh issue/pr list (cached, refreshed every 90s)
                         ├─ port scan every 4s ─▶ 🌐 Services board; relay for service tunnels
                         ├─ /api/image ─▶ fetches pictures for the walls (cached)
                         └─ WebRTC signaling relay (voice + screen share are peer-to-peer)
```

- **Status.** Claude workers start with `--settings .agent-office/claude-hooks.json`. That file adds hooks (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `Stop`, `SessionStart`) which `curl` a server bound to `127.0.0.1`. The hooks merge with your own Claude settings; they don't replace them. OSC 9;4 progress sequences in Claude terminals also count, which catches an Esc-cancel. OpenCode workers use a generated plugin to forward session, permission and question events to the same loopback server, with a separate endpoint. Codex uses a generated command helper and its own authenticated endpoint. The server reads only token records from the explicitly linked root rollout; approval settings are preserved.
- **Shared shells.** Press **B** at an empty desk to open a plain login shell for dev servers, git or tests. It's shared the same way as a Claude terminal.
- **Isolated branches.** When you hire with a task, you can tick *own git worktree*. The worker then gets its own `office/<name>` branch under `.agent-office/worktrees/`, so parallel workers never share a checkout. When you send that worker home you choose whether to keep the worktree and branch, delete the worktree, or delete both, and the office warns you first about uncommitted changes or commits no remote has. `agent-office prune` clears out whatever was kept, once it is safe.
- **Pull requests.** **O** at a worktree worker's desk runs `git push -u origin office/<name>` in its worktree, then `gh pr create` with the task as the body and the commits listed. The base is the branch the office was on when the worktree was cut, if that branch is on the remote. The PR number is saved with the worker, so the board can point back at the desk.
- **Changes.** While someone has a desk's Changes window open, the office runs `git status` and `git diff` in that worker's checkout every two seconds and pushes the file list when it differs. The diff is against the merge base with the branch the office was opened on, so it covers the worker's commits and its uncommitted edits. Commit is `git add -A && git commit`, discard is `git restore` / `git clean` (or `reset --hard` for everything), and Open PR pushes the branch and runs `gh pr create`.
- **Shared terminals.** Each worker's PTY lives in `agent-office-ptys` (`src/server/ptyhost.ts`), a detached process the server starts for each floor and talks to over a Unix socket in that project's `.agent-office/`. On SIGTERM the server leaves the PTYs running there, and the next server takes them back with a snapshot of each screen. Hooks that fire in between retry until it's up. If no server comes back within 30 minutes, the PTYs are ended. The server mirrors each PTY in a headless xterm. People who open the terminal get a serialized snapshot, then the live stream. Laptops get compact per-row diffs a few times a second. The PTY takes the size of whoever is typing.
- **Scrollback and search.** Every 15 seconds, for each worker that printed something new, and again as the office shuts down, its last 3,000 lines are serialized, colors included, to `.agent-office/scrollback/<worker>.ansi`. A worker that starts again (after a restart, or when you resume it) gets its old lines replayed into its terminal first, then a dim *office restarted* line. The chat is appended to `.agent-office/chat.jsonl` and trimmed to the last 1,000 messages. `GET /api/search?q=` matches case-insensitively, treating runs of whitespace as one space, over the chat and each worker's terminal buffer. It returns the newest lines first, each distinct line once. The browser finds the hit again in its own copy of the terminal and scrolls to it.
- **Cost.** Hooks carry no usage, but each one names the session's transcript (`~/.claude/projects/<dir>/<session>.jsonl`). The office reads what gets appended to it, and to the subagent transcripts next to it: every assistant message records the API's token usage and the model, which the office prices from its own table (cache writes and reads included). When a session ends, Claude Code appends its own tally (`cost-state`), and the worker's numbers snap to that, which also covers calls that never reach the transcript. Per-worker totals are saved with the worker, and `.agent-office/usage.json` keeps the office's all-time and per-day spend, so nothing is lost on a restart or when a worker is sent home. On an office deployed with `deploy/aws.sh`, put `AGENT_OFFICE_BUDGET=20` (and `AGENT_OFFICE_BUDGET_PAUSE=1`) in `/etc/agent-office/env` and restart the service.
- **Holiday themes.** The server keeps the building's pick (`src/server/theme.ts`, saved in `.agent-office/theme.json`) and, for *By the calendar*, works out the holiday from the office's clock, checking again every ten minutes. Each browser then dresses its own scene: the costumes are in `src/client/world/costumes.ts`, the decorations in `src/client/world/holiday.ts`, and Halloween's sky and Christmas's snow in `src/client/world/sky.ts`.
- **Sky.** The server decides the weather and tells everyone (`src/server/sky.ts`), and each browser works out where the sun is from that and its own clock. Without `--city`, the office sits in the middle of the host's time zone at 40° north (34° south if its clocks go forward in January), and the weather changes every 20 to 50 minutes, with the season's odds. With `--city` (a name, or `lat,lon`), it asks open-meteo.com for the place once and for its current weather every 15 minutes; no key is needed, and nothing but the city's name and coordinates is sent. The office has no roof, so the sun and the sky light the rooms too. At night a few lines added to every lit material put lamplight back in the office and the garage, and pools of light around the lamps outside (`src/client/world/sky.ts`). A server on AWS keeps UTC, so on an office deployed with `deploy/aws.sh`, put `AGENT_OFFICE_CITY="Portland, Oregon"` in `/etc/agent-office/env` and restart the service.
- **Services.** Every 4 seconds the office lists the TCP ports its user's processes listen on (`ss`, or `lsof` on macOS). It credits each port to the worker whose terminal started it. It goes by the process tree first. For a server that detached from it, it uses the `AGENT_OFFICE_WORKER_ID` the process inherited (Linux), then whether it runs inside that worker's worktree. Ports that answer HTTP are shown. A request for `localhost:<port>` that reaches the office's own port (that's what a service tunnel does) is relayed to that server, WebSockets included, so hot reload works.
- **Pictures.** WebGL can only draw an image from another site if that site sends CORS headers, and most don't. So the office fetches each picture itself (`/api/image`, images up to 15 MB) and serves it from its own origin. Any image link works, and a picture on a worker's dev server does too. Browsers shrink each one to 1024 px before it goes on the wall.
- **Whiteboard.** It syncs the way Excalidraw's own live collaboration does. Every change bumps an element's version, each browser sends the elements it changed over the office's socket, and everyone merges what arrives with Excalidraw's `reconcileElements`, keeping the newer copy of each element (equal versions go to the lower random nonce, so every copy agrees). The office applies the same rule to its own copy and saves it in the floor's `.agent-office/whiteboard/elements.json`. Deleted elements are kept for a week so a deletion reaches everyone. Pictures go up once over HTTP (`/api/whiteboard/file`, up to 6 MB each) and are fetched by id, a hash of the picture. Excalidraw, a few MB of JavaScript, only loads when someone opens the whiteboard or a floor has a drawing to show on the board, and its fonts are served by the office rather than a CDN.
- **Board agents.** Each kiosk is a seat of its own (`station-issues`, `station-pulls`, `station-queue`) that the desks, the bean bags and the queue never use, and its agent doesn't count against the queue's *workers at once*. Its first prompt starts with a brief (`src/server/stations.ts`) saying what it's for. The agents reach the queue with `office-queue` (`bin/office-queue.js`, plain Node), which the office writes into the floor's `.agent-office/bin/` and puts first on their `PATH` whichever agent runs them: `office-queue list` shows each task's id, status, title, worker and PR, `office-queue add --title "…" [--issue 12]` queues a task with its prompt on stdin (or `--prompt`) and prints its id, and `office-queue remove <id>` takes a waiting one off. Under the hood that's `GET`, `POST` (`{title, prompt, issue?}`) or `DELETE ?task=` on `$AGENT_OFFICE_HOOK_URL/office/queue?worker=$AGENT_OFFICE_WORKER_ID` with `Authorization: Bearer $AGENT_OFFICE_HOOK_TOKEN`, all three set in their environment, over the office's loopback hook port. Only a board agent's own token is accepted; anyone else gets a 401 or 403, which the command prints. The queue agent is told to only ever add tasks, and with Claude Code it's also launched (and resumed) with `--disallowedTools Edit Write NotebookEdit`, so it can't edit the checkout's files.
- **Meetings.** A meeting (`src/server/meetings.ts`, patterns in `src/shared/meetings.ts`) seats its workers at the meeting table's chairs (`meeting-1` to `meeting-5`), which only a meeting uses, in one git worktree of its own on an `office/meeting-…` branch that everyone at the table shares. Each round is one or two steps; in each step, every worker with a part gets it as a prompt (the first one comes with a brief: the pattern, the roles, the question, the bounds), and the step is over when each of them has ended its turn (the same `Stop` hook and idle events as the status) with the file its part names written since it was handed over. Notes go in a `.meeting/` folder at the top of the worktree, where the others read them (not under `.agent-office/`, where Claude Code asks before writing in a worktree nested in the project), and are copied into the floor's own `.agent-office/meetings/<id>/` when the meeting ends. A worker that ends its turn without writing its file is reminded once; the second time, the meeting stops. The token budget counts everything the table's sessions report, cache reads included. When the output file is written, the office runs `git add -A` (all but `.meeting/`) and `git commit` in the worktree, or for a review panel posts the file as a review with `gh api …/pulls/<n>/reviews` (`event=COMMENT`). Workers waiting on the meeting don't jump or ding when they finish a part, and they don't count against the queue's *workers at once*. `meetings.json` keeps the meeting and the ones before it, so a meeting carries on through a restart of the office, like its workers do. Clearing the room sends the workers home and removes the worktree, keeping the branch when it has the committed output, and everything when something is left uncommitted.
- **Task queue.** `queue.json` holds the tasks and their providers in order. A task is seated when a desk is free and fewer than the limit are busy (a worker that is starting, ready, working or waiting for input). It finishes when its worker ends its turn (Claude/Codex `Stop` hooks or OpenCode's idle event), stops, or is sent home. The PR is matched by GitHub's closing-issue references (`closes #12`) or by the worker's branch.
- **Bookshelf.** `src/server/docs.ts` lists a floor's Markdown (`.md` and `.markdown`) with `git ls-files --cached --others --exclude-standard`. That covers what's committed plus new files that aren't ignored, so `node_modules`, build output and `.agent-office/` stay off the shelf. A folder that isn't a git checkout is walked instead, skipping hidden, dependency and build folders. Each doc's title is its front matter `title:` or its first heading, read from its first 4 KB, and the list is cached for a few seconds (`/api/docs`). Only Markdown can be read (`/api/docs/file`, up to 2 MB), and only pictures can be fetched for a doc (`/api/docs/picture`), both inside the checkout after following links. The browser renders the doc with the same sanitizer as issue and PR text. The book in your hands is the `reading` flag the office keeps on you while the window is open.
- **The dog.** Each floor's dog lives in the office, which decides what it does next: a worker waiting on an answer first, then napping by a busy worker, following someone, sniffing about or lounging. It walks around the furniture along a route found on a half-meter grid of the floor (A*, then pulled tight), and the office sends one message per leg of its day: the route, its speed and what it does at the end. Every browser works out from that where the dog is at any moment, so everyone on the floor sees it in the same spot without a stream of moves. The barks are timed in the browser, from when it arrived at the desk. A worker sent home finds its way to the exit door (or, on the floors above the bottom one, the balcony doors) on the same grid, worked out in each browser when the office says the worker is gone.
- **The gong.** Each time the office fetches the PR list, a PR that was open last time and is merged now rings the gong. A merge from the PR window rings as soon as `gh pr merge` returns, and isn't rung again when the list catches up. Anything else shows up at the next fetch: about every 90 seconds while someone is on the floor, and right after a queue task finishes. The gong is synthesized like the other sounds, so the volume and mute under **⚙️** apply to it.
- **Golf.** A shot is three numbers, its heading, loft and power, sent to everyone on the floor. Each browser works out the flight from those the same way, a fixed 240 steps a second: gravity and a little drag, the balcony's railing and wall, the neighbours' walls and roofs, the balconies further down, then bounces and a roll that depend on what it lands on (green, fringe, fairway, rough, sand or road), and the cup. So everyone sees the same ball land in the same place without it being streamed. The hitter's browser adds a little mishit to the numbers before sending them, so no two swings are exactly alike.
- **Jukebox.** Each floor's `jukebox.json` says only what's on and when it started, so it keeps playing through a restart. Every browser plays it for itself: a tune is decided note by note by its bar and step, so starting from the same moment is enough for everyone to hear the same thing. To agree on that moment, each page pings the office a few times on arriving and keeps the quickest answer to line its clock up with the office's. A tune is drums, bass, an FM electric piano and a melody picked from the chord tones, with record crackle and tape wobble, in 32-bar rounds. It's scheduled a second ahead on a timer rather than each frame, which lets it carry on in a background tab. It goes through a panner at the jukebox and a filter that muffles it with distance. Most streams can't be routed through Web Audio without CORS, so a stream plays in a plain `<audio>` element, turned down by hand on the same distance curve. An audio file seeks to where everyone else is.
- **Floors.** `floors.json` in the office's `.agent-office/` lists the floors: each one's checkout and colors. Adding one runs `gh repo view` (does this login see it, and what's its exact name), then `gh repo clone` into the projects folder; a checkout that's already there from the same repository is used as it is. Each floor runs its own workers, GitHub boards, queue and changes watcher in its checkout. A floor nobody is on, with nothing running, asks GitHub about its boards every 10 minutes instead of every 90 seconds. People get only the moves, worker updates and terminal frames of the floor they're on; the chat, voice connections and the budget are the building's.
- **The rooftop.** Nobody works up there, so the roof isn't a floor: it's a place (`@roof`, which no floor id can be) that people are on, with none of a floor's workers, boards or queue. The DJ's set is endless and needs no state: its tracks, their keys, grooves and basslines, and where each one is follow from the office's clock, like the jukebox's tunes, so everyone up there hears the same bar, and the lights flash on the same kicks and snares even for someone with the music off. Drum and bass at 172 BPM, synthesized in the browser: a two-step break, a reese bass through a filter that opens and closes on the eighths, a sub, pads, an arpeggio, risers into each drop and an air horn when one lands. Being drunk is just your own browser's: while you are, the frame is drawn into a texture and onto the screen through a shader that doubles, smears and ripples it. With reduced motion on, nothing sways or strobes.
- **State.** The office's `.agent-office/` (in `~/agent-office`, or in the project you started it in) holds the password, the signing secret, the accounts and open invites (`accounts.json`), the floors (`floors.json`), the chat and the spend. Each floor's checkout has its own `.agent-office/` with the hook settings, the saved workers and their scrollback, the task queue, the pictures on the walls (`decor.json`), the dog's name (`dog.json`), the jukebox (`jukebox.json`), the whiteboard (`whiteboard/`) and the meetings (`meetings.json`, and each meeting's notes in `meetings/`). It is added to `.git/info/exclude` automatically, so it never shows up in `git status`.

## Security notes

Anyone who can sign in can drive Claude Code, OpenCode or Codex in that directory, and through it run commands as the user that runs the office. Treat the password, the accounts and the invite links like SSH access:

- Use a strong password and HTTPS. With `--trust-proxy`, cookies are `Secure` once the proxy says the request came over https.
- Changing the shared password signs out everyone who came in with it, because those sessions are signed with a key derived from it. Account sessions carry the account's id and are checked on every request, so revoking an account, or switching the shared password off, signs those people out at once, open connections included. Account passwords are stored as scrypt hashes, and invite links carry their token after the `#`, so it never reaches a server log. Login and invite attempts are limited to 10 per 5 minutes per client.
- Only enable `--trust-proxy` behind a proxy that appends `X-Forwarded-For` (Caddy and nginx both do). The office uses the rightmost hop.
- Run the office as a dedicated, unprivileged user, in the project you mean to share.
- The WebSocket checks the session cookie and the `Origin` header. The hook endpoint only listens on loopback and needs a random per-worker token.
- Service tunnels are relayed only to web servers a worker started, and only with an office session. The office's own cookies are stripped before a request reaches that server. A server you started yourself outside the office is never listed or relayed.
- Workers don't inherit the office password or any parent agent-session variables.
- The picture fetcher (`/api/image`) needs an office session. It fetches any http(s) link it's given, from the office's machine. That gives nobody new reach: anyone signed in can already run `curl` from a shell worker. Pictures are served with a sandboxing `Content-Security-Policy`, so an SVG can't run script on the office's origin.

## Development

```bash
npm install
npm run build        # vite (client) + tsc (server)
npm run typecheck
npm test             # provider, event bridge, queue and PTY integration tests
node bin/agent-office.js /path/to/project --password dev
```

`npm run dev` runs Vite with hot reload on :5173 and proxies to the server on :4600. Server edits restart the server, not the workers. The PTY host keeps running its old code, though: after changing `ptyhost.ts`, bump `PTY_PROTOCOL` in `ptys.ts` and the next server replaces the host (its workers resume their sessions).

**Releases.** Every change to the app that lands on `main` is published as a GitHub release by [`.github/workflows/release.yml`](.github/workflows/release.yml), and `install.sh` installs the newest one. The workflow builds and typechecks the office, runs the tests, packs the release with an `npm-shrinkwrap.json` so every install gets the tested dependency versions, then installs the pack through `install.sh` and starts it before publishing. Pull requests run the same steps but publish nothing. A release is named after `package.json`'s major.minor and the number of commits on `main` (`v0.1.68`), so bump `package.json` to start a new minor version.

## License

[MIT](LICENSE)
