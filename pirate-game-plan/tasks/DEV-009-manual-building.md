# DEV-009 — Manual previews and safe placement

Status: planned. Phase: C. Branch: DEV-009-manual-building. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Provide manual shed placement and reusable preview validation before adding AI.

## Readiness

DEV-008 merged; D09 assets/components and initial costs approved. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Define the small component catalog, legal dimensions, editable parameters and material quotes.
2. Implement server-validated preview/version binding and client ghost placement/rotation.
3. Check plot permission, geometry bounds, collision, dock clearance and quote expiry.
4. Introduce confirm/cancel entry points and tested preset fallback without exposing arbitrary code.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Players can preview a supported shed; foreign, expired or obstructed placements reject without spending; supported edits keep predictable costs.

## Verification

Geometry and permission tests include stale versions and changed membership. Browser screenshots cover legal/illegal previews; record placement complexity caps. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
