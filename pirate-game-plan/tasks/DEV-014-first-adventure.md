# DEV-014 — Tutorial and expedition flow

Status: planned. Phase: D. Branch: DEV-014-first-adventure. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Connect the existing systems into a coherent 20–25 minute target adventure without forced timers.

## Readiness

DEV-011 and DEV-013 merged; pacing and tutorial objectives reviewed. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Implement durable adventure objectives for repair, construction, departure, discoveries, return and upgrade.
2. Add contextual hints and an optional, telegraphed squall with at most 20 introductory hull damage.
3. Ensure manual-building fallback satisfies the tutorial and optional encounters remain optional.
4. Label the next-adventure teaser and record progression metrics without prompt text.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Solo/four-player adult testers complete the adventure without intervention; skipped optionals and unavailable AI do not deadlock progress.

## Verification

End-to-end browser and multi-client acceptance cover alternative order, fallback, squall avoidance and repeated objectives. Record observed pacing and confusion, not claimed retention. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
