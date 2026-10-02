# Verification, security, and performance plan

Tests must protect valuable behavior and failure boundaries. Coverage numbers alone do not prove correctness. Avoid tests that restate implementation, assert arbitrary file shapes, or exercise only mocked happy paths.

## Test layers

| Layer | Meaningful examples | When |
| --- | --- | --- |
| Unit/domain | Costs, bounds, ownership, reward eligibility, job transitions | Relevant task PR |
| Property/invariant | Inventory never negative; replay cannot duplicate grants; randomized permitted sequences | State/economy changes |
| Integration | Real temporary database, transactions, unique constraints, room restore | Persistence and authoritative changes |
| Contract | Runtime-invalid messages, unknown versions, oversized payloads, schema evolution | Network/API changes |
| Multi-client | Two collectors, competing helm occupants, concurrent construction, membership revoked mid-action | Multiplayer changes |
| Browser | Join, move, modal focus, preview/confirm/cancel, dock, complete expedition | Relevant user flows |
| Fault/recovery | Lost acknowledgments, worker timeout, crash after reservation/commit, server restart | Durable/provider changes |
| Security | Forged ownership, cross-crew access, injection, unsafe plan, quota bypass, secret leakage | Relevant boundaries and release |
| Load/soak | Active rooms, repeated travel/building, empty-room cleanup, queue saturation | Phase E and capacity increases |
| Usability | Sailing feel, camera comfort, hints, collaboration, frustration | Adult phase reviews; approved child pilot later |

## Required correctness scenarios

- Concurrent reward claim yields one durable crew grant, including after restart.
- Duplicate or reordered spending requests cannot produce negative stock or multiple upgrades.
- Preview validation followed by a changed permission or world version rejects safely.
- Crash after material reservation recovers a job or refunds once; never both.
- Disconnection releases the helm and stations; resuming does not regrant supplies.
- Provider refusal, malformed result, timeout, and exhausted quota leave manual play usable.
- Cancelled or expired jobs cannot later complete from a delayed worker response.
- Foreign crew IDs, forged plot IDs, and oversized geometry fail before mutation.
- Empty-room suspension stops hazards; resuming restores persisted encounters.
- Schema migration works on representative older saves; a restore drill verifies recovery.

Use deterministic seeds/clocks where appropriate and explicit state assertions. Simulate provider behavior with an adapter fixture in routine CI; a separate approved live evaluation checks real quality, cost and retention. Do not send real child prompts through CI.

## Browser and visual evidence

Use the selected toolchain/browser/device profiles in [foundation](foundation-spec.md); record actual tested browser versions, baseline hardware, resolution and graphics preset. Cover the supported browser matrix, not only the developer's browser. Headless screenshots verify visual milestones; screenshots alone do not verify interaction or accessibility.

Verify keyboard hints, clear focus, visible close buttons, Esc behavior, return to gameplay input, readable UI, reduced-motion options where needed, and safe overboard recovery. Use short adult playtests for camera and sailing feel. Record observations and resulting changes.

## Proposed performance experiments

Provisional targets, to approve after selecting a baseline device:

- At least 30 FPS on the declared minimum desktop at the supported preset; aim for 60 FPS on the reference device.
- Start with four active clients in one room; then exercise 20 rooms/80 automated clients as a controlled experiment, not a production capacity claim.
- Run an initial two-hour soak covering sails, builds, rewards, reconnects and room disposal.
- Exercise roughly 150 ms network latency, constrained bandwidth, interruptions, and reconnects using network shaping. WebSocket/TCP packet loss manifests as transport delay/recovery; do not model it as unordered UDP delivery.
- Measure p95 frame time, tick time, command acknowledgment, generation latency, memory after cleanup, bytes/player/second, DB latency, retries and cost/successful build.

Choose server tick, asset download, queue wait and latency budgets after prototype measurements. Pilot admission is capped below verified capacity with defined headroom. Stress tests use synthetic accounts and owned infrastructure, with explicit cost bounds.

Optimize the measured bottleneck, record before/after traces and comparable scenarios, and preserve correctness tests. Frame-time averages must not hide stutters; average generation cost must not hide heavy users. Reject unbounded listeners, queues, abandoned rooms, retry storms, per-frame AI calls and unnecessary full-state sends.

## CI and release gates

Task PRs: frozen install, typecheck, lint, build, relevant domain/integration tests, and applicable browser evidence. Required tests are declared in each task. Integration-affecting changes run the affected regression suite.

Release candidate: complete supported suite, multi-client acceptance, recovery/migration checks, security review, relevant performance/soak evidence, and staging smoke tests. Dependency/secret scans are supporting checks, not substitutes for code review. Quarantine a flaky check only with an owner, issue and explicit alternative gate; never hide a correctness failure behind automatic retries.

Report failures candidly. Existing platform failures require a documented baseline and a portability fix or approved restriction before claiming the future game is supported there. A documentation-only change does not require repeatedly running an unchanged runtime suite, but links and workflow consistency should be checked.
