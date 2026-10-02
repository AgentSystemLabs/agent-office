# Phases and integration gates

Task IDs and detailed steps are in [tasks](tasks/README.md). A task may be ready only after its dependencies merge to stage. Each phase ends with a reviewed playable candidate and documented evidence; completion does not automatically approve the next phase.

| Phase | Tasks | Playable outcome | Gate |
| --- | --- | --- | --- |
| A: foundations | DEV-001–004 | Protected repo/CI, contracts, durable storage, private crew identity | D02–D08 resolved; identity, authorization and transaction tests pass |
| B: movement and sailing | DEV-005–008 | Four adults can join, move, sail, dock and use shared supplies | Stable passengers, safe reconnection, inventory concurrency evidence |
| C: construction | DEV-009–011 | Manual/AI preview, approval, reservation and animated building | No duplicate spending, unauthorized edits, arbitrary code or provider-driven blocking |
| D: expedition | DEV-012–014 | Wreck/cove/beacon, upgrade and coherent first-adventure flow | Solo and four-player completion with bounded, recoverable rewards |
| E: recovery and quality | DEV-015–016 | Reliable adult-test candidate with measured performance | Restart/fault tests, security checks, soak evidence and adult usability pass |
| F: controlled child pilot | DEV-017–018 | Parent-managed consented pilot with approved capacity | Privacy/provider requirements, reporting, deployment/recovery and review complete |

Parallel implementation is possible only for ready tasks with clear ownership and boundaries. The workflow does not require parallel agents or delegation. Do not merge unfinished dependencies as placeholders just to unblock downstream branches.

## Later phases, not ready tasks

- **G: naval PvP:** zone eligibility, matching, weapons, damage, fair defeat, anti-farming, and recovery. Prototype separately; decide audience first.
- **H: charts and raids:** expiring opportunities, defender availability, warning, limited stakes, controlled harbor instance, cooldowns, and harassment prevention.
- **I: settlements and events:** temporary outposts, town ownership, leadership, seasons, scripted volcanoes, and expanded operations.

Create individual DEV task documents for these phases after their rules are accepted. Do not invent implementation detail for unsettled PvP or public-community mechanics.

## Exit review

For each phase, record included task/PR IDs, candidate SHA and artifact, test environment, acceptance evidence, unresolved limitations, measured cost/capacity, and next-phase risks. Serious failures block progression. Reduce scope through a documented decision instead of silently weakening an acceptance criterion.
