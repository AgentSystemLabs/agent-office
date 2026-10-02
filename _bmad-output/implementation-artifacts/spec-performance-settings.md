---
title: 'Adjustable performance settings'
type: 'feature'
created: '2026-10-01'
status: 'in-progress'
baseline_commit: '1bc3028472d38b161e85117bf621bb6bc12700e5'
route: 'full'
route_source: 'pinned'
review: 'none'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context: ['{project-root}/CLAUDE.md']
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** The office continuously renders a costly 3D scene and performs background work regardless of visibility or demand, causing unnecessary laptop resource consumption.

**Approach:** Implement the ten audited improvement areas with adjustable quality and refresh controls where useful. The user selected mock B (presets with individual controls) and explicitly instructed proceeding using the existing app styling. This approval authorizes implementation and routine delivery without another design checkpoint.

## Boundaries & Constraints

**Always:** Preserve gameplay speed, state, terminal streaming, unattended blocked-worker detection, alerts, permissions, and provider security validation. Browser controls persist locally and apply live; office controls persist building-wide and require admin permission. Reuse current settings modal, styles, buttons, and close/mouse-look behavior. No new dependencies. Work only in this worktree. Deliver a real PR rebased onto latest main, never merge.

**Never:** Touch production, live data, or daily-driver build channels. Add switches for caching, cleanup, or work that has no consumer. Equate source changes or tests with measured fan/energy savings.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected behavior | Error handling |
|---|---|---|---|
| Local controls | Preset or individual change | Immediate application; individual differences show Custom; reload preserves choices | Invalid stored values use validated defaults |
| Office controls | Admin selects permitted cadence | Persist and reschedule once; existing in-flight work survives | Reject invalid/non-admin changes atomically |
| Hidden or idle | Hidden page, stationary view, modal | Reduce drawing; preserve transport; do not lose gameplay time | Reset frame time on resume |
| No thumbnail viewers | Unoccupied floor or lite-only clients | No thumbnail extraction; parser/blocked detection continue | Full latest screen on subscribe/resume |
| File changes | Codex append/rotation; untracked file replacement | Bounded incremental usage and signature-based counts | Preserve session/path checks; reset safely on identity change |

</frozen-after-approval>

## Code Map

- `client/core/loop.ts`, `registry.ts`, `scene.ts`: ordered simulation/render phases, DPR, outlines and shadows. Player caps dt at .05, so low idle draw rate must not slow gameplay.
- `client/state/persist.ts`, `features/hud/index.ts`, `ui/settings.ts`: local settings and existing live change callback; add a small performance pane module.
- `client/features/workers/views.ts`, `laptop.ts`, `ui/workers-panel.ts`, `ui/terminal.ts`: visual work, canvas ownership, broad updates and sidebar rebuilding.
- `client/sound/core.ts`, `typing.ts`: muted gain still permits JS sound scheduling.
- `server/workers/terminal.ts`, `manager.ts`, `office/views.ts`, `messaging.ts`: thumbnails every 250 ms, forced full screen every 8s; separate lifecycle checks from extraction.
- `server/services.ts`, `changes.ts`, `codex-usage.ts`: recurring process scans, Git/untracked counts and bounded-but-repeated rollout reads.
- `shared/protocol/*`, server handler registry and client state slices: use existing typed registration patterns.

## Tasks & Acceptance

**Execution:**
- [x] Graphics: canonical browser options/presets, validated persistence, safe FPS/idle cadence, live graphics and character preview controls.
- [x] Client: hidden/offscreen worker/laptop work, adjustable laptop resolution/refresh, muted ambience suppression, keyed/coalesced worker UI, owned-resource disposal.
- [x] Server: canonical admin settings, viewer-gated thumbnails, empty-owner scan skip, adjustable polling, cached untracked counts and incremental Codex usage.
- [ ] Integrate B performance pane with existing styling, docs and focused verification; independently review and open PR.

**Acceptance Criteria:**
- Given any preset, when changed or reset, then FPS, idle drawing, resolution, outlines, shadows, character preview and laptop controls persist and apply without reload.
- Given gameplay at 30/60/120 FPS or idle drawing at 5/15 FPS, when time advances, then movement remains consistent and intentional throttling never triggers the slow-computer warning.
- Given muted audio and working agents, when sound ticks run, then inaudible typing nodes are not created; useful alert behavior is retained.
- Given one worker update, when sidebar/terminal refresh, then unaffected nodes are retained and UI remains current.
- Given repeated worker/floor changes, when laptops are disposed, then their unique GPU resources are released without disposing shared toon resources.
- Given no eligible screen recipients or service owners, when recurring work runs, then unused extraction/process scans are skipped and resume produces fresh state.
- Given office settings changes, when authorized, then thumbnail FPS and service/Changes/usage polling delays can increase or decrease safely.
- Given app styling, when Performance opens, then B preset/disclosure structure matches existing modal styling, keyboard access and close behavior.

## Implementation Notes

Baseline: 1bc3028472d38b161e85117bf621bb6bc12700e5. Three audit/design agents ran before implementation. No measured energy baseline exists. Symlinked existing dependencies in this worktree to avoid reinstalling or modifying the shared checkout.

### Execution ownership and shared interfaces

Use three implementation subagents in total: the lead implementer plus two native children. Execute source edits in parallel with explicit ownership; serialize verification under BMAD to limit local load. Everyone shares this worktree; never revert another worker's changes. No worker may push or merge. The parent performs final review/delivery. A follow-up implementation plan lives in `../../docs/superpowers/plans/2026-10-01-performance-settings.md`.

The lead owns client CPU, laptops, audio, sidebar/terminal updates, the Performance pane, integration and docs. Delegate graphics to one child owning `src/client/shared/performance.ts`, `state/persist.ts`, `core/loop.ts`, `core/registry.ts`, `core/scene.ts`, graphics/frame helpers, `framerate.ts`, `ui/character.ts`, `features/hud/index.ts`, `core/worlds.ts` and related focused tests. Delegate server to one child owning `src/shared/performance.ts`, `src/shared/protocol/performance.ts`, protocol composition, all server changes, client `state/slices/performance.ts` and slice registration, and server tests. Root composition additions in `main.ts`/client feature registry belong to the lead only. Ask the children to report their exact exported interfaces before integration.

Graphics contract: `src/client/shared/performance.ts` exports `BrowserPerformance`, `DEFAULT_BROWSER_PERFORMANCE`, `PERFORMANCE_PRESETS`, `parseBrowserPerformance(unknown)` and a canonical allowed-value table. `Settings.performance` holds concrete values: `fps` 30/60/90/120/'display', `idleFps` 5/10/15/30, `pixelRatio` .75/1/1.25/1.5/2, `outlines` boolean, `shadowSize` 0/512/1024/2048, `previewFps` 15/30/60, `laptopWidth` 256/512/1024, `laptopRefreshMs` 250/500/1000/2000. Balanced defaults: 60,15,1.25,true,1024,30,512,500. Economy:30,5,1,false,512,15,256,1000. Quality:120,30,2,true,2048,60,1024,250. Derive preset identity from equality to concrete preset values. Safely parse old storage; use unknown and typed guards, no new any. Live graphics integration is owned by the graphics child; lead UI reuses the existing onChange callback.

Office contract: `src/shared/performance.ts` exports `OfficePerformanceSettings`, `DEFAULT_OFFICE_PERFORMANCE`, allowed choices and validation. Fields: `screenFps` 1/2/4 default2, `serviceScanSeconds` 4/10/30 default10, `changesPollSeconds` 2/5/10 default5, `usageScanSeconds` 2/5/10/30 default10. Protocol: `performance.set` carries `settings: OfficePerformanceSettings | null`; server `performance` carries `state` with settings and optional by/at; state slice topic/property `performance`. Provide state on welcome, atomically persist valid admin changes and reset null. Runtime delays apply without duplicate timers.

Verification is sequential to limit load. Children run only their focused tests; the lead runs integration typecheck and app checks after all code is present. Preserve size ceilings through cohesive helpers, not by raising ceilings. Do not leave unsupported parts merely documented: finish them and report exact test limitations.

## Spec Change Log

## Review Triage Log

## Verification

- Focused behavior tests for cadence, storage, subscription gating, timer changes, file invalidation, security and disposal.
- `npm run typecheck`, `npm test`, `npm run build`, `git diff --check`: exit zero.
- Isolated browser checks/screenshots: Performance pane, live settings, reload, presets/custom/reset, modal close and representative movement.
- Short controlled render/work-count observations where practical; report measurements separately from expected savings.


### Implementation verification (2026-10-02)

All commands ran in the isolated worktree; verification was serialized.

- Graphics focused suite: 41/41 passed; follow-up visibility/cadence check: 11/11 passed.
- Server focused suite (`performance-server`, `codex-usage`, `changes`, `client-store`, `size`): 31/31 passed; server typecheck passed.
- Client focused suite (`laptop`, `typing-performance`, `client-updates`, `office-performance-edits`): 14/14 passed.
- `npm run typecheck`: exit 0.
- `npm test -- --test-concurrency=1`: exit 0, 547/547 passed, none skipped, 40.5 seconds.
- `npm run build`: exit 0, client and server artifacts built in this worktree.
- `git diff --check`: exit 0.

Matrix coverage executed in the full suite:

| Matrix row | Executed behavior coverage |
| --- | --- |
| Local controls | `browser-performance`: legacy/invalid parsing, preset round trips/custom/reset defaults; `office-performance-edits`: coherent rapid edits and timeout/rejection recovery. Browser live cross-pane/reload/modal checks remain with parent. |
| Office controls | `performance-server`: invalid/admin-revoked rejection, atomic persistence, service/Changes timer rescheduling and immediate watch behavior. |
| Hidden or idle | `frame-cadence` and `frame-loop`: foreground/idle admission, hidden zero work/resume reset, actual movement at 30/60/120 FPS; `framerate`: intentional cadence does not trigger slow warning. |
| No thumbnail viewers | `performance-server`: no extraction/serialization without recipients, unattended blocked gate detection, fresh resume snapshots independent of raw attachment. |
| File changes | `codex-usage`: append/partial/oversized records, rotation, same-inode rewrite/growth, foreign sessions and symlink escape; `performance-server`: untracked equal-sized file replacement and symlink refusal. |

Deterministic work observation at representative 120 Hz timestamps over 10 seconds: 601 simulation updates preserved 10.000 seconds; 60/15/5 FPS drawing admitted 601/151/51 draws respectively (including the first draw). Hidden interval admitted zero draws/updates. Actual movement covered 30/60/120 FPS. These are work counts, not measured CPU/fan/energy savings.

Parent retains independent review, isolated browser screenshots/live checks and PR delivery. No production/live-data/daily-driver channels, pushes or merges were performed by implementation agents.
