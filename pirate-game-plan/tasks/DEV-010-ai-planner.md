# DEV-010 — Bounded AI planning adapter

Status: planned. Phase: C. Branch: DEV-010-ai-planner. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Translate requests into the existing approved plans. No unrestricted code, image upload or AI companion.

## Readiness

DEV-009 merged; D10 provider/model/data policy approved for intended testers. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Implement a provider adapter and deterministic fake for routine tests.
2. Minimize scene context; check input and validate output schema, components, bounds and unsupported requests.
3. Enforce durable quota, bounded attempts/timeouts, cancellation and server-side spending controls.
4. Connect targeted revisions, waiting/error display and manual/preset fallback; document evaluated model behavior.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Supported requests produce legal editable previews; malformed/refused/late results cannot mutate worlds; outage or exhausted quota preserves play.

## Verification

Fake-provider contract/security tests cover injection, oversized plans, timeout, retry budget and quota replay. Run approved adult synthetic-prompt live evaluation; record quality, cost and retention evidence. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
