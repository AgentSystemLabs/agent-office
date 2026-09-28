package com.agentoffice.xr

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.agentoffice.xr.net.ConnectionState
import com.agentoffice.xr.net.OfficeProtocolClient
import com.agentoffice.xr.net.OfficeSnapshot
import com.agentoffice.xr.qr.DebugPairing
import com.agentoffice.xr.qr.PairingPayload
import com.agentoffice.xr.qr.PendingPairing
import com.agentoffice.xr.ui.AgentOfficeXRApp
import com.agentoffice.xr.ui.XrUiState
import com.agentoffice.xr.vault.PairedOffice
import com.agentoffice.xr.vault.PairedOfficeStore
import com.agentoffice.xr.wiring.ClientWiring
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

private const val TAG = "MainActivity"

class MainActivity : ComponentActivity() {

    private lateinit var client: OfficeProtocolClient

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        client = ClientWiring.buildProtocolClient(
            context = this,
            scope = lifecycleScope,
            onTokenClaimed = { serverUrl, token ->
                // Vault I/O (disk + Keystore) stays off the main thread. Async is fine:
                // the vault is only read on the next launch; this launch connects now.
                lifecycleScope.launch(Dispatchers.IO) {
                    PairedOfficeStore.init(applicationContext)
                    PairedOfficeStore.save(
                        PairedOffice(
                            serverUrl = serverUrl,
                            deviceToken = token,
                            pairedAtEpochMs = System.currentTimeMillis(),
                        ),
                    )
                }
            },
        )

        requestAllRuntimePermissions()
        // EncryptedSharedPreferences init + load do disk I/O and Keystore-backed
        // crypto, so keep them off the main thread to avoid a startup ANR. The
        // UI starts on the scanner and flips once auto-connect runs.
        lifecycleScope.launch(Dispatchers.IO) { maybeAutoReconnect() }
        maybeInjectDebugPairing(intent)

        setContent {
            val connection by client.connectionState.collectAsStateWithLifecycle()
            val snapshot by client.snapshot.collectAsStateWithLifecycle()
            val isPaired by PairedOfficeStore.isPaired.collectAsStateWithLifecycle()

            // Consume QR results at the Activity boundary so the exact same provisioning
            // path works for first-run pairing, rescans, and debug injection.
            LaunchedEffect(Unit) {
                PendingPairing.flow.collect { payload ->
                    payload?.let {
                        try {
                            onQrPayload(it)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to claim or connect QR payload", e)
                        } finally {
                            PendingPairing.clear()
                        }
                    }
                }
            }

            AgentOfficeXRApp(
                // The scanner stashes results in PendingPairing; the flow above owns the
                // single provisioning path, so no direct onPaired handling here.
                uiState = uiStateFor(connection, snapshot, isPaired),
                onForget = { onForget() },
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        maybeInjectDebugPairing(intent)
    }

    private fun requestAllRuntimePermissions() {
        val missing = RuntimePermissions.missing(this)
        if (missing.isNotEmpty()) permissionLauncher.launch(missing)
    }

    private suspend fun maybeAutoReconnect() {
        PairedOfficeStore.init(applicationContext)
        val office = PairedOfficeStore.load() ?: return
        client.connect(office.serverUrl, office.deviceToken)
    }

    private fun onQrPayload(payload: PairingPayload) {
        client.pair(payload)
    }

    private fun onForget() {
        client.disconnect()
        lifecycleScope.launch(Dispatchers.IO) {
            PairedOfficeStore.clear()
        }
    }

    /**
     * Emulator convenience: there's no camera to scan the laptop's pairing QR, so on
     * debug builds we let `adb` inject the same [PairingPayload] via intent extras
     * (see [DebugPairing]). Compiled out of release builds — the `BuildConfig.DEBUG`
     * branch is statically false there, so release always pairs through the QR scanner.
     */
    private fun maybeInjectDebugPairing(intent: Intent?) {
        if (!BuildConfig.DEBUG) return
        DebugPairing.fromIntent(intent)?.let { payload ->
            PendingPairing.set(payload)
        }
    }

    private fun uiStateFor(
        connection: ConnectionState,
        snapshot: OfficeSnapshot?,
        isPaired: Boolean,
    ): XrUiState = when (connection) {
        is ConnectionState.Connected ->
            if (snapshot != null) {
                XrUiState.Connected(snapshot, connection.serverUrl, "Connected")
            } else {
                XrUiState.Connecting("Waiting for office state…", connection.serverUrl, null)
            }
        is ConnectionState.Claiming ->
            XrUiState.Connecting("Claiming pairing code…", connection.serverUrl, null)
        is ConnectionState.Connecting ->
            XrUiState.Connecting("Connecting…", connection.serverUrl, null)
        is ConnectionState.Reconnecting ->
            XrUiState.Connecting(
                "Reconnecting (attempt ${connection.attempt})…",
                connection.serverUrl,
                null,
            )
        is ConnectionState.Failed ->
            XrUiState.Connecting("Connection failed", connection.serverUrl, connection.error)
        is ConnectionState.Idle ->
            if (isPaired) {
                XrUiState.Connecting("Starting…", null, null)
            } else {
                XrUiState.NeedsPairing
            }
    }
}
