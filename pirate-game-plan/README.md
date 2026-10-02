# Pirate game development plan

Last updated: 2026-10-02. Status: planning; no game code or infrastructure authorized yet.

The [main concept](../pirate-game-idea.md) describes the product and first expedition. This folder describes how to implement it in a future, separate game repository. These documents are currently delivered through agent-office's normal documentation PR workflow; the future game's branch rules do not replace this repository's AGENTS.md.

## Reading order and ownership

| Document | Owns |
| --- | --- |
| [Decisions](decisions.md) | Approval status, blockers, assumptions, and changes |
| [Architecture](architecture.md) | Module boundaries, data ownership, contracts, and structure |
| [Workflow](workflow.md) | DEV branches, mandatory review, stage integration, and PROD promotion |
| [Phases](phases.md) | Dependency order, playable milestones, and phase gates |
| [Task index](tasks/README.md) | One implementation document and branch per task |
| [Testing](testing.md) | Correctness, security, browser, performance, and recovery evidence |
| [Release operations](release-operations.md) | Environments, migration, deployment, rollback, and incidents |
| [Task template](tasks/TEMPLATE.md) | Required step-by-step task and completion records |

Keep product rules in the main concept, technical rules in architecture, task-specific implementation steps in the task files, and evidence in completed task records. Link instead of duplicating entire sections. A changed product rule must update affected tasks and tests in the same review.

## Definition of ready before coding

- Resolve coding blockers in decisions.md: repository, stack/version baseline, adult-test identity and hosting, component conventions, and persistence/network design.
- Every immediate task has one owner, bounded scope, approved dependencies, implementation steps, acceptance criteria, tests, and relevant risks.
- Enable protected branches, required CI, independent reviews, and environment separation in the future repository.
- Select the baseline device, supported browsers, and measurable performance targets.
- Agree how secrets, private data, generated content, and test accounts are handled.
- Approve phase A scope explicitly. Later phases do not start automatically.

The task sequence is documented, but task statuses remain **planned** until their readiness conditions are met. The main concept does not need every future town or warfare detail finalized to finish phase A planning. It does need clear initial scope and explicit exclusions.

## Implementation standard

One task, one DEV branch, one reviewed PR into stage. Keep code small and readable, use typed contracts and validated boundaries, and extract shared code only when there is real duplication. No speculative service platforms, giant controllers, or generic abstraction frameworks.

Documentation is part of completion: record actual implementation, verification, deviations, limitations, and merged commit. Never mark a task complete because code was generated or tests merely started.

## Next planning session

Resolve the blocking decisions, inspect the proposed architecture and task sizes, and make DEV-001 ready. Then approve a separate implementation start. This package is not a claim that branch protections, CI, hosting, or a child-safe launch already exist.
