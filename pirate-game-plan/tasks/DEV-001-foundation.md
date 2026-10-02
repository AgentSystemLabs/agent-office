# DEV-001 — Repository and CI foundation

Status: planned; technically specified, operational prerequisites pending. Phase: A. Branch: DEV-001-foundation. PR target: stage.
Maintainer: sipelisdeividas. Implementation owner: coding assistant on a later coding instruction. Independent reviewer: pending.

## Purpose and scope

Create an isolated, reproducible project with enforceable review and build gates. No gameplay or public hosting.

## Readiness

Technical decisions D02–D05 are specified in [foundation](../foundation-spec.md), including exact versions, identity/contracts references, CI, device targets, and local-first hosting. Reviewer identity and private-repository protection entitlement D14/D15 remain open. No install, repository creation, purchase or code start has happened. This task becomes ready only after these prerequisites and the implementation-start instruction are recorded.

## Implementation steps

1. Preflight: verify repository name is available, private protections can be enforced, reviewer can approve, and intended owner/visibility match foundation-spec.md. Stop dependent setup rather than purchase access or publish code silently.
2. Create a documentation-only seed with stage/PROD at the same commit; set stage default, migrate/validate planning links, install the future AGENTS.md workflow, and create DEV-001-foundation from fetched stage in a worktree.
3. Use isolated Node 24.21.0/npm 11.21.0; create minimal npm workspaces and pin the selected direct packages. Validate peers without force/legacy flags and commit one frozen root lockfile. Record any reviewed compatibility substitution.
4. Implement strict ESM/typecheck, lint, meaningful foundation tests, build and documented local-only dev startup. Add minimal renderer, server health/config/shutdown behavior and Colyseus compile/connect smoke; no gameplay or public signup.
5. Define a local PostgreSQL 18.6 container without provisioning a remote host; pin verified image digests. Wire GitHub Actions Ubuntu/Windows checks and browser startup verification with no production secrets; pin reviewed action SHAs.
6. Protect stage/PROD, require independent review and correct CI contexts, resolve conversations and renew review after changes. Verify a safe failing-check PR cannot merge and an unapproved PR cannot merge. Capture evidence rather than claim enforcement by configuration intent.
7. Run clean-checkout commands from foundation-spec.md and inspect client/server output, shutdown and the local database startup. Record actual tool versions, browser screenshot, results, asset/dependency notices, startup guide and rollback impact.
8. Open the DEV-001 PR into stage, obtain independent review, fix findings, and squash-merge only after checks pass. Record stage SHA and staging verification; PROD promotion waits for an explicitly approved candidate with its own review.

## Acceptance

Fresh checkout installs and builds on the declared local/CI platforms; client renders with no console errors; server configuration errors reject and health/shutdown work; core/SDK smoke connects; local PostgreSQL image starts; failed CI or absent independent review prevents merge; no secrets or game behavior are added. The task must not change agent-office's toolchain or lockfile.

## Verification

Run npm ci, typecheck, lint, npm test, build, check:docs and foundation browser smoke as defined in foundation-spec.md. Integration tests become required when real persistence arrives; do not report an empty suite as evidence. Exercise a deliberately failing check and absent approval in safe test PRs; verify protections without bypass. Record versions, screenshots and configuration evidence. No CI/install/game test has run for the future project yet; registry/engine verification is planning evidence only.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
