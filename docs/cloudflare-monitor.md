# Cloudflare monitoring from Agent Office

Open **☰ → Cloudflare status**, **Services → Cloudflare domains, status and errors**, or the **Cloudflare status** button in 2D view. Agent Office performs the checks on the computer running Office, independently of agents and whether the panel is open. Keep Office running; shutdown, sleep or network loss interrupts monitoring. No monitoring Worker or website-side agent is installed.

Create `cloudflare-monitor.json` in the Office building's `.agent-office` directory:

```json
{ "enabled": true, "credentialFile": "G:/your-folder/Cloudflare account API key.txt" }
```

The credential file must contain exactly one `Authorization: Bearer TOKEN` and one Cloudflare `/accounts/ACCOUNT_ID/` URL. Keep it private. Configuration stores its path only; Office reads credentials in memory. Drive removal/rotation is detected. Do not put a token in source, launch arguments, prompts or browser settings.

Every five minutes Office reads the live Cloudflare API for zones, web DNS names, Worker custom domains/routes/scripts and Pages. It never imports saved domain inventories. API coverage/permission failures are shown. Every minute it independently requests HTTPS `/` on discovered domains, with public DNS addresses pinned to the connection, TLS verification, deadlines, response bounds and four-request concurrency. Redirect destinations are not followed. Wildcard-only names cannot be probed without a concrete domain.

Statuses distinguish reachable, redirect, restricted, error and unknown. A reachable root does not validate login, APIs, checkout or every path. Cloudflare error codes/ray IDs are shown when observed. Last-15-minute aggregate Worker analytics shows request/error counts and outcome categories. No returned traffic does not establish zero errors. These are sampled analytics, not complete console/exception logs. Missing permissions remain visible and telemetry settings are never changed automatically.

Only authenticated Office sessions can read `/api/domain-monitor`. Current observations are saved atomically in `cloudflare-monitor-latest.json`; startup always performs fresh discovery rather than loading it as inventory. No raw page bodies, cookies, credentials or console logs are saved. Close with ✕ or Esc. To disable, set `enabled` false locally; it takes effect at the next check. Restore the prior installed build/configuration backup to roll back.
