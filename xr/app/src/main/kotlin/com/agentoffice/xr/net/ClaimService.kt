package com.agentoffice.xr.net

/**
 * Exchanges a QR pairing code for a long-lived device token.
 *
 * Contract endpoint (`docs/vr-protocol.md`, "Pairing flow"):
 * `POST {httpBaseUrl}/api/pair/claim` with JSON `{ code, name }`, returning JSON
 * `{ token, name }`. We read `token` and ignore the echoed `name`.
 */
interface ClaimService {
    suspend fun claim(httpBaseUrl: String, code: String, name: String): Result<String>
}
