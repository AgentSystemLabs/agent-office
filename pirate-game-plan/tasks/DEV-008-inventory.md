# DEV-008 — Shared supplies and repair transactions

Status: planned. Phase: B. Branch: DEV-008-inventory. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Add shared stock, driftwood grants and ship repairs without duplication.

## Readiness

DEV-004 and DEV-006 merged; resource caps and repair rules confirmed. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Implement bounded inventory and server-owned resource costs using persistence operations.
2. Add the introductory starter/collection grants with permanent per-adventure grant IDs.
3. Connect stock display, supply collection and hull repair interactions; validate proximity.
4. Handle concurrent spending, full inventory, capped repairs and replay results.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Initial supplies match the concept; inventory never goes negative; reconnect/duplicate collection cannot mint supplies; invalid repairs consume nothing.

## Verification

Real-database concurrent spending and reward tests plus multi-client repair scenarios. Property/invariant checks cover bounds. Review transaction authority and audit evidence. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
