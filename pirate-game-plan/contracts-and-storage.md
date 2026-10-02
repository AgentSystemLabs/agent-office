# Initial identity, contracts and storage specification

Selected engineering defaults for DEV-002–004. Implementation must validate them through security and recovery tests. This specification covers adult testers only; it does not settle child/parent authentication or launch privacy requirements.

## Identity and private crews

- Operator provisions adult-test accounts; no public signup, email delivery, external identity provider or child profiles in the prototype.
- Use a vetted password hashing implementation backed by Node scrypt, with random salts and versioned parameters chosen through security review/measurement; do not invent an unreviewed custom crypto protocol.
- Authenticate over TLS outside loopback, rate-limit attempts and use generic failure responses. Local fixtures are development-only and cannot be enabled on stage/PROD.
- Issue an opaque random 256-bit session secret; store its hash, account ID, issue time, last activity, absolute expiry and revocation. Production cookies are HttpOnly, Secure, SameSite=Lax and host-only.
- Initial absolute session lifetime: seven days; idle expiry: 24 hours. Login rotates session identity. Logout and account revocation invalidate active WebSockets immediately. Do not log credentials or cookies.
- Private crew invitation: random 256-bit secret, hashed in storage, expires after 24 hours, one successful redemption, revocable by owner. Deliver the secret in a URL fragment and redeem by authenticated POST; tokens must not appear in access-log paths.
- Crew admission and four-member cap occur transactionally. Invite possession is not authentication. Owner/builder/visitor roles are separate from account identity.
- Check Origin for WebSockets and mutating requests. Use appropriate CSRF protection, restrictive CORS and same-origin deployment; do not infer safety from a cookie flag alone.

Exact hashing parameters and middleware wiring require security review in DEV-004. These operational controls are not parental consent or age assurance.

## IDs, world conventions and message envelope

UUIDs generated server-side identify accounts, crews, members, plots, vessels, jobs, grants and adventure instances. Client-generated random UUIDs may identify command attempts; possession of any ID grants no permission.

World units are meters. Y is up, X east, Z south; forward/north is negative Z. Use radians and quaternions for general rotations, a documented yaw convention for planar steering. Passenger/equipment positions are vessel-local. Reject non-finite coordinates and out-of-bounds geometry.

Version-one message intent:

```text
Client command:
  protocolVersion, type, operationId, expectedVersion?, payload

Authoritative result:
  protocolVersion, operationId, status, entityVersion?, result | error

Transient movement input:
  protocolVersion, sequence, controls
```

Account/session/crew identity comes from authenticated connection context, not trusted payload fields. Runtime schemas are feature-owned and composed centrally. Reject unknown message types/versions with a documented upgrade path.

Initial bounds: 16 KiB serialized client command, ten generic durable commands/second/account with burst twenty; construction planning has stricter quota. Start movement input at 20 Hz and state patches at up to 10 Hz, adapting during measurement. Limit accumulated simulation catch-up and reject obsolete input sequences. Camera and animation render locally; geometry plans have independent node/component/extent limits before execution.

Rate limits are tuning values and apply server-side before expensive work. Four players sending maximum traffic is a test case, not permission for unrestricted work. A requested rate/limit increase requires measurement and review.

Errors use stable codes: UNAUTHENTICATED, FORBIDDEN, INVALID_INPUT, STALE_VERSION, INSUFFICIENT_RESOURCES, ALREADY_APPLIED, RATE_LIMITED, UNAVAILABLE. Do not return raw stack traces, SQL, tokens or provider content to players.

## Initial storage responsibilities

| Records | Owns |
| --- | --- |
| accounts, sessions | Adult authentication and revocation |
| crews, crew_members, invitations | Private admission, roles and limits |
| plots, world_objects, world_versions | Ownership and accepted persistent construction |
| crew_inventory | Available/reserved materials and bounded balances |
| vessels, vessel_checkpoints | Design/equipment and last safe transient state |
| construction_jobs, job_materials | Plan reference, reservation, state and cancellation |
| adventure_progress, encounter_grants | One-time objectives, discoveries and rewards |
| operation_results, outbox | Replay outcomes and recoverable state publication |
| world_snapshots, schema_migrations | Versioned restore and database evolution |

Start with relational columns for permissions, identifiers, versions and balances; JSONB for bounded validated component plans/snapshots. Do not serialize the entire account/crew model into one blob or store provider secrets in player data. Use parameterized queries and constraints, with row locks or version conditions where required.

## Transaction and replay rules

- Scope an operation key to authenticated session ID, account ID, crew ID and operation ID. Store command type and a normalized payload fingerprint; reuse with different content rejects.
- Persist important outcomes together with the mutation. Duplicate requests return the stored outcome rather than performing work again.
- Retain adult-prototype operation results for 30 days; accept durable commands only on active sessions with a maximum seven-day lifetime. Old session-scoped commands cannot execute under a new session. Use separate durable job IDs for worker completion after session expiry.
- Keep encounter grants and unique completed objective IDs for the adventure's lifetime, independent of short-lived operation-result retention.
- No raw free-text prompts in operation fingerprints/logs/results. Use a validated plan reference for construction; provider request handling has its own approved retention boundary.
- Starter supplies, reward grants, upgrade costs and resource reservations use database transactions and uniqueness constraints. The database is the durable authority; room state is reconciled from it.

## Construction state machine

```text
validated preview -> confirmation -> reserved pending job -> running -> completed
                                                |             |
                                                +-> cancelled <-+
```

Preview does not spend materials. Confirmation atomically decrements available materials, increments reserved materials, saves the job and its world version, and records the operation result. Completion consumes the reservation and commits final objects in one transaction. Cancellation returns reserved materials and marks the job terminal in one transaction. Only one terminal transition wins; delayed worker responses cannot resurrect cancelled jobs.

Completed tutorial undo is a separate authorized, versioned operation with dependency/use checks. It never reuses cancellation logic after resources are consumed. Worker attempts are bounded, and progress cannot silently reserve more materials than the approved quote.

## Commit, publication and restore

Insert a minimal outbox/state-change record in the transaction for durable mutations. After commit, reconcile/broadcast room state and mark publication acknowledged. Replay after a crash can republish, so clients apply versioned results idempotently. Exactly-once network delivery is not assumed.

Persist movement checkpoints every five seconds and on clean shutdown; initial maximum movement loss target is five seconds on crash, while accepted resource/world changes must not be lost. Store the last safe anchored/docked fallback and avoid saving invalid positions. This is a target requiring DEV-015 crash tests, not a demonstrated guarantee.

Save a versioned world snapshot on empty-room suspension and periodic bounded checkpoints. Restore durable objects, inventory, grants and jobs before admitting clients. Serialize or lock competing room restore/admission so only one authoritative room exists per crew. Keep snapshots replaceable from authoritative records; unbounded history is not a backup strategy.

## Immediate acceptance for DEV-002–004

Schemas reject malformed/non-finite/oversized commands. Foreign/revoked identities cannot mutate a crew. Four-seat admissions and duplicate grants are correct under concurrency. A crash after commit but before broadcast produces the original durable result after restore. Cancel/complete races refund or complete once, never both. No credentials, prompts or personal data enter routine metrics.

Resolve any contradictory middleware/library behavior through a recorded decision and tests before implementing downstream features. A child pilot still requires its separate consent, retention/deletion and provider approval gate.
