# AI Office architecture

The first slice adds an organizational layer around the existing building. A floor still owns one project checkout and its workers, queue and boards. No worker or floor record is rewritten.

```
OfficeZone (training | main)
  └── Department
        └── Floor (project checkout)
              └── Worker (running session)
```

## Boundaries

- Zones and departments are persistent, versioned metadata owned by the office, not by a floor. Their defaults are installed once: Training Campus with its seven logical labs, and Main Office with its eleven departments.
- A floor has one department assignment. Existing floors without an assignment resolve to Main Office / Software Engineering. Assignment does not move a checkout or change its workers.
- Client navigation selects a zone and department and uses the existing `floor.go` path for travel. The selected zone is a browser view preference, not an execution boundary.
- The new HTTP API uses the existing signed session. Reads are available to signed-in users; only office admins can change department or floor assignments. The server derives the actor from the session.
- Provider, model, role, AgentProfile, worker and task remain distinct concepts. AgentProfiles, evaluation, promotion and routing belong to later slices.

## Persistence and migration

`zones.json` stores a schema version, zone/department definitions and floor assignments in the office data directory. The server validates it on load and writes a replacement file before renaming it into place. An absent file is initialized with defaults. Existing floors are resolved to Main Office / Software Engineering without editing `floors.json`; new and removed floors are reconciled by ID. Reloading does not duplicate defaults or assignments.

Department and floor-assignment edits append an actor-derived audit record in the same atomic metadata write. The audit records are not exposed in the navigation response.

Malformed or unsupported metadata must fail closed with a logged error. It must not overwrite the saved file or silently move a floor. Keep all original floor, worker, queue, account and worktree files untouched.

## Security boundary

Training Campus is an organizational view in this slice. Existing git worktrees isolate checkouts and branches, but all worker processes still run as the same OS user. Training agents must not be treated as sandboxed. The Sandbox Lab needs an execution boundary, credential separation, resource limits and enforced tool policy before untrusted agents run there. Promotion remains unavailable until evaluation, security review and human approval are implemented.

## Delivery sequence

1. Zones, departments, metadata store and legacy floor resolution.
2. Authenticated API and 3D/`/lite` navigation over the current floor travel path.
3. Persistent AgentProfiles and project stages.
4. Evaluation, promotion, approval and audit records.
5. Department orchestration and assisted routing.

Each slice keeps the existing protocol and floor behavior valid and is verified with typecheck, tests, build and a browser screenshot for UI changes.
