# DEV-002 — Domain and network contracts

Status: planned. Phase: A. Branch: DEV-002-contracts. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Define small feature-owned schemas and shared conventions. Do not implement a generic protocol framework.

## Readiness

DEV-001 merged; resolve D07 and confirm private-session scope. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Specify Crew, Member, Plot, Vessel, Inventory, BuildPlan, ConstructionJob and encounter/progress identifiers.
2. Set units, coordinate frames, versions, operation IDs, error results and initial command DTOs.
3. Add runtime validation and message-size limits; compose schemas at a small transport boundary.
4. Document version compatibility and clear separation of client intent from server-owned state.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Invalid payloads and unknown versions reject consistently; client cannot declare balances, rewards or authorization; imports do not create cycles.

## Verification

Contract tests cover malformed, oversized and foreign identifiers. Pure tests verify important bounds. Review contracts before persistence/network implementation. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
