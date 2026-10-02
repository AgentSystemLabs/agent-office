# Decisions and readiness

Status meanings: **accepted** = explicit user direction; **selected** = engineering default chosen while carrying out the user's instruction to proceed with planning; **proposed** = alternative awaiting selection; **open** = missing decision. Selected designs still require implementation verification. Acceptance of planning does not authorize code implementation.

| ID | Decision | Status | Required before |
| --- | --- | --- | --- |
| D01 | Plan first, use a dedicated documentation folder, one DEV-prefixed branch per implementation, mandatory review, stage then PROD | Accepted | Workflow setup |
| D02 | Separate sipelisdeividas/promptycraft project, private by default; preserve third-party notices and provenance | Selected; repository availability/entitlement to verify; no repository created | DEV-001 |
| D03 | Desktop browser, third-person view, one to four private crew members; adult-only initial testing | Selected first-slice scope; gameplay values remain tunable | DEV-001 |
| D04 | TypeScript ESM, Three.js, Node, Colyseus core/WebSockets, PostgreSQL/pg, plain HTML/CSS, no ORM; one server plus later AI worker | Selected; compatibility smoke required | DEV-001 and DEV-002 |
| D05 | Exact versions, npm workspaces/one lockfile, browser/device profiles, GitHub Actions and local-first/EU stage direction | Selected in foundation-spec.md; integrated build not yet proven | DEV-001 |
| D06 | Operator-provisioned adult accounts, opaque sessions, expiring single-use invitations, revocation | Selected design in contracts-and-storage.md; crypto/middleware security review during implementation | DEV-004 |
| D07 | Meter/Y-up convention, stable IDs, scoped operation IDs, feature schemas and bounded message/rate rules | Selected design in contracts-and-storage.md | DEV-002 |
| D08 | PostgreSQL atomic mutations, reservations, outbox, versioned snapshots and bounded movement checkpoints | Selected design in contracts-and-storage.md | DEV-003 |
| D09 | Initial approved component catalog and asset provenance; no arbitrary scripts | Catalog proposed in main concept | DEV-009 |
| D10 | Provider, model evaluation, request retention, free-text eligibility, quota and cost limits | Open | DEV-010; no child prompts before provider approval |
| D11 | Cooperative tutorial, protected homes, temporary later charts, limited later raids | Proposed game defaults | Relevant implementation phase |
| D12 | Ages, launch countries, parent consent, age assurance, reporting, moderation, retention, deletion | Open | Children’s pilot; design requirements before DEV-017 |
| D13 | Pricing, payment provider, family entitlements, final name, capacity budget | Open | Commercial release |
| D14 | Private-repository protections and required-review entitlement | Open; account API did not expose plan; do not infer or purchase one | DEV-001 repository setup |
| D15 | Named independent implementation reviewer | Open; user asked during this planning turn | DEV-001 ready/in-review gates |

## Planning completion checklist

Immediate engineering choices D02–D08 are now specified in [foundation](foundation-spec.md) and [contracts/storage](contracts-and-storage.md). Maintainer is sipelisdeividas; phase A requires no purchased host or AI. DEV-001 is technically specified but remains operationally conditional on D14/D15 and a later coding instruction. Do not call it ready/in progress until those conditions hold. Complete D09–D10 before construction/provider work. Child safety and commercial gates remain explicit later requirements, not assumed exemptions.

Choose identity early even for adult testing. Do not build a public unauthenticated server and plan to bolt permissions on later. Provider fallback allows a manual-building prototype before AI approval, but does not bypass private-session authentication.

## Change control

For a material decision, add a record containing date, decision ID, alternatives, chosen option, rationale, affected tasks, verification, and reversal cost. Accepted alternatives replace old defaults in their owning document; preserve history here rather than leaving contradictory active rules.

## History

- 2026-10-02: Selected immediate engineering defaults and exact registry-verified versions. Chose TypeScript 6.0.3 because the selected linter excludes TypeScript 7; preferred minimal Colyseus packages over the umbrella package. Specified adult identity, contracts, transaction/replay rules, job reservations and restore. Reviewer identity and private-repository protection entitlement remain unresolved; no software installed or game repository created.
- 2026-10-02: User required documentation before coding, individual DEV-prefixed implementation branches, mandatory review, integration into stage, and promotion to PROD. Added a proposed architecture, task sequence, and quality/release gates. Runtime implementation is not started.
