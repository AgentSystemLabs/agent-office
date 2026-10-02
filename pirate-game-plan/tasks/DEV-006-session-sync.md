# DEV-006 — Authoritative room synchronization

Status: planned. Phase: B. Branch: DEV-006-session-sync. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Connect private clients to authoritative crew state and establish reconnect behavior.

## Readiness

DEV-004 and DEV-005 merged; use the selected Colyseus 0.18 baseline and [contracts/storage](../contracts-and-storage.md), with the foundation core/SDK compatibility smoke passing. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Install feature-owned handlers behind authenticated transport with bounded messages.
2. Synchronize membership, player movement, world version and authoritative inventory snapshots.
3. Add acknowledgments, safe client prediction/reconciliation and resync from known version.
4. Handle join/leave, helm ownership hooks, empty-room persistence and cleanup.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Four clients see consistent accepted state; foreign-room commands fail; reconnect cannot duplicate initialization or leak listeners.

## Verification

Automated multi-client tests exercise join/leave/reconnect, stale state, revoked membership, delayed acknowledgments and room disposal. Confirm authoritative validation precedes mutation. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
