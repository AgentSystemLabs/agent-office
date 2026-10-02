# DEV-012 — Wreck, fishing cove and beacon

Status: planned. Phase: D. Branch: DEV-012-encounters. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Implement the three bounded server-owned discoveries. Split into new tasks before coding if review scope is too large.

## Readiness

DEV-007 and DEV-008 merged; authored clues, interactions and rewards reviewed. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Add destination travel/anchor interactions and proximity loading with predictable bounds.
2. Implement three-crate wreck salvage and once-per-adventure shared reward.
3. Add the short fishing activity and one-time two-fish merchant exchange.
4. Implement visible beacon clues, solo-solvable levers, cosmetic rewards and labeled next-chart teaser.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

All encounters work solo or with friends; duplicate/restarted claims grant once; missing optional activities never prevent returning home.

## Verification

Deterministic puzzle/reward tests, simultaneous collection, merchant spending replay and browser flows. Attach destination screenshots and record repeated-visit behavior. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
