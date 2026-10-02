# DEV-017 — Parent-managed pilot safeguards

Status: planned. Phase: F. Branch: DEV-017-parent-safety. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Prepare a controlled children’s pilot. This is likely multiple tasks after detailed privacy design; split before implementation.

## Readiness

DEV-016 merged; D12 age/jurisdiction/provider/retention decisions and qualified review available. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Implement approved parent/account/consent and invitation flows with minimal data.
2. Add permissions, block/report, operator triage and defined human escalation coverage.
3. Implement retention, parent access/deletion and shared-world contribution handling across providers/storage.
4. Verify underage free-text eligibility, approved provider controls and child-facing explanations.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

No child enters an unapproved provider/data path; consent and revocation behave correctly; reporting/deletion work end-to-end with accountable operators.

## Verification

Use synthetic child/parent fixtures. Independent privacy/security review, consent/revocation tests, deletion audit and reporting drills are mandatory. Do not treat parental login as proof of all legal requirements. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
