# DEV-003 — Durable operations and storage

Status: planned. Phase: A. Branch: DEV-003-persistence. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Implement durable mutations and restore foundations with explicit transaction boundaries.

## Readiness

DEV-002 merged; implement D08 from [contracts/storage](../contracts-and-storage.md) with PostgreSQL 18.6 and a real temporary CI database. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Create minimal schema and migrations for identities/crews, inventory, operations, world versions, jobs and encounter grants.
2. Implement repository operations using atomic transactions, uniqueness and persisted operation results.
3. Add versioned snapshot/checkpoint restore and reconciliation of committed but unbroadcast operations.
4. Define reservation and deduplication retention; document migration and recovery behavior.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Replayed commands cannot repeat durable effects; interrupted transactions leave coherent state; representative saved worlds restore.

## Verification

Use a real ephemeral database. Inject failures before/after commit, concurrent duplicate requests and migration from a fixture. Verify constraints and a restore drill; define compatibility before rollback. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
