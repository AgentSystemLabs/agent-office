package com.agentoffice.xr.qr

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * In-memory holder for the most recently scanned [PairingPayload]. The scanner screens
 * `set` it, `MainActivity` collects it at the Activity boundary (claim → connect) and
 * clears it, so every entry point shares one provisioning path. Never persisted to disk.
 * (Copied from orbXR's `PendingPairing`.)
 */
object PendingPairing {
    private val state = MutableStateFlow<PairingPayload?>(null)
    val flow: StateFlow<PairingPayload?> = state.asStateFlow()

    fun set(payload: PairingPayload) {
        state.value = payload
    }

    fun clear() {
        state.value = null
    }
}
