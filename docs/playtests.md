# Playtest checklist

The rolling board left of the couch shows six sections: **Allgemein, RB, RIFT, Rooftop,
Safe Zone, Gas Station**. Press **E** at the board or open **☰ → Playtest checklist**.
Each project has a shared checklist for people's next play session. These entries never hire
workers, enter the task queue or block PR merges.

## Finding and recording checks

- Choose a mode or **Alle**. A check can belong to several modes but remains one record.
  Allgemein holds common checks such as audio. Existing records get suggested categories from
  their text; **Bearbeiten** lets you correct them. Explicit categories always take precedence.
- Filter by **Solo**, **Lokaler Koop** or **Online-Koop**, search text, or select a result.
  No play-style restriction means all styles. Within each mode, checks are grouped by topic,
  such as Audio, Waffen and Zombies.
- Expand **Anleitung & Ergebnis** for preparation, steps, expected result and the source issue/PR.
- Record **Offen**, **Bestanden**, **Fehler gefunden** or **Nicht testbar**, along with observations.
  Passed/failed results require the build actually played (or explicitly `unbekannt`). A history
  records up to 200 result changes with build, person and time. Old checkmarks retain their identity,
  notes and dates; no historic build number or test run is invented.
- **Fehler melden** shows possible existing issues and sends a report to the floor's Issue agent.
  Save the result/build first. The agent must check duplicates and create or update the matching bug;
  it may not enqueue it or start workers. Busy agents reject the handoff instead of being interrupted.
- **Auswahl exportieren** exports the current filters as Markdown. **Aktualisieren** reloads the list.
  Notes are only stored when saved or when recording a result. Closing any dialog with ✕ or Esc
  uses the Office's standard modal/focus handling.

## Moving manual tests out of issues

Use **☑ Playtests aussortieren** at the Issue agent, **Issues aussortieren** in the checklist,
or the corresponding button in an issue window. Scanning reads all open GitHub issues without
changing them. Each proposal previews every unchecked criterion:

- **→ Playtest:** a clearly identified human check.
- **Bleibt: Entwicklung/Doku:** implementation, documentation or automated tests.
- **Bleibt: unklar:** ambiguous wording, multiline criteria, or unclear work.

Review the proposal, then press its transfer button. Pure manual-test issues are closed only
after the checklist entries and a recovery receipt have been saved. Mixed issues stay open;
only the transferred checkboxes become references to checklist IDs. This never marks tests passed.
For example, #68's headset checks can move while its `Docs/RIFT_DESIGN.md` update stays an issue task.
A reference to a headset alone is insufficient: producing Store screenshots is development work.
The conservative classifier may miss checks; edit unclear criteria before scanning again.

Changes to an issue after the preview require another scan. Active queue work blocks transfer.
Retries reuse matching title/source entries and preserve human results. GitHub timeouts retain
the local checklist and receipt so an accepted remote write can be recognized on retry. Waiting
queue entries for an issue are removed after its closure is verified; no new work is dispatched.
GitHub edits are re-read before and after writing, but GitHub offers no transactional lock against
another editor changing the issue at exactly the same time.

This workflow does not waive missing implementation, code-review findings, builds or automated tests.
New default Issue-agent, worker and meeting prompts separate manual checks from implementation.
Previously customized prompts remain under the owner's control and may need this instruction added.

## Storage and API

Checklist data: `<project>/.agent-office/playtests.json`. Transfer receipts:
`playtest-transfer-<issue>.json` in the same directory. Receipts include the original issue text for
recovery. Back up the directory. Atomic file replacement and item revisions prevent partial writes
and stale browser edits. A damaged checklist is never silently replaced. There is no new automation
or background GitHub migration.

Workers use `office-playtests list` and `office-playtests add` (JSON on stdin) with their existing
floor credentials. They can add/list entries, never mark human results or edit personal notes:

```sh
office-playtests add <<'EOF'
{
  "title": "Rift portal after recenter",
  "category": "Tracking",
  "modes": ["RIFT"],
  "playStyles": ["solo", "local-coop"],
  "setup": "Start a Rift run on the headset.",
  "steps": "Recenter, then remove and put on the headset.",
  "expected": "The portal remains anchored to its wall.",
  "source": "https://github.com/owner/repository/pull/123"
}
EOF
```

Browser API: `/api/playtests?floor=<id>` (GET, POST `add`/`update`),
`/api/playtests/triage?floor=<id>` (POST `scan`/`apply`) and
`/api/playtests/bug?floor=<id>` (POST). Session authentication and same-origin checks protect writes.
Triage uses the signed-in person's GitHub identity and that floor's repository. Worker API:
`/office/playtests`, GET or POST `add`, authenticated by worker ID/token on the loopback hook server.
