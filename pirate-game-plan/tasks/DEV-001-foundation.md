# DEV-001 — Repository and CI foundation

Status: planned; specification and branch policy ready for implementation preparation. Phase: A. Branch: DEV-001-foundation. PR target: stage.
Maintainer: sipelisdeividas. Implementation owner: coding assistant on a later coding instruction. Independent reviewer: pending.

## Purpose and scope

Create an isolated, reproducible project with documented manual review and build checks. No gameplay or public hosting.

## Readiness

Technical decisions D02–D05 are specified in [foundation](../foundation-spec.md), including exact versions, identity/contracts references, CI, device targets, and local-first hosting. D14 confirms PROD as default/main, disposable stage and manual checks without paid GitHub plans. Verify repository availability during setup and assign an independent reviewer before merge under D15. No install, repository creation, purchase or code start has happened; implementation still requires a later start instruction.

## Implementation steps

1. Preflight: verify repository name is available and intended owner/private visibility match foundation-spec.md. Record the manual merge checklist; no paid-plan upgrade or protection-entitlement check is needed.
2. Create a documentation-only seed with stage/PROD at the same commit; set PROD default, migrate/validate planning links, install the future AGENTS.md workflow, and create DEV-001-foundation from fetched stage in a worktree. Explicitly target stage in task PRs.
3. Use isolated Node 24.21.0/npm 11.21.0; create minimal npm workspaces and pin the selected direct packages. Validate peers without force/legacy flags and commit one frozen root lockfile. Record any reviewed compatibility substitution.
4. Implement strict ESM/typecheck, lint, meaningful foundation tests, build and documented local-only dev startup. Add minimal renderer, server health/config/shutdown behavior and Colyseus compile/connect smoke; no gameplay or public signup.
5. Define a local PostgreSQL 18.6 container without provisioning a remote host; pin verified image digests. Wire GitHub Actions Ubuntu/Windows checks and browser startup verification with no production secrets; pin reviewed action SHAs.
6. Document independent review, current-candidate checks and explicit release approval as manual merge requirements. Record CI contexts and local-equivalent evidence when free CI is unavailable. Walk through a failing-check/unapproved PR and confirm the maintainer holds it without merging; do not claim GitHub blocks the button. Document and rehearse stage snapshot/recreation in a disposable test repository.
7. Run clean-checkout commands from foundation-spec.md and inspect client/server output, shutdown and the local database startup. Record actual tool versions, browser screenshot, results, asset/dependency notices, startup guide and rollback impact.
8. Open the DEV-001 PR into stage, obtain independent review, fix findings, and squash-merge only after checks pass. Record stage SHA and staging verification; PROD promotion waits for an explicitly approved candidate with its own review.

## Acceptance

Fresh checkout installs and builds on the declared local/CI platforms; client renders with no console errors; server configuration errors reject and health/shutdown work; core/SDK smoke connects; local PostgreSQL image starts; PROD is default and stage recovery is documented and verified; maintainer does not merge with failed checks or absent independent review; no paid GitHub plan, secrets or game behavior are added. The task must not change agent-office's toolchain or lockfile.

## Verification

Run npm ci, typecheck, lint, npm test, build, check:docs and foundation browser smoke as defined in foundation-spec.md. Integration tests become required when real persistence arrives; do not report an empty suite as evidence. Exercise a deliberately failing check and absent approval in safe test PRs; record the manual hold. Verify PROD default, explicit stage PR targeting and snapshot-based stage recreation, including an unpromoted squash-merged task. Record versions, screenshots and configuration evidence. No CI/install/game test has run for the future project yet; registry/engine verification is planning evidence only.

## Actual implementation record

Not started. Record actual files/modules, steps completed, deviations, commands/results, evidence, review findings/resolutions, limitations, task PR, merged stage SHA, stage verification, release ID and artifact digest here during implementation.
