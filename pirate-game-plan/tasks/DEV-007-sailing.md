# DEV-007 — Starter sloop and passenger movement

Status: planned. Phase: B. Branch: DEV-007-sailing. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Implement one tested hull, exclusive helm, docking and safe passengers. Weapons and arbitrary hulls are excluded.

## Readiness

DEV-006 merged; ship-local coordinate and motion decisions reviewed. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Implement bounded server-owned throttle/steering and client prediction for one hull.
2. Add exclusive helm occupancy and release on leave/disconnect.
3. Implement ship-relative passengers, dock boarding, anchoring and return-to-deck rescue.
4. Tune nearby sailing distances and document movement limits and fallback if passenger physics fails.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

One to four players sail and dock; no two captains control the helm; passengers remain stable through turns and rescue.

## Verification

Multi-client tests cover competing helm claims, driver disconnect and passenger reconciliation. Attach screenshots and short adult steering checks; record tick/frame/network costs. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
