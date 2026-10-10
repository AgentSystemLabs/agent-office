# Playtest checklist

Open **☰ → Playtest checklist**. Pin it from the menu to keep it on the top bar.
This is a project's list for a person's next play session, separate from the worker task queue.
Unchecked entries do not hold issues open, prevent PR merges, hire workers or dispatch work.

Each entry contains a title, category, instructions, expected result, optional HTTPS source link and notes.
Search or filter by category and **Still to test / Checked off / All tests**. Expand a row to read the steps
and save notes, such as the build you played or a bug you noticed. Check the box when you have tried it;
uncheck it to revisit it. A checkmark records who checked it and when, not an automated test result.
Use **Add test** or **Edit test** to maintain the list, and **Export** for a Markdown copy.
Refresh retrieves changes added by other people or agents. Unsaved notes remain local until saved.

The list is shared by people signed into that Office floor and stored in
`<project>/.agent-office/playtests.json`. Back up this file with the rest of the Office data.
Writes are atomic; a damaged file raises an error rather than being replaced with an empty list.
Edits include a revision so a stale browser cannot silently overwrite someone else's change.
There is no background polling, new automation or GitHub issue creation.

## Worker handoffs

Workers have an `office-playtests` command on their PATH, authenticated with their existing Office
credentials. It always targets their own floor. They can list or add tests, never check off tests or
edit a person's notes. Repeating the same title and source returns the existing entry, preserving checks.

```sh
office-playtests list
office-playtests add <<'EOF'
{
  "title": "Recenter during a Rift run",
  "category": "VR",
  "steps": "Start a run, recenter, remove and put on the headset.",
  "expected": "The portal remains anchored to its wall.",
  "source": "https://github.com/owner/repository/pull/123"
}
EOF
```

For a project that defers manual playtesting to its owner, tell workers to put optional gameplay and
headset checks here, record that they were not performed, and continue implementation and PR work.
This does not waive build failures, code review findings, automated test failures or missing features.
The feature itself does not change any repository's acceptance policy.

The session-authenticated browser endpoint is `/api/playtests?floor=<id>` (GET, POST `add`/`update`).
Browser writes require the Office origin. The worker endpoint is `/office/playtests` on the loopback
hook server (GET or POST `add`, with the existing worker ID and bearer token). Never put tokens in prompts.

## The board in the room

A second rolling whiteboard stands opposite the drawing board, left of the couch when looking into the office. It shows checked/total counts and the first six tests (open first). Walk up and press E to open the same checklist as the menu. Saving in the checklist updates the board immediately; other browsers refresh it every 30 seconds while visible. Switching floors clears the previous project immediately. A failed refresh is shown on the board, never as an empty completed list. The drawing whiteboard is unchanged.

## Report a failed playtest

Expand a test and click **Create Bug Issue**. Describe what went wrong (required), then click
**Send to Issue agent**. The agent receives the test's reproduction steps, expected outcome, source,
your current notes (including unsaved notes) and your failure description. It creates a bug issue,
or adds the report to an existing matching bug, and returns the issue URL in its terminal.
The button confirms delivery to the agent, not that GitHub has already created the issue.

Reporting does not check off the test, close an issue, enqueue work or assign a worker. Only the
human decides which issues run and when. The Issues agent's queue writes are rejected by the server.
Retries of the same report are deduplicated; an uncertain handoff asks you to check the agent's
terminal before resending. Empty descriptions, stale test revisions and cross-origin writes are rejected.

The same server restriction prevents the Issues agent from hiring, prompting or removing workers through office-workers. Human controls and other worker roles keep their existing permissions.
