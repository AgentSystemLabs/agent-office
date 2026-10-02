# Environments, deployment, and recovery

Status: requirements for the future game; nothing here is provisioned yet.

## Environment separation

| Environment | Data and purpose |
| --- | --- |
| Local | Synthetic fixtures; isolated database; fake provider by default |
| CI | Ephemeral test data and least-privilege test credentials |
| stage | Synthetic or approved adult testers; release acceptance; separate provider budget |
| PROD | Only approved live users, policies, providers and operations |

Use separate credentials, databases/buckets, provider projects or equivalent controls, budgets and retention policies. Never copy child-production records into staging or local development. Stage is access-controlled, not a public bypass around launch safeguards.

## Candidate and deployment

Build an immutable artifact from the selected stage commit; record digest, dependency lockfile, schema version and configuration version. Promote the same artifact after review. Environment configuration changes receive review and a versioned record; secrets stay outside source/artifacts.

Before promotion: verify access policies, TLS/origin checks, quotas, database migrations, backups, provider arrangements, capacity cap, alerts, reporting availability, and an accountable release owner. Deploy through protected automation with least privilege and environment approval.

Use backward-compatible expand/contract migrations. Coordinate schema and server versions explicitly. Do not remove old fields until previous releases no longer require them. Restore rehearsal must use approved synthetic data and demonstrate readable worlds, reconciled reservations and reward history.

Drain game sessions during releases: stop assigning new rooms, notify players, checkpoint durable state, then restart with bounded reconnect. Test mixed client/server version behavior; use protocol compatibility or a clear reload path. No silent lost inventory or construction jobs.

## Rollback and incidents

Each release has a previous artifact, compatible configuration, migration assessment and rollback instructions. Application rollback is different from database restore. Do not restore an old snapshot over legitimate later rewards/spends without a reviewed reconciliation plan.

On incident: contain harm, disable the affected feature/provider or admission if necessary, preserve minimal relevant evidence, restore safe play, communicate appropriately, and document root cause and corrective tasks. AI outage should retain manual play. Security/privacy incidents require the selected jurisdiction's escalation and notification process, defined before launch.

## Operational limits and observability

Set caps for active rooms, queue depth, request volume, provider spend, world complexity, inventory size and payload size. Alerts track error rates, authorization failures, tick lag, DB contention, restore failures, abandoned reservations, queue age, budget consumption and abuse reports.

Routine metrics use operation/session pseudonymous identifiers and omit free-text prompts, credentials and sensitive personal data. Define log retention and access before use; diagnostics must not become an indefinite child-data archive.

Assign owners for backups, budget alerts, moderation/reporting coverage, releases and incidents. Pilot availability must match actual coverage and capacity. A production label does not automatically authorize a public launch or paid subscription.
