package com.agentoffice.xr.qr

import com.agentoffice.xr.net.httpBaseUrlOf
import java.net.URI
import org.json.JSONObject

/**
 * Decoded contents of an agent-office pairing QR code.
 *
 * Contract schema (`docs/vr-protocol.md`, "QR payload schema"):
 *   `{ "url": "ws://host:port", "code": "PAIRCODE" }`
 *
 * `url` is the office BASE (no `/ws` path) as the headset reaches it; `code` is the
 * short-lived pairing code claimed for a device token via `POST /api/pair/claim`
 * (see `ClaimService`). The base is normalized to the `/ws` endpoint at connect time
 * (see `normalizeServerUrl`) — a URL that already ends in `/ws` passes through
 * untouched, so both shapes work. Everything is required; parsing rejects
 * payloads missing any field rather than silently substituting defaults (fail-fast).
 *
 * Uses [java.net.URI] (not `android.net.Uri`) so the parser is reachable from plain-JVM
 * unit tests — the project's `unitTests.isReturnDefaultValues = true` flag would silently
 * null out every `android.net.Uri` accessor on the host JVM. (Parser shape adapted from
 * orbXR's `PairingPayload`.)
 */
data class PairingPayload(
    /** Office base URL from the QR, e.g. `ws://192.168.1.5:4600`. */
    val serverUrl: String,
    /** Short-lived pairing code to exchange for a device token. */
    val code: String,
) {
    /**
     * `http(s)` base derived from [serverUrl], e.g. `ws://host:4600/ws` →
     * `http://host:4600`. Used for the REST claim call.
     */
    val httpBaseUrl: String
        get() = httpBaseUrlOf(serverUrl)

    /**
     * `Origin` header value for the WebSocket upgrade. The server's same-origin check
     * requires an Origin whose host equals Host, so this is the `http(s)` form of the
     * paired host (including the port when the URL carries one).
     */
    val originHeader: String
        get() = httpBaseUrlOf(serverUrl)

    companion object {
        fun parse(raw: String): Result<PairingPayload> = runCatching {
            val trimmed = raw.trim()
            require(trimmed.isNotEmpty()) { "empty QR payload" }
            val json = try {
                JSONObject(trimmed)
            } catch (e: Exception) {
                throw IllegalArgumentException("QR payload is not a JSON object", e)
            }
            val url = json.optString("url", "").trim()
            require(url.isNotEmpty()) { "missing url in QR payload" }
            val uri = try {
                URI(url)
            } catch (e: Exception) {
                throw IllegalArgumentException("invalid url '$url'", e)
            }
            require(uri.scheme == "ws" || uri.scheme == "wss") {
                "expected ws:// or wss:// scheme, got ${uri.scheme}"
            }
            val host = uri.host?.takeIf { it.isNotBlank() }
                ?: error("missing host in url '$url'")
            val port = uri.port
            require(port == -1 || port in 1..65535) { "invalid port $port" }
            val code = json.optString("code", "").trim()
            require(code.isNotEmpty()) { "missing code in QR payload" }
            PairingPayload(serverUrl = url, code = code)
        }
    }
}
