package com.agentoffice.xr.net

import java.net.SocketException
import javax.net.ssl.SSLHandshakeException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import okhttp3.Request
import okhttp3.WebSocket
import okio.ByteString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OfficeProtocolClientTlsTest {

    @Test
    fun `TLS socket failure fails fast with the re-pair hint`() = runTest {
        var opens = 0
        val factory = WebSocketFactory { _, listener ->
            opens++
            val ws = fakeWebSocket()
            listener.onFailure(ws, pinMismatch(), null)
            ws
        }
        val client = OfficeProtocolClient(
            webSocketFactory = factory,
            claimService = stubClaim(Result.success("token")),
            scope = backgroundScope,
            reconnectPolicy = ReconnectPolicy(maxAttempts = 5, jitter = false),
            sleeper = {},
        )

        client.connect("wss://office.example.com/ws", "token")

        val failed = client.connectionState.first { it is ConnectionState.Failed } as ConnectionState.Failed
        assertEquals(
            "The office's certificate changed — re-pair from the laptop's VR panel.",
            failed.error,
        )
        assertEquals("a TLS failure must not retry", 1, opens)
    }

    @Test
    fun `transient socket failures still retry until exhausted`() = runTest {
        var opens = 0
        val factory = WebSocketFactory { _, listener ->
            opens++
            val ws = fakeWebSocket()
            listener.onFailure(ws, SocketException("Connection reset"), null)
            ws
        }
        val client = OfficeProtocolClient(
            webSocketFactory = factory,
            claimService = stubClaim(Result.success("token")),
            scope = backgroundScope,
            reconnectPolicy = ReconnectPolicy(maxAttempts = 3, jitter = false),
            sleeper = {},
        )

        client.connect("wss://office.example.com/ws", "token")

        val failed = client.connectionState.first { it is ConnectionState.Failed } as ConnectionState.Failed
        assertEquals("reconnect attempts exhausted", failed.error)
        assertEquals(3, opens)
    }

    @Test
    fun `TLS claim failure fails with the trust hint and claims nothing`() = runTest {
        var claimed = false
        val client = OfficeProtocolClient(
            webSocketFactory = WebSocketFactory { _, _ -> fakeWebSocket() },
            claimService = stubClaim(
                Result.failure(RuntimeException("Trust anchor for certification path not found.")),
            ),
            scope = backgroundScope,
            onTokenClaimed = { _, _, _ -> claimed = true },
        )

        client.pair(testPayload())

        val failed = client.connectionState.first { it is ConnectionState.Failed } as ConnectionState.Failed
        assertTrue(failed.error.contains("re-pair"))
        assertTrue("no token may be persisted on a failed claim", !claimed)
    }

    @Test
    fun `non-TLS claim failure keeps the old message`() = runTest {
        val client = OfficeProtocolClient(
            webSocketFactory = WebSocketFactory { _, _ -> fakeWebSocket() },
            claimService = stubClaim(Result.failure(RuntimeException("boom"))),
            scope = backgroundScope,
        )

        client.pair(testPayload())

        val failed = client.connectionState.first { it is ConnectionState.Failed } as ConnectionState.Failed
        assertEquals("boom", failed.error)
    }

    private fun stubClaim(result: Result<String>): ClaimService = object : ClaimService {
        override suspend fun claim(httpBaseUrl: String, code: String, name: String): Result<String> = result
    }

    private fun pinMismatch(): Throwable =
        SSLHandshakeException("handshake failed").apply {
            initCause(java.security.cert.CertificateException("office certificate does not match the pinned fingerprint"))
        }

    private fun testPayload() = com.agentoffice.xr.qr.PairingPayload(
        serverUrl = "wss://office.example.com/ws",
        code = "K7Q2M9XD",
    )

    private fun fakeWebSocket(): WebSocket = object : WebSocket {
        override fun request(): Request = Request.Builder().url("https://office.example.com/ws").build()
        override fun queueSize(): Long = 0L
        override fun send(text: String): Boolean = true
        override fun send(bytes: ByteString): Boolean = true
        override fun close(code: Int, reason: String?): Boolean = true
        override fun cancel() = Unit
    }
}
