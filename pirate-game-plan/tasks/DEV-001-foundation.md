# DEV-001 — Repository and CI foundation

Status: planned. Phase: A. Branch: DEV-001-foundation. PR target: stage.
Owner: unassigned. Independent reviewer: unassigned.

## Purpose and scope

Create an isolated, reproducible project with enforceable review and build gates. No gameplay or public hosting.

## Readiness

Resolve D02–D05; identify repository owner, maintainer, reviewer, baseline device, and host. Read [workflow](../workflow.md), [architecture](../architecture.md), and [testing](../testing.md). This task is not ready until dependencies and decisions are recorded as satisfied.

## Implementation steps

1. Initialize the separate repository with approved stage/PROD history, license policy, planning docs and DEV branch conventions.
2. Pin compatible supported tools, commit one lockfile, and implement frozen installs, typecheck, lint, test and build commands.
3. Create minimal client/server entry points and documented local configuration using fake external adapters.
4. Configure and verify protected branches, required checks, reviewer permissions and separate environment secrets.
5. Update this task with actual steps/deviations and submit its stage PR with verification evidence and recovery/rollback impact.

## Acceptance

Fresh checkout installs and builds; failed CI or absent independent review prevents a task merge; no secrets are committed.

## Verification

Run the documented commands on the chosen CI and local platforms. Exercise a deliberately failing check in a safe test PR; verify protections without bypass. Record versions and configuration evidence. Required baseline checks: frozen install, typecheck, lint, relevant tests and build. Run applicable browser checks and record evidence; do not claim results before execution.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
