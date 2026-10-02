# DEV-011 — Construction jobs and builder animation

Status: planned. Phase: C. Branch: DEV-011-construction-jobs. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Reserve materials, complete construction and animate builders from durable job state.

## Readiness

DEV-009 and DEV-010 merged; cancellation/undo rules reviewed. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Create a job and resource reservation in one transaction after confirmation revalidation.
2. Implement bounded pending/running/completed/cancelled transitions with idempotent recovery.
3. Render progress, scaffolding and two builders; final collision geometry appears at completion.
4. Implement allowed cancellation/refund and bounded tutorial undo, rejecting delayed completion after cancellation.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

One confirmation spends once and builds once; cancellation refunds once; restart restores coherent job state; animation requires no per-tick AI calls.

## Verification

Crash/replay tests cover reservation, completion and refund boundaries with the real database. Multi-client/browser tests verify consistent progress and final geometry. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
