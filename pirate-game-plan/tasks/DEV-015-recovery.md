# DEV-015 — Expedition fault and recovery hardening

Status: planned. Phase: E. Branch: DEV-015-recovery. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Verify cross-feature recovery and close remaining failure gaps; do not postpone basic safety to this task.

## Readiness

DEV-014 merged; core features already implement transaction correctness. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Create a fault matrix spanning boat, room, provider, database and construction.
2. Implement recoverable sinking with preserved tutorial cargo/design and non-farmable repair assistance.
3. Verify empty-room pause, safe resume, disconnected players and pending jobs.
4. Document restore/reconciliation procedures and record observed maximum lost transient movement.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Every documented introductory failure has a usable recovery path; no duplicated rewards, orphaned materials or offline storm damage.

## Verification

Crash injection and real persistence restart suite, multi-client disconnects and restore rehearsal. Attach evidence for each fault-matrix row and review recovery changes independently. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
