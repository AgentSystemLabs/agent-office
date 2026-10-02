# Foundation specification

Selected engineering baseline: 2026-10-02. Scope: a separate adult-tested cooperative prototype. This is an implementation specification, not an installation, repository creation, purchase, or runtime change.

## Repository and ownership

- Intended destination: `sipelisdeividas/promptycraft`, private by default; temporary project name, not a cleared product trademark. Verify availability and owner before creation; do not overwrite or repurpose an existing repository.
- Maintainer/release owner: sipelisdeividas. Implementation may be performed by the coding assistant under a later coding instruction; task review is independent.
- Independent reviewer: assign before merging an implementation PR; record actual review and approval. Reviewer assignment does not block foundation planning or preparation.
- Keep new application source private by default with no assumed open-source license grant. Preserve required notices for reused dependencies/assets and record asset provenance. Final commercial licensing remains open.
- Initialize stage and PROD from the same documentation-only seed commit. Set PROD as the default/main branch, then create DEV-001-foundation from fetched stage. stage is disposable; preserve unpromoted work before deleting it and recreate it using workflow.md.
- Move the planning package to `docs/`, retain the root concept, and rewrite/validate all moved links. Add repository AGENTS.md explaining the DEV/stage/PROD rules.

The user selected a workflow with no paid GitHub plan requirement. Review, tests and release approval are verified manually as specified in [workflow](workflow.md); platform-enforced branch or deployment protections are not prerequisites. Keep the intended private visibility and use CI within the available free allowance, with recorded equivalent local checks if needed. No GitHub upgrade is part of setup.

## Product baseline

Desktop browser, third-person camera, one to four private crew members, one shared island with personal plots, one bounded ocean, one starter sloop, protected cooperative construction. First expedition quantities remain provisional. No strangers, weapons, raids, public chat, payments or children’s data in phase A.

## Toolchain baseline

Versions were read from official release documentation and npm package metadata on 2026-10-02. This verifies version availability and declared engines/peers, **not a successful integrated build**. DEV-001 must prove a clean install and compilation and record reviewed changes if incompatibilities remain.

| Component | Selected version | Install milestone |
| --- | --- | --- |
| Node.js | 24.21.0 LTS | DEV-001 |
| npm | 11.21.0 | DEV-001 |
| TypeScript | 6.0.3 | DEV-001 |
| Vite | 8.3.2 | DEV-001 |
| Three.js / @types/three | 0.186.1 / 0.186.0 | DEV-001 |
| ESLint / @eslint/js | 10.11.0 / 10.0.1 | DEV-001 |
| typescript-eslint | 8.71.0 | DEV-001 |
| Vitest | 5.0.3 | DEV-001 |
| @playwright/test | 1.63.0 | DEV-001 |
| tsx | 4.23.15 | DEV-001 |
| @types/node | 24.19.1 | DEV-001 |
| @colyseus/core / @colyseus/ws-transport | 0.18.18 / 0.18.4 | DEV-006; compatibility smoke in DEV-001 |
| @colyseus/sdk / @colyseus/schema | 0.18.4 / 5.0.35 | DEV-006; compatibility smoke in DEV-001 |
| Zod | 4.6.5 | DEV-002 |
| PostgreSQL | 18.6 | DEV-003; local container definition in DEV-001 |
| pg / @types/pg | 8.23.1 / 8.23.1 | DEV-003 |
| Express / @types/express | 5.2.1 / 5.0.6 | DEV-004/006 |

Select exact direct versions, one root npm-workspaces lockfile, engine-strict configuration and npm ci. Pin CI actions to reviewed full commit SHAs and container artifacts to digests during implementation; this document does not invent unverified action SHAs or image digests. Patch updates require a reviewed dependency task, not floating latest tags in CI.

TypeScript 7.0.2 is published, but the selected typescript-eslint declares TypeScript >=4.8.4 and <6.1.0. Use 6.0.3 to honor that range; do not install with force or legacy peer-resolution flags. Colyseus's umbrella package brings additional tooling and Redis adapters, so prefer its core, WebSocket transport, SDK and schema packages. Optional peers such as PM2 monitoring are not initial requirements.

Registry verification commands: npm view <package> version engines peerDependencies peerDependenciesMeta --json. Sources: [Node 24.21.0](https://nodejs.org/en/blog/release/v24.21.0), [Node release schedule](https://github.com/nodejs/Release), [PostgreSQL supported versions](https://www.postgresql.org/support/versioning/), [Vite requirements](https://vite.dev/guide/), [Colyseus 0.18 migration](https://docs.colyseus.io/migrating/0.18), [typescript-eslint metadata](https://registry.npmjs.org/typescript-eslint/8.71.0).

The current agent-office terminal reports Node 22.12.0/npm 10.9.0. Do not change that environment or its lockfile as part of planning. Install/use the selected future-project toolchain through an isolated version-management setup during DEV-001.

## Runtime and code choices

- TypeScript ESM with strict checking, explicit package exports and feature-local modules.
- Three.js rendering with ordinary HTML/CSS for panels; no React or additional UI state framework initially.
- Colyseus 0.18 for private authoritative rooms using WebSockets. Read the installed-version documentation; do not copy outdated colyseus.js or older Room APIs.
- One Node API/room deployment. Later AI jobs run as a separate process from the same application, not a separate service platform.
- PostgreSQL via pg and parameterized SQL with small feature-owned repository functions. No ORM initially.
- Numbered SQL migrations with a locked migration run and schema-version tracking; never manual production schema edits.
- Manual/preset building and fake provider fixtures until the real provider/data arrangement is approved.
- Redis, arbitrary physics engines, Kubernetes, managed auth, object storage and paid API usage are deferred until their feature needs them.

## CI and verification contract

CI platform: GitHub Actions, Ubuntu 24.04 primary runner plus Windows for install/typecheck/unit/build portability. PostgreSQL integration tests and browser jobs run on Linux. No privileged production credentials in PR jobs.

Required scripts to implement in DEV-001:

| Command | Contract |
| --- | --- |
| npm ci | Frozen reproducible workspace install |
| npm run typecheck | Strict client/server/shared checking |
| npm run lint | Lint production and test code; no ignored errors |
| npm test | Vitest unit/domain suite; exits rather than watches |
| npm run test:integration | Real temporary PostgreSQL checks when implemented |
| npm run test:browser | Playwright join/render/focus flows as they are implemented |
| npm run build | Client and server build; explicit workspace ordering |
| npm run check:docs | Local links and task-document consistency |
| npm run dev | Documented local-only client/server startup |

Do not add empty test suites that appear green. DEV-001 verifies meaningful foundations: renderer startup without browser console errors, server startup/shutdown/health behavior, invalid configuration rejection, and a minimal Colyseus SDK/core compile-and-connect smoke. That smoke has no game state and is removed or reused when DEV-006 supplies real rooms.

Later test commands become required checks once their task adds real behavior. Record runner/browser/tool versions with artifacts; use the Playwright version's matching browser binaries. [Playwright CI](https://playwright.dev/docs/ci).

## Device and performance targets

Initial supported browsers: current stable Chrome, Edge and Firefox at the task's execution date, with exact tested versions recorded. Chromium/Firefox Playwright suites support this matrix; add actual Edge smoke evidence. Safari/tablets remain explicitly unsupported until separately planned and tested.

Proposed measurement profiles: Windows 11 laptop, eight GB RAM, integrated GPU, WebGL2, 1280x720 low preset targeting >=30 FPS; reference desktop, sixteen GB RAM and a discrete GPU, 1920x1080 targeting 60 FPS. These are target profiles, not tested hardware claims. DEV-005 must identify actual devices/GPU/driver and report results; inability to reach the profile causes optimization or a reviewed minimum-spec change.

Initial authoritative simulation target: 20 Hz; render independently. Measure before adding prediction complexity. Input/state network rates, interpolation and catch-up caps are in the contracts specification and remain tuning values.

## Hosting and budget boundary

Phase A runs locally and in CI; no paid hosting is purchased. Plan a single EU staging host with Docker Compose for API/room server and PostgreSQL, behind TLS, only when a staging deployment task is approved. Hetzner EU is the initial host choice to evaluate against reliability, backup and networking requirements; provider availability is not reserved.

Initial planning ceiling: EUR 50/month for a small adult-test staging environment, excluding developer labor, legal work and later real AI. GitHub paid plans are outside the selected workflow. This is a budget limit to validate, not a quoted capacity guarantee or purchase authorization. If infrastructure cannot meet it, revisit scope/budget before provisioning. Separate production infrastructure, backups, spend and moderation remain DEV-018 decisions.

## Operational readiness

Technical specification and branch policy: ready for DEV-001 implementation preparation. A subsequent instruction to begin implementation is still needed; assign the independent reviewer before merge. Verify repository availability during setup. No paid-plan entitlement check blocks this task, and manual rules do not imply platform enforcement. No implementation has started.
