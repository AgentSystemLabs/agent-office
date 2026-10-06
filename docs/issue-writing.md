# Writing issues for triage

Back to [Issue triage](triage.md).

How to write a GitHub issue, by hand or by asking an agent, so triage classifies it well and a worker can act on it without asking anything.
Triage only sees the issue's title, body, author, labels and its last 10 comments, plus the repo's description, areas and top-level folders.
Anything not written there doesn't exist for it.

## The one rule

Write the issue for a capable engineer who has never seen the project and can't ask you questions.
If they could open a pull request from the issue alone, triage will usually call it agent-ready.

## Template

```markdown
## Goal
One or two sentences: what should be true when this is done.

## Current behavior
What happens now. For a bug: exact error, status code, or output.

## Expected behavior
What should happen instead, concretely.

## Where
Files, functions, endpoints or pages involved, as paths: `api/server.js`, `GET /users/:id`.

## How to reproduce / verify
Commands or steps. For a feature: how a reviewer checks it works.

## Out of scope
What not to touch, if it matters.
```

Skip sections that don't apply, but never skip Goal, Where and How to verify.

## What each triage question looks for

| Question | Helps it | Hurts it |
| --- | --- | --- |
| Agent-ready | A clear end state, file paths, repro steps, a way to verify | "Make it better", "look into", open questions, "we should discuss" |
| Type | A title that says what kind it is: "Fix…", "Add…", "Document…", "How do I…?" | Mixing a question, a bug and a feature in one issue |
| Size | Saying how far the change reaches: one file, one endpoint, one page | Lists of loosely related asks; "and also…" |
| Priority | Stating impact: who is affected and how badly ("all logins fail", "cosmetic") | Urgency words with no impact ("ASAP!!") |
| Area | Naming the folder or component, using the floor's area names when you know them | No location at all |
| Needs a human | Being explicit when it touches secrets, billing, data deletion, security or a product decision | Hiding those parts in a vague request |
| Cross-repo | Naming the other repo (`owner/repo`) when it needs changes there | Implying it ("the mobile app needs this too") without saying which repo |

## Rules of thumb

- **One issue, one change.** Split anything that would be more than one pull request; triage labels big ones `triage:split-me` and won't queue them.
- **Title as an imperative or a symptom.** "Return 404 for unknown user id", or "GET /users/:id returns 200 for unknown id". Not "API problem".
- **Paths in backticks.** `ui/index.html`, `#save`, `POST /users/:id`. They match areas and folders directly.
- **Exact output, not paraphrase.** Paste the error, status code or log line.
- **Say how to verify.** A command, a curl, a test name, or a click path. Workers are told to verify before opening a PR.
- **Keep the body under about 20,000 characters.** Triage cuts the rest. Link big logs instead of pasting them.
- **Questions are fine, but label-only.** An issue that asks "how do I…" is classified as a question and never queued; if you want a change, ask for the change.
- **Be honest about risk.** If it touches credentials, payments, deleting data or security, say so: triage stops it for a human, which is what you want.

## Don't

- **Don't add `type:`, `area:`, `size:`, `prio:` or `triage:` labels yourself.** Triage owns those; a hand-set one opts the issue out until someone clicks Re-classify. Other labels are fine.
- **Don't put the task in a comment and leave the body vague.** Comments count, but only the last 10, and the body weighs most. Edit the body instead.
- **Don't write instructions to the agent in the issue that bend its process** ("skip the tests", "push straight to main"). Workers read the issue; keep it about the change.

## After triage asks for detail

A `triage:needs-detail` issue gets one comment asking for more.
Edit the body (or add a comment) with the missing Goal, Where or How to verify.
Any change to the title, body, comments or your own labels has triage look at it again by itself; no need to click anything.

## Asking an agent to file an issue

Paste this to the agent, or put it in its instructions:

```text
When you open a GitHub issue (gh issue create), follow docs/issue-writing.md in the agent-office repo:
- Title: imperative ("Fix…", "Add…") or the exact symptom; under 80 characters.
- Body sections: Goal, Current behavior, Expected behavior, Where (file paths in backticks), How to reproduce / verify, Out of scope (if needed).
- One change per issue; split anything bigger than one pull request into separate issues and link them.
- Read the code first so "Where" names real files, functions or endpoints.
- State impact plainly (who is affected, how badly), and say explicitly if it touches secrets, billing, data deletion, security or needs a product decision.
- If another repo must change too, name it as owner/repo.
- Never add type:, area:, size:, prio: or triage: labels.
- Show me the title and body before creating it.
```

## Example

Bad:

```markdown
Title: Save broken
The save thing doesn't work, can someone fix it? Probably the API.
```

Good:

```markdown
Title: Save button on the landing page does nothing

## Goal
Clicking Save persists the user's name through the API.

## Current behavior
`ui/index.html` has `<button id="save">` with no handler; clicking it does nothing and sends no request.

## Expected behavior
Clicking Save sends `POST /users/1` with `{"name": "<input value>"}` and shows "Saved" on success.

## Where
- `ui/index.html`: add the click handler.
- `api/server.js`: add `POST /users/:id`, update the in-memory user, return it as JSON (404 for unknown id).

## How to verify
`node api/server.js`, then `curl -X POST localhost:3000/users/1 -d '{"name":"Bo"}'` returns `{"id":1,"name":"Bo"}`; clicking Save in the page shows "Saved".
```

Run through Jev, the first scored 11% agent-ready (`needs-detail`) and the second 92% (queued).
The same request written as two plain sentences, with the right files but no sections, scored 70%: still not queued at the 0.85 threshold.
