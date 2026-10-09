# Telegram owner bridge

Back to the [README](../README.md).

An opt-in bridge lets one paired private Telegram owner ask the configured agency leader questions, see team status, and receive named campaign reports and design exports. It does not publish social posts or provide remote terminal access. A Node.js 22+ hosted relay receives webhooks; a local connector makes outbound HTTPS requests. The office stays on loopback and native agent authentication and permission prompts remain active. The Mac and office must stay running to perform work or retrieve local exports.

## Setup

1. Deploy only `integrations/telegram/` as a Node.js 22/24 Web App. Hostinger entry `hostinger-entry.mjs` starts the server when imported by its runtime; ordinary direct Node execution uses `npm start`. No dependencies/build. Hostinger Business/Cloud supports ZIP upload. Confirm its private `data/queue.json` persists across restart and redeploy before production. Use one relay instance; no horizontal scaling.
2. Configure the cloud secrets below in hosting environment settings, never Git/public_html. Pair using a trusted local inspection of the owner's `/start` update and verify the numeric ID with the owner. Do not guess it, use the bot ID, or automatically grant the first caller access.
3. Configure the office process with `AGENT_OFFICE_TELEGRAM_LOCAL_TOKEN` (a third independent random 32+ character secret) and `AGENT_OFFICE_TELEGRAM_LEADER_ID` (existing leader). Coordinate restart to load the feature/configuration; do not interrupt live workers silently.
4. Run `node connector.mjs` with `TELEGRAM_RELAY_URL` (HTTPS origin), `TELEGRAM_RELAY_TOKEN`, `AGENT_OFFICE_TELEGRAM_LOCAL_TOKEN`, optionally `AGENT_OFFICE_TELEGRAM_OFFICE_URL` (default `http://127.0.0.1:4600`; numeric loopback only). No bot token, worker hook token, browser cookie, SSH access, or public tunnel is needed on the connector.
5. After deployment and pairing are approved, run `node setup-webhook.mjs` with cloud variables, `TELEGRAM_RELAY_URL`, and `TELEGRAM_EXPECTED_BOT_USERNAME`. It verifies bot identity, refuses to replace a different webhook, preserves pending updates, and checks webhook configuration. Verify real owner `/help`, `/status`, report/design delivery and leader reply before reporting connected.

On Hostinger without a shell, the optional `npm run build` command performs that same setup only when `TELEGRAM_ACTIVATE_WEBHOOK=1` is explicitly configured alongside `TELEGRAM_RELAY_URL` and `TELEGRAM_EXPECTED_BOT_USERNAME`. Its default is a no-op. After the approved activation succeeds, remove the activation flag and return the build command to None. This avoids moving the bot token to the local connector. Keep the runtime entry `hostinger-entry.mjs`.

| Cloud variable | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather token |
| `TELEGRAM_WEBHOOK_SECRET` | Independent random 32+ character URL-safe secret |
| `TELEGRAM_RELAY_TOKEN` | Different random 32+ character URL-safe connector secret |
| `TELEGRAM_ALLOWED_USER_ID` | Verified owner numeric Telegram ID |
| `TELEGRAM_ALLOWED_CHAT_ID` | Same ID; private owner chat only |
| `TELEGRAM_DATA_DIR` | Private persistent directory; default `./data` |
| `PORT` | Host-provided port, default 3000 |

## Commands and leader replies

```text
/help
/status
/ask viniela-design Ringkas hasil review terakhir, jangan produksi baru.
/report viniela-design feed-design-test-20261008
/design viniela-design feed-design-test-20261008 v06
/file .agent-office/artiq-studio/brands/viniela-design/reports/feed-design-test-20261008/design-review-v06.md
```

`/report <brand> <campaign>` fetches exactly `reports/<campaign>/report.md`; if absent it reports unavailable. `/report <brand>` lists up to 20 available reports within that brand and delivers automatically only when exactly one is available; multiple reports require an explicit campaign selection. `/file` retrieves another allowed named export. `/design` sends the mobile PNG as a preview photo, full PNG as an uncompressed document, and copy.md. This is delivery to the paired owner, not public publication. Brand/campaign/version selection is explicit. The owner can access all local agency brands; this is not a client-facing bot.

The leader receives a prompt and writes `.agent-office/telegram/replies/tg-<update-id>.json` after completion: `{"brand_id":"viniela-design","text":"reply","files":[]}`. Up to five relative campaign export paths may be supplied in files. It is a reply convention, not extraction of terminal transcripts. Reports, reviews, copy, strategy, sources, delivery notes, export manifests, full/mobile PNGs and editable SVGs are allowlisted; assets, accounts, source code and arbitrary JSON are inaccessible. Combined file bytes are at most 8 MB and the JSON HTTP body at most 12 MB; large combinations require separate `/file` requests. Symlinks are rejected.

## Safety and failures

When the leader needs input, `/ask` returns a notice instead of pasting into its question or permission dialog. Resolve that prompt in the local office, then send a new instruction; the bot cannot approve native permissions.

The registered `/api/telegram/` feature is disabled by default, uses a dedicated local token, and rejects non-loopback clients and browser Origin headers. Relay webhooks require the Telegram secret header and both the owner's private user/chat IDs. Bot/group senders are rejected. No hire, shell, native permission approval, or publication endpoint is provided.

Disk journals deduplicate webhook updates and leader prompts. Crashes during prompt dispatch are reported uncertain rather than replaying instructions. Ambiguous Telegram sends are retained without automatic retry; inspect before resending. A crash during send leaves `sending` evidence for operator diagnosis. Offline Mac requests queue up to 64 unfinished jobs. Persist queue/journals and run a single connector; losing them loses deduplication history. These are operational safeguards, not an intercept of all agent behavior.

To disconnect, remove the Telegram webhook, stop the connector, and remove office token/leader settings. Rotate the three independent credentials before reconnecting. Do not log token-bearing Telegram URLs, expose queues/replies through static hosting, or ship secret environment files in ZIPs.

## Validation

Run repository `npm run typecheck`, `npm test`, `npm run build`, and `npm test --prefix integrations/telegram`. Offline tests cover owner isolation, authenticated webhooks, duplicate instructions/delivery, cross-brand exports, symlinks/size limits and simulated preview/document delivery. They do not prove live Hostinger deployment, Telegram pairing or an actual worker reply; those require paired-owner end-to-end tests.
