package com.agentoffice.xr.vault

/**
 * The single office the headset is paired with, plus the device token that
 * authenticates the WebSocket connection. Persisted encrypted by [PairedOfficeStore]
 * so the headset skips the QR scanner on every launch after the first pairing.
 */
data class PairedOffice(
    /** WebSocket endpoint, e.g. `ws://192.168.1.10:4600/ws`. */
    val serverUrl: String,
    /** Long-lived device token from `POST /api/pair/claim`. Never logged. */
    val deviceToken: String,
    /** When pairing completed, epoch millis. */
    val pairedAtEpochMs: Long,
    /**
     * `sha256/…` pin for the office's TLS certificate (see `TlsPins`), or null for cleartext
     * offices and pairings from before pins existed. Persisted alongside the token because the
     * socket factory needs it on every auto-connect, not just at pair time.
     */
    val certPin: String? = null,
)
