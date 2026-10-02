# DEV-005 — Island, camera and input

Status: planned. Phase: B. Branch: DEV-005-island-client. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Render the starter island and third-person navigation using local fixtures. No authoritative economy yet.

## Readiness

DEV-002 merged; approve device, camera, modular assets and input conventions. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Build a small composition root with rendering, camera and input responsibilities separated.
2. Add spawn, four plots, dock, workshop, storage and readable landmarks using approved assets.
3. Implement character movement, interaction hints and clear keyboard/camera behavior.
4. Add accessible panels with close/Esc behavior that restores gameplay input.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Player navigates and identifies important locations; opening/closing UI leaves controls predictable; asset provenance is recorded.

## Verification

Browser tests cover movement/hints/focus; attach headless screenshots for island and panels. Record baseline frame-time/device observations and an adult camera usability check. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
