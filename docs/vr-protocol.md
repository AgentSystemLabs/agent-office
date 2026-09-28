# VR / native-client protocol

This is the contract the headset team builds against. It covers everything a native
(non-browser) client needs beyond the shared wire protocol in `src/shared/protocol.ts`:
how a headset pairs, how it authenticates, and the two protocol additions for native
clients (`welcome.protocolVersion` and `screens.off`).

All WebSocket messages are JSON objects with a `t` discriminant, exactly as the web
client speaks them. Once authenticated, a native client sends the same `ClientMsg`
values and handles the same `ServerMsg` values; see `protocol.ts` for the full list.

## Pairing flow

A headset has no cookie jar and nobody types a password into it. Instead the logged-in
laptop shows a short code (as a QR) and the headset trades it once for a long-lived token.

```
laptop (logged in)                      headset
    |                                      |
    |-- POST /api/pair/start ------------->|  (laptop only; needs its session cookie)
    |<-- { code, expiresAt }               |
    |                                      |
    |   🥽 panel shows QR { url, code }    |
    |   ──────────────────────────────>    |  (user scans it on the headset)
    |                                      |
    |   POST /api/pair/claim { code, name }|  (no auth)
    |<-------------------------------------|
    |   { token, name }                    |
    |------------------------------------->|  (store the token; it is shown once)
```

1. **Start** — `POST /api/pair/start`, with the laptop's session cookie.
   Returns `{ code, expiresAt }`. The code is 8 human-readable chars
   (Crockford base32, no lookalikes) and expires after 10 minutes.
   Only one code is ever open: starting a new one voids the old.
   Rate-limited like login attempts (10 per IP per 5 minutes, then 429).
2. **Claim** — `POST /api/pair/claim { code, name }`, no auth. `name` is what the
   device calls itself ("Quest 3", max 64 chars). Single-use: claiming consumes
   the code. Returns `{ token, name }`.
   A wrong, used, or expired code returns **404** with a generic error — the same
   answer for all three, so codes can't be enumerated. Claim attempts are
   rate-limited per IP (10 per 5 minutes, then 429).
3. **Keep the token.** It is 32 random bytes (base64url) and is shown exactly once.
   The server keeps only its SHA-256 hash. Tokens live in
   `.agent-office/devices.json`, so they survive restarts; unclaimed codes live in
   memory only, so a restart voids them.

Managing devices (session auth, i.e. the laptop):

- `GET /api/pair/list` → `{ devices: [{ id, name, createdAt, lastSeenAt? }] }`
- `POST /api/pair/revoke { tokenId }` → `{ ok: true }`, or 404 for an unknown id.
  Revoking signs the device out at once: its live socket is closed with code 4001,
  exactly like a revoked account.

## Bearer usage

Every `/api/*` endpoint that takes a session cookie also takes the device token:

```
Authorization: Bearer <token>
```

The cookie is always tried first; the bearer is a fallback for clients without one.
Cookie behavior is unchanged. `GET /api/whoami` answers `{ ok: true, me }` for a
device exactly as for a session. `lastSeenAt` is updated on use (written to disk at
most once a minute per device).

The WebSocket upgrade at `/ws` accepts the token two ways:

- `Authorization: Bearer <token>` header (preferred), or
- `?token=<token>` query param (fallback for native WebSocket stacks that can't set
  headers), e.g. `ws://192.168.1.5:4600/ws?token=…&name=…&floor=…`.

A device connection authenticates as its paired identity: its peer name is the claimed
name (the `?name=` param and `profile` renames are ignored for devices, as for
account sessions), and it is marked online like anyone else. The usual `welcome`
burst follows (see below), after which the protocol is identical.

### Origin

Browser upgrades must send an `Origin` header matching the office's host (CSRF
protection). Native clients send no `Origin`; the upgrade lets them in **only with a
valid bearer token**. A missing or non-matching `Origin` with no (or a bad) token is
still refused with 401. Cookie-authed upgrades always need the `Origin` to match.

## welcome.protocolVersion

`welcome` carries `protocolVersion` (currently `1`, exported as `PROTOCOL_VERSION`
from `src/shared/protocol.ts`). Native clients must **fail loudly on an unknown major
version** — show "update the app / the office" and stop — rather than mis-render
messages whose shape changed under them. Minor additions (a new `t` value, an optional
field) never bump the version; removing or re-shaping anything does.

## screens.off

Workers stream two channels: structured `screen` frames (for the in-world laptop
displays, sent to everyone on the floor) and raw `term.data` bytes (for open
terminals, sent to attached viewers only). A headset showing full terminals can skip
the first:

```
→ { t: 'screens.off', off: true }    stop sending this connection `screen` frames
→ { t: 'screens.off', off: false }   send them again (whole frames, so nothing is missed)
```

Default is `false`. `term.data` streams either way. The flag is per connection and is
forgotten on disconnect.

## QR payload schema

The laptop's 🥽 panel shows a QR code encoding this JSON (plus the human-readable code
and an expiry countdown, with Refresh and Done):

```json
{ "url": "ws://192.168.1.5:4600", "code": "K7Q2M9XD" }
```

With TLS the QR carries a third field, the office's certificate pin:

```json
{ "url": "wss://192.168.1.5:4600", "code": "K7Q2M9XD", "pin": "sha256/…" }
```

| field | meaning |
| ----- | ------- |
| `url` | The office's **ws(s)** URL as the headset reaches it. Never localhost: it comes from `GET /api/server-url` (session auth), which prefers the explicit `--public-url` flag / `AGENT_OFFICE_PUBLIC_URL` env, else the server's LAN IP + port + scheme (`wss` when the office serves TLS). |
| `code` | The pairing code from `POST /api/pair/start`, for `POST /api/pair/claim`. |
| `pin` | Optional. `sha256/<base64>` over the DER bytes of the office's TLS certificate, from `GET /api/server-url`'s `fingerprint` field. Present only when the office serves TLS itself; see below. |

The headset flow: scan → `POST {url}/api/pair/claim { code, name }` (over https,
i.e. the same host with the http(s) scheme) → store `token` → open
`{url}/ws?token=…` → expect `welcome` with a known `protocolVersion`.

## TLS pinning

A LAN office typically serves TLS with a generated self-signed certificate
(`--self-signed`): no public CA will vouch for it, so a native client using the
system trust store would fail every TLS handshake with no path forward. The pin
fixes the bootstrap: the laptop is already logged in over the office session, so
the fingerprint it prints into the QR is trustworthy, and scanning the QR is the
user's consent to trust exactly that certificate. The client pins the hash (a
certificate-hash pin, not SPKI: the presented chain is accepted iff one of its
certificates hashes to the pin), replacing the CA ladder and hostname verification
for that office; unpinned offices keep the full default checks.

- The pin is only as stable as the office's cert. `--self-signed` persists
  `tls-cert.pem` in the office data dir, so pins survive restarts; wiping the data
  dir (or rotating `--tls-cert`) regenerates the cert and paired headsets must
  re-pair. A stored pin against a new cert fails fast with "The office's
  certificate changed — re-pair", not a silent reconnect loop.
- No pin is sent when the office serves plain `ws`, or when `--public-url` is set:
  the public URL may terminate TLS at a proxy whose certificate the office doesn't
  know. Such offices verify through the system trust store (i.e. the proxy needs a
  publicly-trusted certificate).
- Older headsets ignore the unknown `pin` field and pair as before (cleartext, or
  system trust for `wss`); older offices send no `pin`, and new headsets fall back
  to system trust with a re-pair hint on failure.

## Server flags

- `--public-url <url>` (env `AGENT_OFFICE_PUBLIC_URL`): the office's URL as the
  outside world reaches it, e.g. `https://office.example.com`. Used for the QR
  payload and for tunnels/reverse proxies where the LAN address is wrong.
