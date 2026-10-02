# DEV-013 — First sail upgrade

Status: planned. Phase: D. Branch: DEV-013-ship-upgrade. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Give expedition resources a visible, deterministic ship improvement.

## Readiness

DEV-012 merged; initial resource and speed tuning accepted for prototype. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Implement blueprint eligibility and atomic workshop purchase with documented cost.
2. Update vessel equipment and derived performance through authoritative rules.
3. Render the upgraded sail and explain its effect clearly.
4. Prevent repeat charges, unsupported equipment and stale concurrent purchases.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Eligible crew spends ten wood/four cloth/four metal once; upgraded sail persists; unsupported or repeated purchase cannot consume stock.

## Verification

Integration tests cover concurrent purchase/replay, insufficient supplies and restart. Verify speed calculation and visual state on multiple clients. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
