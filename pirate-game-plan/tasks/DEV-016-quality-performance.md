# DEV-016 — Security, performance and adult acceptance

Status: planned. Phase: E. Branch: DEV-016-quality-performance. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Measure the complete adult-test candidate and fix observed bottlenecks with bounded scope.

## Readiness

DEV-015 merged; baseline hardware, scenarios and budgets selected. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Run full correctness, adversarial authorization, provider boundary and dependency/secret checks.
2. Profile frame/tick times, network, database contention, queue behavior and empty-room cleanup.
3. Run the approved multi-room experiment and soak with synthetic accounts and spend caps.
4. Optimize measured bottlenecks; record before/after evidence and repeat affected regression checks.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Approved device/scenario budgets pass; no unresolved critical/high issues; measured capacity and headroom support a bounded adult test.

## Verification

Follow testing.md, including two-hour initial soak and four-client adventure acceptance. Separate automated results from adult usability observations; record limitations and release blockers. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
