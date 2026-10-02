# DEV-004 — Authenticated private crews

Status: planned. Phase: A. Branch: DEV-004-private-crews. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Admit one to four authorized adult testers with crew/plot ownership. Children’s onboarding comes later.

## Readiness

DEV-003 merged; settle D06 adult identity, invitations, expiration and role rules. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Implement the approved session identity and authentication boundary.
2. Create crew membership, capped admission, expiring/revocable invitations and personal plot assignments.
3. Enforce owner/builder/visitor authorization in server services and handle revocation of active sessions.
4. Implement one-time crew starter grants and membership visibility.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Foreign or revoked members cannot mutate a crew; join/reconnect grants no extra stock; invitations cannot silently admit a fifth member.

## Verification

Test unauthorized, expired, reused and revoked credentials, competing fourth-seat admissions, logout and starter-grant replay. Review identity/session security independently. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
