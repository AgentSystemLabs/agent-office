# Implementation task index

All tasks are **planned**, not implemented. DEV-001 is specified for implementation preparation in [foundation](../foundation-spec.md); PROD-default/disposable-stage policy is accepted and no paid GitHub plan is needed. A later implementation-start instruction is still required; assign an independent reviewer before merge. Branch names below explicitly target stage in the future pirate-game repository. Detailed steps, dependencies and acceptance evidence live in each file. Follow [workflow](../workflow.md); use the [template](TEMPLATE.md) when splitting or adding tasks.

| Task | Branch | Phase | Depends on |
| --- | --- | --- | --- |
| [DEV-001](DEV-001-foundation.md) | DEV-001-foundation | A | Implementation-start instruction; repository availability check during setup |
| [DEV-002](DEV-002-contracts.md) | DEV-002-contracts | A | DEV-001 |
| [DEV-003](DEV-003-persistence.md) | DEV-003-persistence | A | DEV-002 |
| [DEV-004](DEV-004-private-crews.md) | DEV-004-private-crews | A | DEV-003 |
| [DEV-005](DEV-005-island-client.md) | DEV-005-island-client | B | DEV-002 |
| [DEV-006](DEV-006-session-sync.md) | DEV-006-session-sync | B | DEV-004, DEV-005 |
| [DEV-007](DEV-007-sailing.md) | DEV-007-sailing | B | DEV-006 |
| [DEV-008](DEV-008-inventory.md) | DEV-008-inventory | B | DEV-004, DEV-006 |
| [DEV-009](DEV-009-manual-building.md) | DEV-009-manual-building | C | DEV-008 |
| [DEV-010](DEV-010-ai-planner.md) | DEV-010-ai-planner | C | DEV-009, provider decision |
| [DEV-011](DEV-011-construction-jobs.md) | DEV-011-construction-jobs | C | DEV-009, DEV-010 |
| [DEV-012](DEV-012-encounters.md) | DEV-012-encounters | D | DEV-007, DEV-008 |
| [DEV-013](DEV-013-ship-upgrade.md) | DEV-013-ship-upgrade | D | DEV-012 |
| [DEV-014](DEV-014-first-adventure.md) | DEV-014-first-adventure | D | DEV-011, DEV-013 |
| [DEV-015](DEV-015-recovery.md) | DEV-015-recovery | E | DEV-014 |
| [DEV-016](DEV-016-quality-performance.md) | DEV-016-quality-performance | E | DEV-015 |
| [DEV-017](DEV-017-parent-safety.md) | DEV-017-parent-safety | F | DEV-016, launch/privacy decisions |
| [DEV-018](DEV-018-pilot-release.md) | DEV-018-pilot-release | F | DEV-017 |

Phase E deepens and validates recovery; foundational tasks must already implement their own durable error handling. Never defer all security or persistence correctness until DEV-015/017.

Broad tasks such as DEV-012 or DEV-017 may need smaller numbered tasks after design review. Split before work begins if scope cannot be reviewed coherently. Reserve no implicit implementation authorization through task creation.
