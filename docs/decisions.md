# Human decisions

The **left monitor on the Boss Office desk** opens **Entscheidungen** (decisions). The existing Minesweeper monitor is on the right. The same list is available from the office menu. Each project has its own persistent pool.

## Collect and organize

Use **Issues durchsuchen** to ask the Issue Agent to inspect open and in-progress issues and their comments for unresolved human decisions and manual playtests. Decisions go into this pool. Manual tests stay in the Playtest checklist when its `office-playtests` integration is installed. Scanning does not queue, assign, close or start implementation tasks.

Workers receive the same instructions when starting, resuming or receiving a task through the Office, including meetings. They use `office-decisions list` and `office-decisions add` to record questions discovered while working. Existing running terminals receive the instructions with their next Office task or resume; the current turn is not interrupted. Raw keystrokes typed directly into a terminal remain unchanged.

Questions have a category, tags, linked issue numbers, context, alternatives and an optional recommendation. Categories are Spielablauf, Design & UX, Technik, Assets, Release, Organisation and Sonstiges. Search includes question titles, question text, tags and issue numbers. Category and status filters narrow the list. Repeated submissions of the same question and issue set reuse its entry and preserve the human answer.

Mark **Blockiert Arbeit** only when the linked work cannot continue without an answer, and explain the dependency. These questions appear first and give the monitor a pulsing red alert. Workers must pause the dependent work and preserve it, rather than silently choose an answer or report it complete. Independent work can continue. A pending manual playtest alone is not a decision blocker.

## Answer and continue

Open a question, select an alternative or write an answer, then use **Entscheidung speichern**. Only the responsible account or an office administrator can answer. Worker credentials can add questions and read answers, but cannot answer on the human's behalf.

Saving removes the open blocker alert and stores an answer history. It **does not queue work, assign issues or start workers**. Use **Beantwortet** to see answered questions. If a question came from a worker, **[name] informieren / fortsetzen** explicitly sends the answer to that existing worker. Busy workers and workers waiting for terminal input are left alone; retry after resolving their current activity. Sending the same answer to the same worker twice is prevented. Missing workers leave the answer safely in the pool.

**Wieder öffnen** reopens a question; editing the question, alternatives or linked issues also reopens it while preserving answer history. The top-right **✕** and **Esc** close each dialog through the standard office modal/focus flow.

## Worker command

The office puts `office-decisions` on worker PATH alongside `office-workers`. It uses the existing per-worker authenticated loopback hook, scopes all requests to that worker's project and never accepts a human answer through the hook.

```sh
office-decisions list
echo '{"title":"Choose release scope","question":"Include the optional tutorial in this release?","context":"Core gameplay is ready; the tutorial requires another pass.","options":["Ship core gameplay first","Wait for the tutorial"],"recommendation":"Ship core gameplay first","category":"Release","tags":["Scope"],"issues":[123],"blocking":true,"blockingReason":"The release scope must be settled before preparing the release."}' | office-decisions add
```

Use JSON on standard input (PowerShell supports a single-quoted JSON string piped to the command as well). Responses include stable IDs and revisions. Read the pool again before continuing dependent work; an answer only authorizes the scope it actually addresses.

## Storage and extension points

Entries are stored under the office data directory in `decisions/<project-hash>.json`, using atomic file replacement. Preserve this directory when migrating or backing up the office. Answer/edit requests require the latest revision; a stale tab cannot overwrite another person's update.

This feature owns its model, persistence, authenticated HTTP route, worker hook, launch prompt extension, client state, UI and world fixture. It plugs into the HTTP and hook route registries, the worker prompt extension registry, the office fixture plan and the HUD action registry. It does not modify queue state or dispatch policy.
