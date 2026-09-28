package com.agentoffice.xr.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import com.agentoffice.xr.net.OfficeSnapshot
import com.agentoffice.xr.qr.PairingPayload
import com.agentoffice.xr.ui.connecting.ConnectingScreen
import com.agentoffice.xr.ui.dashboard.DashboardScreen
import com.agentoffice.xr.ui.pairing.QrScannerScreen
import com.agentoffice.xr.ui.theme.OfficeTokens

/**
 * Top-level UI mode. The root composable switches between them with early returns:
 * scanner → status → dashboard. (Same pattern as orbXR's `GhosttyXRApp` mode switches.)
 */
sealed interface XrUiState {
    /** No pairing yet — show the QR scanner. */
    data object NeedsPairing : XrUiState

    /** Claiming, connecting, reconnecting, or failed — show status + rescan escape. */
    data class Connecting(val status: String, val serverUrl: String?, val error: String?) : XrUiState

    /** Live protocol connection — show the dashboard. */
    data class Connected(val snapshot: OfficeSnapshot, val serverUrl: String, val connectionLabel: String) : XrUiState
}

@Composable
fun AgentOfficeXRApp(
    uiState: XrUiState,
    onPaired: (PairingPayload) -> Unit = {},
    onForget: () -> Unit = {},
    spatialEnabledOverride: Boolean? = null,
) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            background = OfficeTokens.Background,
            surface = OfficeTokens.Surface,
            onBackground = OfficeTokens.OnSurface,
            onSurface = OfficeTokens.OnSurface,
            primary = OfficeTokens.Accent,
            error = OfficeTokens.Danger,
        ),
    ) {
        AdaptiveShell(spatialEnabledOverride = spatialEnabledOverride) {
            if (uiState is XrUiState.NeedsPairing) {
                QrScannerScreen(onPaired = onPaired)
                return@AdaptiveShell
            }
            if (uiState is XrUiState.Connected) {
                DashboardScreen(
                    snapshot = uiState.snapshot,
                    serverUrl = uiState.serverUrl,
                    connectionLabel = uiState.connectionLabel,
                    onForget = onForget,
                )
                return@AdaptiveShell
            }
            val connecting = uiState as XrUiState.Connecting
            ConnectingScreen(
                status = connecting.status,
                serverUrl = connecting.serverUrl,
                error = connecting.error,
                onForget = onForget,
            )
        }
    }
}
