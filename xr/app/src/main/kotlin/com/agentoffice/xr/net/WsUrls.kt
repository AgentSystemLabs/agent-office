package com.agentoffice.xr.net

import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * Query params sent on the `/ws` upgrade, per the vr-proto CONNECT handshake:
 * `?name=&color=&skin=&hair=&style=&floor=` plus `?token=` for the device token.
 */
data class ConnectOptions(
    val name: String = DEFAULT_NAME,
    val color: String = DEFAULT_COLOR,
    val skin: Int = 0,
    val hair: Int = 0,
    val style: Int = 0,
    /**
     * Floor to land on. Blank = omit the param; the server seats us on the
     * first floor.
     */
    val floor: String = "",
) {
    companion object {
        const val DEFAULT_NAME = "VR Guest"

        /** Office blue — matches the server's own fallback color. */
        const val DEFAULT_COLOR = "#4F86F7"
    }
}

/**
 * `http(s)` base derived from a `ws(s)` server URL, e.g. `ws://host:4600/ws` →
 * `http://host:4600`. Used for REST calls and for the `Origin` header the server's
 * same-origin WS check requires (host must equal Host).
 */
fun httpBaseUrlOf(serverUrl: String): String {
    val uri = URI(serverUrl)
    val scheme = if (uri.scheme == "wss") "https" else "http"
    val host = uri.host ?: error("missing host in url '$serverUrl'")
    val bracketed = if (':' in host) "[$host]" else host
    val portPart = if (uri.port == -1) "" else ":${uri.port}"
    return "$scheme://$bracketed$portPart"
}

/**
 * Normalize a QR/paired server URL to the WebSocket endpoint.
 *
 * Per `docs/vr-protocol.md` the QR carries the office BASE (`ws://host:port`, no path).
 * When the path is empty or exactly `/`, `/ws` is appended; a URL that already carries
 * a path (e.g. a full `…/ws` endpoint) passes through untouched. Fail-fast on bad
 * scheme/host.
 */
fun normalizeServerUrl(serverUrl: String): String {
    val trimmed = serverUrl.trim()
    val uri = try {
        URI(trimmed)
    } catch (e: Exception) {
        throw IllegalArgumentException("invalid serverUrl '$serverUrl'", e)
    }
    require(uri.scheme == "ws" || uri.scheme == "wss") {
        "expected ws:// or wss:// scheme, got ${uri.scheme}"
    }
    require(uri.host?.isNotBlank() == true) { "missing host in serverUrl '$serverUrl'" }
    val path = uri.rawPath ?: ""
    if (path.isNotEmpty() && path != "/") return trimmed
    val cut = trimmed.indexOfFirst { it == '?' || it == '#' }
        .let { if (it == -1) trimmed.length else it }
    val base = trimmed.substring(0, cut).removeSuffix("/")
    return base + "/ws" + trimmed.substring(cut)
}

/**
 * Full WebSocket connect URL: [serverUrl] plus the [ConnectOptions] params and the
 * `?token=` device-token param, query-encoded. Fail-fast on bad scheme/host/token.
 * The returned URL carries the secret token — never log it.
 */
fun buildConnectUrl(serverUrl: String, token: String, options: ConnectOptions): String {
    // The contract QR carries the office base (ws://host:port); normalize to the /ws
    // endpoint first — without it the upgrade would hit the wrong path and fail.
    // Full /ws URLs pass through untouched.
    val endpoint = normalizeServerUrl(serverUrl)
    require(token.isNotBlank()) { "missing device token" }
    val base = endpoint.substringBefore('#')
    val sep = if ('?' in base) '&' else '?'
    val params = buildList {
        add("name" to options.name.ifBlank { ConnectOptions.DEFAULT_NAME })
        add("color" to options.color.ifBlank { ConnectOptions.DEFAULT_COLOR })
        add("skin" to options.skin.toString())
        add("hair" to options.hair.toString())
        add("style" to options.style.toString())
        if (options.floor.isNotBlank()) add("floor" to options.floor)
        add("token" to token)
    }
    return base + sep + params.joinToString("&") { (k, v) -> "$k=${v.encodeQuery()}" }
}

private fun String.encodeQuery(): String = URLEncoder.encode(this, StandardCharsets.UTF_8.name())
