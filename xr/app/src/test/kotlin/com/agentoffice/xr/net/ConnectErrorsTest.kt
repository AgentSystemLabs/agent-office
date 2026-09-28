package com.agentoffice.xr.net

import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertificateException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectErrorsTest {

    @Test
    fun `pin mismatch is a TLS failure with the changed hint`() {
        val t = javax.net.ssl.SSLHandshakeException("handshake failed")
            .apply { initCause(CertificateException("office certificate does not match the pinned fingerprint")) }

        assertTrue(ConnectErrors.isTlsFailure(t))
        assertEquals(
            "The office's certificate changed — re-pair from the laptop's VR panel.",
            ConnectErrors.failureText(t),
        )
    }

    @Test
    fun `untrusted chain is a TLS failure with the trust hint`() {
        val t = javax.net.ssl.SSLHandshakeException(
            "PKIX path building failed: unable to find valid certification path to requested target",
        )

        assertTrue(ConnectErrors.isTlsFailure(t))
        assertEquals(
            "The office's certificate isn't trusted by this headset — re-pair from the laptop's VR panel.",
            ConnectErrors.failureText(t),
        )
    }

    @Test
    fun `trust anchor message is a TLS failure`() {
        assertTrue(ConnectErrors.isTlsFailure(RuntimeException("Trust anchor for certification path not found.")))
    }

    @Test
    fun `network errors stay transient with the raw message`() {
        for (t in listOf(
            SocketException("Connection reset"),
            SocketTimeoutException("Read timed out"),
            UnknownHostException("office.lan"),
            RuntimeException("unexpected end of stream"),
        )) {
            assertFalse("${t::class.java.simpleName} must stay transient", ConnectErrors.isTlsFailure(t))
            assertEquals(t.message, ConnectErrors.failureText(t))
        }
    }

    @Test
    fun `claim text keeps non-TLS messages and defaults`() {
        assertEquals("boom", ConnectErrors.claimText(RuntimeException("boom")))
        assertEquals("claim failed", ConnectErrors.claimText(RuntimeException()))
        assertTrue(ConnectErrors.claimText(RuntimeException("Trust anchor missing")).contains("re-pair"))
    }
}
