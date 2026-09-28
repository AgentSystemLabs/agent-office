package com.agentoffice.xr.net

import android.util.Log
import com.agentoffice.xr.qr.PairingPayload
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import kotlin.coroutines.coroutineContext

private const val TAG = "OfficeProtocolClient"

/** Creates platform WebSockets. Production wraps OkHttp; tests use a fake. */
fun interface WebSocketFactory {
    fun newWebSocket(request: Request, listener: WebSocketListener): WebSocket
}

/** Connection lifecycle for UI. `serverUrl` never carries the token. */
sealed interface ConnectionState {
    data object Idle : ConnectionState
    data class Claiming(val serverUrl: String) : ConnectionState
    data class Connecting(val serverUrl: String) : ConnectionState
    data class Reconnecting(val serverUrl: String, val attempt: Int, val nextDelayMs: Long) : ConnectionState
    data class Connected(val serverUrl: String) : ConnectionState
    data class Failed(val serverUrl: String?, val error: String) : ConnectionState
}

/**
 * OkHttp WebSocket client for the agent-office protocol.
 *
 * - `pair()` runs the claim flow: `POST /api/pair/claim {code, name}` → device token
 *   → persisted via [onTokenClaimed] → connect.
 * - `connect()` opens `{base}/ws` with `?name=&color=&skin=&hair=&style=&floor=&token=`
 *   (the `?token=` fallback from `docs/vr-protocol.md`) and an `Origin` header in
 *   `http(s)` form matching the host.
 * - Drops reconnect with jittered [ReconnectPolicy] backoff, forever by default.
 * - Parses `welcome` + a minimal `peer.*` / `worker.*` / `floor.*` set into [snapshot];
 *   `welcome.protocolVersion` is recorded and logged; unknown `t` values are ignored
 *   so server skew fails soft (note: the contract asks native clients to fail loudly
 *   on an unknown major version — wired as log-only for this scaffold).
 * - Outbound ClientMsgs go through an unbounded send queue that survives reconnects.
 *
 * Transport, claim HTTP, scope, and clock are all injected so the logic unit-tests
 * with fakes and no emulator; Android-touching construction lives in `wiring`.
 */
class OfficeProtocolClient(
    private val webSocketFactory: WebSocketFactory,
    private val claimService: ClaimService,
    private val scope: CoroutineScope,
    private val onTokenClaimed: (serverUrl: String, token: String, certPin: String?) -> Unit = { _, _, _ -> },
    private val reconnectPolicy: ReconnectPolicy = ReconnectPolicy(maxAttempts = Int.MAX_VALUE),
    private val sleeper: suspend (Long) -> Unit = { delay(it) },
) {
    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Idle)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _snapshot = MutableStateFlow<OfficeSnapshot?>(null)
    val snapshot: StateFlow<OfficeSnapshot?> = _snapshot.asStateFlow()

    private val sendChannel = Channel<String>(Channel.UNLIMITED)

    @Volatile
    private var socket: WebSocket? = null
    private var connectJob: Job? = null

    /**
     * Claim [payload]'s pairing code for a device token, persist it via
     * [onTokenClaimed], then connect. Any in-flight connection is replaced.
     */
    fun pair(payload: PairingPayload, options: ConnectOptions = ConnectOptions()) {
        cancelConnection()
        connectJob = scope.launch {
            _connectionState.value = ConnectionState.Claiming(payload.serverUrl)
            val token = try {
                claimService.claim(payload.httpBaseUrl, payload.code, options.name).getOrThrow()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "pair claim failed", e)
                _connectionState.value =
                    ConnectionState.Failed(payload.serverUrl, ConnectErrors.claimText(e))
                return@launch
            }
            onTokenClaimed(payload.serverUrl, token, payload.pin)
            runConnectionLoop(payload.serverUrl, token, options)
        }
    }

    /** Connect with an already-claimed device token (e.g. from the vault). */
    fun connect(serverUrl: String, token: String, options: ConnectOptions = ConnectOptions()) {
        cancelConnection()
        connectJob = scope.launch { runConnectionLoop(serverUrl, token, options) }
    }

    /** Close the socket and stop reconnecting. Queued outbound messages are kept. */
    fun disconnect() {
        cancelConnection()
        _connectionState.value = ConnectionState.Idle
    }

    /**
     * Enqueue a ClientMsg for send; flushed in order while connected and held
     * across reconnects.
     */
    fun send(message: JSONObject): Boolean = sendChannel.trySend(message.toString()).isSuccess

    fun sendPing(at: Long): Boolean = send(pingMessage(at))

    private suspend fun runConnectionLoop(serverUrl: String, token: String, options: ConnectOptions) {
        val request = try {
            Request.Builder()
                .url(buildConnectUrl(serverUrl, token, options))
                .header("Origin", httpBaseUrlOf(serverUrl))
                .build()
        } catch (e: Exception) {
            _connectionState.value = ConnectionState.Failed(serverUrl, e.message ?: "bad server URL")
            return
        }
        var attempt = 0
        while (coroutineContext.isActive) {
            attempt++
            if (attempt == 1) {
                _connectionState.value = ConnectionState.Connecting(serverUrl)
            }
            val fatal = awaitOneConnection(serverUrl, request)
            if (fatal != null) {
                // TLS trust, not a dropped network: the office regenerated its cert (or was
                // never pinned). Retrying the same handshake forever helps nobody; say so.
                _connectionState.value = ConnectionState.Failed(serverUrl, fatal)
                return
            }
            if (!coroutineContext.isActive) return
            if (!reconnectPolicy.shouldRetry(attempt)) {
                _connectionState.value =
                    ConnectionState.Failed(serverUrl, "reconnect attempts exhausted")
                return
            }
            val delayMs = reconnectPolicy.delayMsFor(attempt)
            _connectionState.value = ConnectionState.Reconnecting(serverUrl, attempt, delayMs)
            try {
                sleeper(delayMs)
            } catch (e: CancellationException) {
                return
            }
        }
    }

    /**
     * Open one socket, pump the send queue into it, and suspend until it closes. Returns the
     * user-facing error when the socket died of TLS trust (fatal: reconnecting won't help),
     * null for a normal close or a transient failure (the loop retries those).
     */
    private suspend fun awaitOneConnection(serverUrl: String, request: Request): String? {
        val closed = CompletableDeferred<Unit>()
        var writer: Job? = null
        var fatal: String? = null
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                _connectionState.value = ConnectionState.Connected(serverUrl)
                writer = scope.launch {
                    try {
                        for (msg in sendChannel) {
                            webSocket.send(msg)
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        Log.w(TAG, "send pump failed", e)
                    }
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                // Text protocol only; binary frames are ignored.
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(NORMAL_CLOSE, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                closed.complete(Unit)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                response?.closeQuietly()
                if (ConnectErrors.isTlsFailure(t)) {
                    Log.w(TAG, "websocket TLS failure; not retrying", t)
                    fatal = ConnectErrors.failureText(t)
                } else {
                    Log.w(TAG, "websocket failure; reconnecting", t)
                }
                closed.complete(Unit)
            }
        }
        val ws = try {
            webSocketFactory.newWebSocket(request, listener)
        } catch (e: Exception) {
            if (ConnectErrors.isTlsFailure(e)) {
                Log.w(TAG, "websocket TLS failure; not retrying", e)
                fatal = ConnectErrors.failureText(e)
            } else {
                Log.w(TAG, "websocket open threw; reconnecting", e)
            }
            closed.complete(Unit)
            null
        }
        socket = ws
        try {
            closed.await()
        } catch (e: CancellationException) {
            ws?.cancel()
            throw e
        } finally {
            writer?.cancel()
            if (socket === ws) socket = null
        }
        return fatal
    }

    private fun handleMessage(text: String) {
        val json = try {
            JSONObject(text)
        } catch (e: Exception) {
            Log.w(TAG, "ignoring non-JSON frame", e)
            return
        }
        when (val t = json.optString("t", "")) {
            "welcome" -> runCatching { parseWelcome(json) }
                .onSuccess {
                    _snapshot.value = it
                    Log.i(TAG, "welcome protocolVersion=${it.protocolVersion}")
                }
                .onFailure { Log.w(TAG, "ignoring malformed welcome", it) }
            "floor.enter" -> {
                val current = _snapshot.value
                if (current == null) {
                    Log.w(TAG, "ignoring floor.enter before welcome")
                } else {
                    runCatching { applyFloorEnter(current, json) }
                        .onSuccess { _snapshot.value = it }
                        .onFailure { Log.w(TAG, "ignoring malformed floor.enter", it) }
                }
            }
            else -> {
                val current = _snapshot.value ?: return
                when {
                    // floor.*, gh.*, chat, toast, etc. are not rendered by this
                    // scaffold and are ignored; unknown `t` values fail soft.
                    t.startsWith("peer.") ->
                        runCatching { applyPeerEvent(current, json) }
                            .onSuccess { _snapshot.value = it }
                    t.startsWith("worker.") ->
                        runCatching { applyWorkerEvent(current, json) }
                            .onSuccess { _snapshot.value = it }
                }
            }
        }
    }

    private fun cancelConnection() {
        connectJob?.cancel()
        connectJob = null
        socket?.close(NORMAL_CLOSE, null)
        socket = null
    }

    private fun Response.closeQuietly() {
        runCatching { close() }
    }

    companion object {
        private const val NORMAL_CLOSE = 1000
    }
}
