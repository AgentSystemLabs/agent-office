# Decisions and readiness

Status meanings: **accepted** = explicit user direction; **proposed** = recommended implementation choice needing validation; **open** = missing decision. Acceptance of planning does not authorize code implementation.

| ID | Decision | Status | Required before |
| --- | --- | --- | --- |
| D01 | Plan first, use a dedicated documentation folder, one DEV-prefixed branch per implementation, mandatory review, stage then PROD | Accepted | Workflow setup |
| D02 | Separate pirate-game repository; name, owner, visibility, and asset-license policy | Proposed destination; details open | DEV-001 |
| D03 | Desktop browser, third-person view, one to four private crew members | Provisional prototype default | DEV-001 scope approval |
| D04 | TypeScript, Three.js, Node, PostgreSQL; evaluate Colyseus; one deployable game server plus an AI worker process from the same codebase | Proposed | DEV-001 and DEV-002 |
| D05 | Exact supported versions, package manager, lockfile, browsers, baseline device, CI platform, and host | Open; verify official support before pinning | DEV-001 |
| D06 | Adult-test accounts, session authentication, invitations, expiration, and logout rules | Open | DEV-004 |
| D07 | World axes, units, coordinate frames, stable entity IDs, operation versions, and protocol schema | Proposed in architecture; concrete contracts open | DEV-002 |
| D08 | Durable operation/reservation model and restart checkpoint strategy | Proposed in architecture; storage semantics open | DEV-003 |
| D09 | Initial approved component catalog and asset provenance; no arbitrary scripts | Catalog proposed in main concept | DEV-009 |
| D10 | Provider, model evaluation, request retention, free-text eligibility, quota and cost limits | Open | DEV-010; no child prompts before provider approval |
| D11 | Cooperative tutorial, protected homes, temporary later charts, limited later raids | Proposed game defaults | Relevant implementation phase |
| D12 | Ages, launch countries, parent consent, age assurance, reporting, moderation, retention, deletion | Open | Children’s pilot; design requirements before DEV-017 |
| D13 | Pricing, payment provider, family entitlements, final name, capacity budget | Open | Commercial release |

## Planning completion checklist

Approve the first-slice scope; decide D02–D08 for immediate engineering; identify owners and budget; make phase A tasks ready. Complete D09–D10 before construction/provider work. Child safety and commercial gates remain explicit later requirements, not assumed exemptions.

Choose identity early even for adult testing. Do not build a public unauthenticated server and plan to bolt permissions on later. Provider fallback allows a manual-building prototype before AI approval, but does not bypass private-session authentication.

## Change control

For a material decision, add a record containing date, decision ID, alternatives, chosen option, rationale, affected tasks, verification, and reversal cost. Accepted alternatives replace old defaults in their owning document; preserve history here rather than leaving contradictory active rules.

## History

- 2026-10-02: User required documentation before coding, individual DEV-prefixed implementation branches, mandatory review, integration into stage, and promotion to PROD. Added a proposed architecture, task sequence, and quality/release gates. Runtime implementation is not started.
