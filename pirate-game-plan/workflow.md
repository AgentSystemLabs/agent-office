# Branch, review, and promotion workflow

Applies to the future pirate-game repository. This planning PR still follows agent-office's existing main-branch policy.

## Branch roles

| Branch | Purpose | Updates |
| --- | --- | --- |
| PROD | Released production history | Reviewed promotion PR from stage |
| stage | Integrated candidate, deployed to staging | Reviewed DEV task PRs |
| DEV-001-foundation, DEV-002-contracts, etc. | One bounded implementation task | Its assigned owner in an isolated worktree |

Use `DEV-` literally, uppercase, followed by the immutable task number and a short slug. Task IDs are never reused. If a task is too broad for coherent review, split it into new numbered task documents before coding.

Initialize stage and PROD at the same approved foundation commit. New task branches start from freshly fetched origin/stage. Never use another person's working checkout, stash their edits, or commit unrelated changes.

## Task lifecycle

1. **Planned:** task document exists; assumptions or dependencies may remain.
2. **Ready:** dependencies are merged to stage, scope and acceptance criteria are approved, owner and reviewer are identified.
3. **In progress:** create the DEV branch/worktree; implement the documented steps.
4. **In review:** open a PR targeting stage, attach evidence, request independent review.
5. **Integrated:** squash-merge the task PR after required checks and approval; record merged stage SHA.
6. **Stage verified:** staging acceptance and regression checks pass for the candidate containing the task.
7. **Released:** a reviewed stage-to-PROD promotion includes the task; record release and deployed artifact.

Keep this status and actual steps in the task document. PR descriptions link it and explain behavior, validation, known limitations, migrations, and rollback. Update documentation as part of the task, not in an unspecified future cleanup.

## Development steps

- Fetch stage and create the named branch in a worktree.
- Implement the smallest end-to-end behavior with tests of important boundaries and failures.
- Run the required checks and attach results. Record commands, tool versions, environment, relevant scenario, and artifacts.
- Open the task PR, request review, and fix findings. Re-run affected checks after meaningful changes.
- Fetch current stage and resolve conflicts so existing behavior survives. Use the chosen merge/rebase policy consistently; new diffs invalidate relevant prior review.
- CI must validate the prospective merged result or a merge-queue candidate, not only an old branch head.
- Squash-merge through the platform. Preserve the DEV ID in the title and commit message.
- Verify staging and update the task status. Remove the branch/worktree only after confirming no uncommitted work is being lost.

## Mandatory review

Every implementation needs at least one independent qualified reviewer. The author cannot approve their own change. AI review may assist, but does not replace accountable independent approval. If only one developer is available, arrange external review; do not silently waive the rule.

Require domain-aware review for inventory, ownership, persistence, invitations, AI execution boundaries, child data, billing, migrations, and infrastructure. Involve a security/privacy specialist where needed; generic style review is insufficient.

Reviewer checklist:

- Acceptance criteria are met with useful evidence and no hidden scope expansion.
- Server authority, authorization, idempotency, and persistence hold on failure paths.
- Code follows module boundaries; names are clear; dependencies and abstractions earn their cost.
- Tests exercise behavior and regressions, not private implementation shape or trivial getters.
- No secrets, child data, unsupported arbitrary code, or unbounded work enter the system.
- Performance implications, migrations, rollout, and recovery are understood.
- Task and user/operations documentation match the final implementation.

Review findings must be resolved or explicitly accepted by the responsible reviewer with rationale. Critical/high security issues and failing required checks block merge.

## Branch protections and CI

Configure stage and PROD to reject direct pushes, force pushes, and deletion; require reviews, resolved conversations, successful required checks, and review renewal after relevant changes. Minimize administrative bypass. Until configured and verified, these are requirements, not guarantees.

PR CI includes frozen-lockfile install, typecheck, lint, relevant tests, build, and applicable integration/browser checks. Full release checks are in testing.md. Privileged credentials must not be exposed to untrusted PR code; reviewed deployment pipelines use environment-scoped credentials.

## Promotion to PROD

1. Select and freeze a stage commit for release. Pause stage merges during the short promotion window, or create an explicitly approved release-isolation workflow if this becomes impractical.
2. Build the candidate once and assign its artifact digest, commit SHA, schema version, and configuration version.
3. Deploy that exact artifact to staging; run release acceptance, migration/recovery checks, and applicable performance tests.
4. Open the stage-to-PROD PR with included DEV IDs, test evidence, deployment plan, and rollback plan.
5. Obtain independent review and deployment approval. Any stage changes require a new candidate and affected checks.
6. Merge using a **merge commit**, not squash or rebase, to preserve the stage ancestry. Task PRs remain squash merges; release promotion is different.
7. Deploy the already verified artifact after checking that PROD's source tree matches the candidate source tree. A promotion merge SHA may differ; never silently rebuild different code for production.
8. Run smoke checks, monitor, then mark included tasks released and tag the release.

Keep branches aligned through regular promotions. Squashing stage into PROD would obscure shared ancestry and complicate later promotions. If platform merge settings cannot express both policies, configure/review that before the first release.

## Hotfixes and reversals

Normally implement fixes as new DEV tasks from stage, review, verify, and promote. If unreleased stage work prevents an urgent fix, branch a new DEV hotfix from PROD, use a reviewed temporary hotfix release branch and the same test/deployment gates, then promptly merge the resulting PROD history into stage through a reconciliation PR. Record this exception; do not cherry-pick silently or bypass review.

Prefer a reviewed revert for a bad integrated change. Production rollback follows release-operations.md and never assumes destructive database migrations can be reversed safely.
