package com.agentoffice.xr.qr

import android.content.Intent
import android.util.Log
import org.json.JSONObject

/**
 * Debug-only pairing path for the emulator, where there's no camera to scan the pairing QR
 * shown on the laptop. Lets you inject the exact same [PairingPayload] the QR would decode
 * to via `adb`, e.g.:
 *
 * ```
 * # Pass the whole JSON payload the laptop shows under its QR:
 * adb shell am start -n com.agentoffice.xr/.MainActivity \
 *   -e ao_pair '{"url":"ws://10.0.2.2:4600/ws","code":"ABCD-1234"}'
 *
 * # Or just the pieces (url defaults to the emulator's host-Mac alias):
 * adb shell am start -n com.agentoffice.xr/.MainActivity \
 *   -e ao_code ABCD-1234
 *
 * # Against a self-signed local office over wss, add its pin (see TlsPins):
 * adb shell am start -n com.agentoffice.xr/.MainActivity \
 *   -e ao_url wss://10.0.2.2:4600/ws -e ao_code ABCD-1234 -e ao_pin 'sha256/…'
 * ```
 *
 * Wired only behind `BuildConfig.DEBUG` from `MainActivity`, so it's compiled out of
 * release builds — release devices pair via the QR scanner. (Adapted from orbXR's
 * `DebugPairing`.)
 */
object DebugPairing {
    private const val TAG = "DebugPairing"

    /** Full `{"url": …,"code": …}` JSON — same format the QR carries. */
    const val EXTRA_JSON = "ao_pair"

    // Piecewise overrides — convenient when you don't want to hand-assemble JSON.
    const val EXTRA_URL = "ao_url"
    const val EXTRA_CODE = "ao_code"

    /** `sha256/…` pin for a self-signed local office (piecewise form only; JSON carries its own). */
    const val EXTRA_PIN = "ao_pin"

    /**
     * The emulator reaches the developer machine (where agent-office runs) at this
     * loopback alias, on agent-office's default port 4600. Used as the url default so a
     * bare `-e ao_code …` launch pairs straight against the local office.
     */
    const val EMULATOR_SERVER_URL = "ws://10.0.2.2:4600/ws"

    /**
     * Build a [PairingPayload] from debug intent extras, or `null` if the intent
     * carries no pairing hints. Returns `null` (rather than throwing) on a
     * malformed payload so a normal launch falls through to the QR scanner.
     */
    fun fromIntent(intent: Intent?): PairingPayload? {
        if (intent == null) return null

        intent.getStringExtra(EXTRA_JSON)?.takeIf { it.isNotBlank() }?.let { json ->
            return PairingPayload.parse(json)
                .onFailure { Log.w(TAG, "ignoring malformed $EXTRA_JSON extra '$json'", it) }
                .getOrNull()
        }

        val code = intent.getStringExtra(EXTRA_CODE)?.takeIf { it.isNotBlank() }
        // Need at least a code to attempt a claim; otherwise there's nothing to
        // inject and we defer to the QR scanner.
        if (code == null) return null

        val url = intent.getStringExtra(EXTRA_URL)?.takeIf { it.isNotBlank() }
            ?: EMULATOR_SERVER_URL
        val pin = intent.getStringExtra(EXTRA_PIN)?.takeIf { it.isNotBlank() }

        Log.d(TAG, "injecting debug pairing for $url")
        val json = if (pin != null) {
            """{"url":${jsonQuote(url)},"code":${jsonQuote(code)},"pin":${jsonQuote(pin)}}"""
        } else {
            """{"url":${jsonQuote(url)},"code":${jsonQuote(code)}}"""
        }
        return PairingPayload.parse(json)
            .onFailure { Log.w(TAG, "ignoring malformed debug pairing extras", it) }
            .getOrNull()
    }

    private fun jsonQuote(s: String): String = JSONObject.quote(s)
}
