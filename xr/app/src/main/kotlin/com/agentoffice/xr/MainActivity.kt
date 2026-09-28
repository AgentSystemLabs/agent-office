package com.agentoffice.xr

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import kotlinx.coroutines.withContext

private const val TAG = "MainActivity"

class MainActivity : ComponentActivity() {

    /**
     * The protocol client, held in state so rescanning a QR rebuilds it: the TLS pin scopes a
     * client instance to exactly one office certificate (see `TlsPins`), so a new pairing — a
     * new pin — needs a new client. Recomposition re-subscribes to the new flows. Null only
     * until the vault loads on startup.
     */
    private var client: OfficeProtocolClient? by mutableStateOf(null)

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        requestAllRuntimePermissions()
        // EncryptedSharedPreferences init + load do disk I/O and Keystore-backed
        // crypto, so keep them off the main thread to avoid a startup ANR. The
        // UI starts on "Starting…" and flips once auto-connect runs. The client is
        // built here (not above) because auto-connect needs the vault's stored pin
        // before the first socket exists.
        lifecycleScope.launch(Dispatchers.IO) { startClient() }
        maybeInjectDebugPairing(intent)

        setContent {
            val c = client
            val connection by c?.connectionState?.collectAsStateWithLifecycle()
                ?: remember { mutableStateOf(ConnectionState.Idle) }
            val snapshot by c?.snapshot?.collectAsStateWithLifecycle()
                ?: remember { mutableStateOf(null) }
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
                // No client yet (vault still loading): hold "Starting…" rather than flashing the scanner.
                uiState = if (c == null) XrUiState.Connecting("Starting…", null, null)
                else uiStateFor(connection, snapshot, isPaired),
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

    private fun buildClient(certPin: String?): OfficeProtocolClient =
        ClientWiring.buildProtocolClient(
            context = this,
            scope = lifecycleScope,
            onTokenClaimed = { serverUrl, token, pin ->
                // Vault I/O (disk + Keystore) stays off the main thread. Async is fine:
                // the vault is only read on the next launch; this launch connects now.
                lifecycleScope.launch(Dispatchers.IO) {
                    PairedOfficeStore.init(applicationContext)
                    PairedOfficeStore.save(
                        PairedOffice(
                            serverUrl = serverUrl,
                            deviceToken = token,
                            pairedAtEpochMs = System.currentTimeMillis(),
                            certPin = pin,
                        ),
                    )
                }
            },
            certPin = certPin,
        )

    /** Runs on Dispatchers.IO: load the vault, build the client (with the stored pin), connect. */
    private suspend fun startClient() {
        PairedOfficeStore.init(applicationContext)
        val office = PairedOfficeStore.load()
        // State write + client construction hop to Main: mutableStateOf is main-confined.
        val built = withContext(Dispatchers.Main) {
            buildClient(office?.certPin).also { client = it }
        }
        if (office != null) built.connect(office.serverUrl, office.deviceToken)
    }

    private fun onQrPayload(payload: PairingPayload) {
        // A new pairing means a new pin (or none): rebuild the client so the claim and the
        // socket both run under exactly this office's certificate. Same path for first-run
        // pairing, rescans, and debug injection.
        client?.disconnect()
        val c = buildClient(payload.pin)
        client = c
        c.pair(payload)
    }

    private fun onForget() {
        client?.disconnect()
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
