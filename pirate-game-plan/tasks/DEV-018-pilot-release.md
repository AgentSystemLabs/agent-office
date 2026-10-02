# DEV-018 — Reviewed staging-to-PROD pilot release

Status: planned. Phase: F. Branch: DEV-018-pilot-release. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Prepare deployment/operations and a small consented pilot; not an unrestricted commercial launch.

## Readiness

DEV-017 merged; selected capacity, operators, deployment approvals and review available. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Implement protected release automation, immutable artifact promotion and separate environment configuration.
2. Verify migrations, session draining, smoke tests, backups and rollback/reconciliation.
3. Run the complete staging release gate and document included DEV tasks, candidate and artifact.
4. Open reviewed stage-to-PROD promotion, deploy the verified artifact, monitor and record pilot findings.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Deployment uses verified source/artifact; operators can contain an incident and restore safely; pilot admission remains below tested capacity.

## Verification

Staging rehearsal plus production smoke checks, budget/reporting alerts and restore drill. Record independent review/deployment approval, release tag/digest, rollout results and follow-up tasks. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
