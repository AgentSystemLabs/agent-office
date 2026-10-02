# Adjustable Performance Settings Implementation Plan

> **For agentic workers:** Use subagent-driven development for owned implementation tasks and independent final review. The user explicitly chose option B and authorized proceeding; no further design approval is pending.

**Goal:** Reduce the ten audited resource costs while letting users increase or decrease useful quality and freshness controls.

**Architecture:** Browser options live in existing local settings. Office cadence options use the current typed protocol/handler/slice pattern and admin persistence. Automatic demand gating, incremental reads, keyed UI updates and resource cleanup require no extra switches.

**Tech Stack:** Existing TypeScript, Three.js, DOM UI, Node, WebSocket and node:test. No new dependencies.

**Spec:** `../../../_bmad-output/implementation-artifacts/spec-performance-settings.md`

## Global Constraints

- Preserve gameplay speed, terminal streaming, unattended blocked-worker detection, alerts, permissions and provider security validation.
- Reuse the current settings modal, styles, buttons and close/mouse-look behavior; option B is structure, not replacement styling.
- Browser changes persist locally and apply live; office changes require admin permission and apply without restart.
- Preserve unrelated/shared checkout work; no production/live-data changes or merge.
- Meaningful behavioral tests, no new any, no dependency additions, no file-ceiling increases.

## Review Focus

- Low draw cadence must not truncate elapsed gameplay time or trigger slow-computer detection.
- Hidden/resume and floor switches must restore current thumbnails without affecting raw terminal viewers.
- Invalid or unauthorized settings must not partially apply or create zero-delay/duplicate timers.
- Rollout rotation, rewrites, partial/oversized records and symlink escapes must preserve bounded reads and trust checks.
- Resource cleanup must free unique geometry/materials while retaining shared cached materials.

### Task 1: Graphics and browser settings

**Ownership:** Graphics child; files and exact exports are in the spec's ownership block.

**Interfaces:** Produces canonical `BrowserPerformance` options, presets/parser and `Settings.performance`; live renderer application remains within this task.

- [ ] Add focused tests: legacy/invalid settings normalization, preset/custom round trips, 60/120/144 Hz frame admission, hidden/resume and elapsed time.
- [ ] Run focused tests and capture failing behavior before implementation.
- [ ] Implement foreground cap, independently reduced idle drawing, safe timer reset, intentional-throttle-aware frame detection and character-preview cadence. Apply pixel ratio/outline/shadows live, disposing replaced shadow allocations. Detach inactive cached maps from active traversal and restore on entry.
- [ ] Verify scheduler/storage tests and report exact exported APIs and covering commands. Do not run a full build concurrently.

### Task 2: Server settings and demand-driven work

**Ownership:** Server child; server files plus protocol and performance state slice.

**Interfaces:** Produces `OfficePerformanceSettings`, validated defaults/choices, admin `performance.set`, server `performance` state, `store.performance` and `performance` topic.

- [ ] Test validation/admin rejection/persistence/timer rescheduling and zero-subscriber lifecycle behavior.
- [ ] Implement configurable thumbnail/scan/Changes/usage cadence; preserve parser and blocked-state checks at their existing reliable rate.
- [ ] Gate thumbnails on visible 3D recipients. Supply full snapshots on resume; raw terminal attachment remains independent.
- [ ] Skip service process scans with zero owners, preserving disappearance semantics.
- [ ] Cache untracked counts using robust file identity/signatures, invalidate after edits/replacement and retain immediate open/action refresh.
- [ ] Incrementally read Codex complete append records with bounded partial buffering; bootstrap on rotation/truncation/rewrite and maintain session/path validation.
- [ ] Run focused tests, including foreign sessions/symlink escapes and partial/oversized rollout records. Report APIs and any client subscription integration needed.

### Task 3: Client work and approved settings UI

**Ownership:** Lead; laptop/views/audio/sidebar/terminal/Changes-window code, UI pane/integration and docs. Other children are not editing these files.

**Interfaces:** Consumes Tasks 1–2's canonical settings and typed protocol.

- [ ] Gate invisible floor/model/laptop visual work, keeping lifecycle transitions and audio independent. Apply laptop width/refresh live and retain dirty content for catch-up.
- [ ] Dispose unique laptop geometries/materials without clearing shared toon materials; verify repeated disposal paths.
- [ ] Suppress inaudible muted ambience scheduling; keep alerts and voice independent.
- [ ] Retain keyed sidebar rows and avoid unrelated terminal viewer rebuilds; coalesce update bursts without stale actions.
- [ ] Pause Changes watchers on hidden pages and immediately refresh on resume.
- [ ] Add Performance pane with Economy/Balanced/Quality presets, visible FPS/resolution controls, browser advanced disclosure, office admin disclosure and reset. Use existing app visual styles and semantic controls; show concrete values and derive Custom.
- [ ] Update README and configuration docs with scopes/defaults/tradeoffs and describe automatic optimizations.
- [ ] Run `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` sequentially; capture output. Use an isolated fixture browser page/server for screenshots and settings/reset/reload/focus checks without production or daily-driver data.

### Task 4: Independent review and PR delivery

**Ownership:** Parent controller with independent native review agents.

- [ ] Review the full diff and each matrix scenario against actual tests/output. Fix validated gaps and recheck modified risk surfaces.
- [ ] Audit all ten issue areas, settings persistence/live behavior, the chosen UI structure/styling and docs.
- [ ] Stage only owned source/tests/docs/spec/plan; leave generated `_bmad` runtime out of the PR.
- [ ] Fetch/rebase latest main, open a real PR, inspect exact-head checks/review state and report remaining evidence limits. Never merge.
