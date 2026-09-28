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
)
