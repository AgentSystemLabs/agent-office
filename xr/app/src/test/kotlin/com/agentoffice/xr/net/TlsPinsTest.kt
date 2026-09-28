package com.agentoffice.xr.net

import java.io.ByteArrayInputStream
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import okhttp3.OkHttpClient
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class TlsPinsTest {

    @Test
    fun `decodePin accepts a well-formed pin`() {
        val bytes = TlsPins.decodePin(PIN)

        assertEquals(32, bytes.size)
        // openssl ground truth: first bytes of sha256(test-cert.der).
        assertEquals(0x80.toByte(), bytes[0])
        assertEquals(0xA5.toByte(), bytes[1])
    }

    @Test
    fun `decodePin rejects malformed pins`() {
        assertThrows<IllegalArgumentException> { TlsPins.decodePin("gKUv3xNTJS02lTP3c8Qs2Y1P49/vwfdAnc40KnQGciY=") }
        assertThrows<IllegalArgumentException> { TlsPins.decodePin("sha256/not-base64!!!") }
        assertThrows<IllegalArgumentException> { TlsPins.decodePin("sha256/AAAA") }
        assertThrows<IllegalArgumentException> { TlsPins.decodePin("") }
    }

    @Test
    fun `trust manager accepts the pinned certificate`() {
        val tm = TlsPins.PinnedTrustManager(TlsPins.decodePin(PIN))

        tm.checkServerTrusted(arrayOf(testCert()), "RSA")
    }

    @Test
    fun `trust manager rejects any other certificate`() {
        val tm = TlsPins.PinnedTrustManager(TlsPins.decodePin(PIN))
        val other = TlsPins.PinnedTrustManager(ByteArray(32))

        // Wrong pin against the real cert…
        try {
            other.checkServerTrusted(arrayOf(testCert()), "RSA")
            fail("expected CertificateException")
        } catch (e: CertificateException) {
            assertTrue(e.message!!.contains("pinned fingerprint"))
        }
        // …and the real pin against an empty chain.
        try {
            tm.checkServerTrusted(emptyArray(), "RSA")
            fail("expected CertificateException")
        } catch (e: CertificateException) {
            // expected
        }
    }

    @Test
    fun `sslSocketFactory trusts the pinned cert end to end`() {
        val (_, tm) = TlsPins.sslSocketFactory(PIN)

        tm.checkServerTrusted(arrayOf(testCert()), "RSA")
    }

    @Test
    fun `applyTo pins the builder and accepts any hostname`() {
        val client = TlsPins.applyTo(OkHttpClient.Builder(), PIN).build()

        assertTrue(client.hostnameVerifier.verify("192.168.1.5", mockSession()))
        // The socket factory's trust anchors are exactly the pinned manager (no system CAs).
        val tm = client.x509TrustManager!!
        tm.checkServerTrusted(arrayOf(testCert()), "RSA")
    }

    @Test
    fun `applyTo rejects a malformed pin`() {
        assertThrows<IllegalArgumentException> { TlsPins.applyTo(OkHttpClient.Builder(), "bogus") }
    }

    private fun testCert(): X509Certificate =
        CertificateFactory.getInstance("X.509")
            .generateCertificate(ByteArrayInputStream(TEST_CERT_PEM.toByteArray())) as X509Certificate

    private fun mockSession(): javax.net.ssl.SSLSession {
        // hostnameVerifier is `{ _, _ -> true }`: the session is never inspected.
        return java.lang.reflect.Proxy.newProxyInstance(
            javaClass.classLoader,
            arrayOf(javax.net.ssl.SSLSession::class.java),
        ) { _, _, _ -> null } as javax.net.ssl.SSLSession
    }

    private inline fun <reified T : Throwable> assertThrows(block: () -> Unit) {
        try {
            block()
            fail("expected ${T::class.java.simpleName}")
        } catch (e: Throwable) {
            assertTrue("expected ${T::class.java.simpleName}, got ${e::class.java.simpleName}", e is T)
        }
    }

    companion object {
        const val PIN = "sha256/gKUv3xNTJS02lTP3c8Qs2Y1P49/vwfdAnc40KnQGciY="

        /**
         * Canned self-signed cert (CN=agent-office-pin-test) — the same fixture as the
         * server's `tlsFingerprintPem` test, so both pin implementations are checked
         * against one openssl-computed hash.
         */
        const val TEST_CERT_PEM = """-----BEGIN CERTIFICATE-----
MIIDITCCAgmgAwIBAgIUBsPBcJLfrdtgmiAE8gk01rG04UEwDQYJKoZIhvcNAQEL
BQAwIDEeMBwGA1UEAwwVYWdlbnQtb2ZmaWNlLXBpbi10ZXN0MB4XDTI2MDkyODE0
MzY0OVoXDTI2MTAyODE0MzY0OVowIDEeMBwGA1UEAwwVYWdlbnQtb2ZmaWNlLXBp
bi10ZXN0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuNaZ+bTqQ5C4
wLnFz1FQnA+/fx/MFkf6IknLD+2khw4o0FfQ/hDQW6HyWFE7tYdmz1OYXEOFzX0f
Vyll5YDpE0ABfRBCTvkOWS8L/QB8iZz7nmvF5X7a2COziHx28xH5MClTu1XNz4Aa
CH+wwtTjDIwYv40s3d0C+92rtX/uBecEGxr3JREV5RRy24XAfwzP7aD1emPq4Frb
a1aTHMf+HVl4DIepVo5ZC7p7Aeq8BvRqEcbA0rP9voGKCbBaAu+qzWcZcG+IGG0b
P+txza0hsnC8JB7f8W3/ssmPkqBwcUIryvqqczQFKCk/tlGOxa2x/6RGcTyMRRIX
EaG8nLtQcQIDAQABo1MwUTAdBgNVHQ4EFgQUoS0GvHN/M2nfL15zMSdYPnyd2Ssw
HwYDVR0jBBgwFoAUoS0GvHN/M2nfL15zMSdYPnyd2SswDwYDVR0TAQH/BAUwAwEB
/zANBgkqhkiG9w0BAQsFAAOCAQEACctXHg0ZRUouNCNBwn19qgXKOgaKvaWWD9+S
lrkShxRJy/NeaCh3HbZ6rHEqIp0ZUtDqh+ofiPK99b7vgGoHgt1Zo8SjTaGjaE2+
dztYvhH94eIqH8KJpjW2sEBYxN0tiIN+3bLTqgA8fIMd0MUV/rUVMk8IROkJBjSu
ZdFLjNzwXLq4xYPZ6K6xnkOkSGtIQbZjvQb3vmyr4BexYDUJIENPrLbhJ2gAskQP
WrqBTMawNr1Yi/uX+V8p3qMKSnKyRD9J2wcvw/yRZlFNyzZ/O+UUUtjmsAq/Y3bS
rf98tAzDZ1lBRdPvQcIpoRjCNmwQLfrYLcmbCio9e7BT4N8E6g==
-----END CERTIFICATE-----"""
    }
}
