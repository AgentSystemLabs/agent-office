# Selected architecture and project structure

Status: D04 selected for the initial prototype; implementation compatibility remains to verify. The [foundation specification](foundation-spec.md) pins the toolchain; [contracts/storage](contracts-and-storage.md) defines initial identity and data boundaries. Real AI provider selection remains open.

## Small initial system

One browser client, one authoritative game/API deployment, PostgreSQL, object storage when needed, and an AI worker process built from the same server codebase. Do not begin with microservices, Kubernetes, a custom networking framework, or a generic plugin engine.

Use Colyseus 0.18 core, WebSocket transport, SDK and schema packages for four-player private rooms, with an initial compatibility smoke before feature implementation. Add shared coordination such as Redis only when multiple server processes require it. Empty rooms persist and stop; do not dedicate a permanently running process to every island.

## Proposed repository layout

```text
pirate-game-idea.md
docs/                           # this planning package, moved with updated links
apps/
  client/
    src/
      app/                      # bootstrap, routing, dependency composition
      core/                     # rendering, input, camera, network transport
      features/
        crew/                   # views, controllers, local presentation state
        sailing/
        building/
        exploration/
        tutorial/
      assets/                   # approved manifests, no undocumented provenance
  server/
    src/
      app/                      # bootstrap, routes, feature registration
      core/                     # auth middleware, room lifecycle, transport
      features/
        crew/                   # commands, services, repositories, domain tests
        sailing/
        building/
        exploration/
        tutorial/
      integrations/             # AI, storage, identity adapters
      jobs/                     # bounded worker execution and recovery
packages/
  contracts/                    # message schemas, safe shared IDs and DTOs
  rules/                        # pure authoritative rules shared where useful
tests/
  integration/
  browser/
  load/
  fixtures/
ops/                            # deployment, migrations, recovery instructions
```

Create only folders/modules that have implemented responsibilities. Keep unit tests beside the domain they verify. This layout is a convention, not a demand for dozens of empty wrappers.

## Dependency rules

- Composition files install features; they do not contain gameplay implementations.
- Feature controllers use a small explicit context or constructor dependencies.
- Features own their commands, UI, data access, and relevant tests; do not access another feature's tables directly.
- Shared contracts contain transport-safe schemas, not database models or server secrets.
- Pure rules contain deterministic geometry, costs, and permission helpers where sharing is useful. Client calculation is advisory; the server independently validates.
- Client code never imports server implementations. Domain code never depends on browser rendering or a specific AI SDK.
- Adapter boundaries separate external providers from game commands. Add an interface where a real external boundary exists, not for every class.
- Avoid cycles and a single giant protocol/store module. A small composition registry assembles feature-owned schemas and handlers.

## Authority and coordinates

Selected conventions: meters, Y-up, X east/Z south, radians and quaternions internally, stable opaque IDs, ship-local coordinates for passengers and equipment. Planar steering follows the documented yaw convention; confirm its implementation in DEV-002/DEV-007. IDs and coordinates are never permission grants.

The server owns crew membership, plot rights, inventory, rewards, accepted construction, ship condition, encounter progress, and quota. Client prediction makes movement responsive and reconciles with authoritative state. Validate movement bounds and station occupancy; never accept a client-provided reward or material balance.

## Durable operations

Every important command carries a scoped operation ID and expected version where needed. Authenticate the actor, validate membership and input, and check authorization again at mutation time.

Inventory spends, reward claims, and build reservations use durable atomic transactions with uniqueness constraints. Store the operation result with the mutation so replay returns the original outcome. Keep deduplication records at least as long as the retry/recovery window; retention is explicitly decided.

For persistent world edits, commit durable state before acknowledging or broadcasting acceptance. Use recoverable pending-operation records for coordinating database state with live room state. A crash between commit and broadcast must reconcile from persistence. Do not claim distributed exactly-once execution; provide idempotent outcomes under at-least-once delivery.

Movement is transient: checkpoint safe ship/player state at a bounded interval and on clean room shutdown. Decide maximum acceptable movement loss separately from inventory/world correctness. Versioned snapshots accelerate restore; operation history supports audit and undo without retaining sensitive prompts indefinitely.

## AI and construction boundary

External AI returns approved structured plans, never executable server code. Validate schema, component IDs, geometry bounds, collision, cost, ownership, request limits, and world version. Preview tokens bind actor, plan, world version, expiration, and quote; confirmation rechecks everything.

Reserve materials atomically with creation of a construction job. Track job state and progress durably; complete/cancel transitions are idempotent. Decorative builder animation reads job state. Worker retries have bounded attempts and budgets, cancellation, timeouts, and an outage fallback.

Keep API keys server-side. Send only necessary scene information. Provider data controls, model suitability, retention, and underage access must be approved before child free-text use.

## KISS, DRY, and optimization

Prefer readable feature code and small functions with one responsibility. Extract genuinely repeated policies or algorithms; do not force unrelated features into an abstract universal system. Avoid premature event buses, elaborate inheritance, unused dependencies, and speculative future compatibility.

Use bounded arrays/queues, explicit complexity caps, coarse collision shapes, instancing/batched meshes where beneficial, proximity loading, and compact state updates. Measure before deeper optimization. No provider calls in render/simulation loops, full-world broadcasts per tick, or permanent polling of empty worlds.

Performance and size budgets are selected from measurements and enforced in CI where meaningful. Review growing modules for responsibility, not merely line-count compliance. A future size guard supplements architectural review; it must not encourage splitting files into meaningless fragments.
