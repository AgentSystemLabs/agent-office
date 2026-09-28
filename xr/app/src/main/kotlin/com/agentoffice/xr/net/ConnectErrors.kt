package com.agentoffice.xr.net

import java.security.cert.CertificateException
import javax.net.ssl.SSLPeerUnverifiedException

/**
 * Which connection failures are TLS trust failures — retrying won't help — and what to tell
 * the user. Both fatal shapes (a rotated office cert against a stored pin, an unpinned
 * self-signed office) are fixed by re-pairing, so both say so; anything else keeps the
 * underlying message and keeps the old retry behavior.
 */
object ConnectErrors {
    private const val PIN_MARKER = "pinned fingerprint"
    private val TLS_MARKERS = listOf(
        PIN_MARKER, // our PinnedTrustManager: the office regenerated its cert
        "trust anchor", // system trust rejected the chain (unpinned self-signed office)
        "certification path",
        "not verified", // hostname verification (mispointed wss URL)
        "certificate",
    )

    /**
     * True when the failure is TLS trust rather than a dropped network. Deliberately narrow:
     * a false positive strands the user on the failure screen (the only escape is forgetting
     * a good pairing), so plain network errors (socket, timeout, DNS, HTTP upgrade) stay
     * transient and keep reconnecting.
     */
    fun isTlsFailure(t: Throwable): Boolean =
        generateSequence(t) { it.cause }.any { e ->
            e is CertificateException || e is SSLPeerUnverifiedException ||
                TLS_MARKERS.any { marker -> e.message?.contains(marker, ignoreCase = true) == true }
        }

    /** User-facing text for a fatal socket failure. TLS causes get the re-pair hint. */
    fun failureText(t: Throwable): String {
        if (!isTlsFailure(t)) return t.message ?: "connection failed"
        val rotated = generateSequence(t) { it.cause }
            .any { it.message?.contains(PIN_MARKER, ignoreCase = true) == true }
        return if (rotated) {
            "The office's certificate changed — re-pair from the laptop's VR panel."
        } else {
            "The office's certificate isn't trusted by this headset — re-pair from the laptop's VR panel."
        }
    }

    /** User-facing text for a failed pair claim. Non-TLS causes keep the old message. */
    fun claimText(e: Exception): String =
        if (isTlsFailure(e)) failureText(e) else e.message ?: "claim failed"
}
