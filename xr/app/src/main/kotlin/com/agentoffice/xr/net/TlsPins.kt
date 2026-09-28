package com.agentoffice.xr.net

import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Base64
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509TrustManager
import okhttp3.OkHttpClient

/**
 * TLS trust for self-signed offices.
 *
 * The headset pairs over the LAN, where the office typically serves TLS with a generated
 * self-signed certificate (see `--self-signed`): no public CA will ever vouch for it, so the
 * default trust manager rejects it and pairing fails with no path forward. The pairing QR
 * fixes the bootstrap: the laptop (already logged in over the office session) prints the
 * office's `sha256/…` certificate fingerprint into the QR, and scanning it is the user's
 * consent to trust exactly that certificate.
 *
 * This is a certificate-hash pin, not an SPKI pin: the presented chain is accepted iff one
 * of its certificates hashes to the pin. It replaces BOTH default checks for a pinned
 * office — the CA ladder (a self-signed cert has none) and hostname verification (CN
 * `agent-office` never matches a LAN IP, and a cert hash is a strictly stronger identity
 * than a name match). Unpinned offices keep the full default checks.
 *
 * The pin is only as stable as the office's cert: `--self-signed` persists
 * `tls-cert.pem` in the office data dir, so it survives restarts; wiping the data dir (or
 * rotating `--tls-cert`) regenerates the cert and the headset must re-pair (see
 * [ConnectErrors], which turns that mismatch into the re-pair hint).
 */
object TlsPins {
    const val PREFIX = "sha256/"

    /**
     * Decode a `sha256/<base64>` pin to the 32 expected hash bytes.
     * Throws [IllegalArgumentException] on a malformed pin.
     */
    fun decodePin(pin: String): ByteArray {
        require(pin.startsWith(PREFIX)) { "pin must start with 'sha256/'" }
        val bytes = try {
            Base64.getDecoder().decode(pin.removePrefix(PREFIX))
        } catch (e: IllegalArgumentException) {
            throw IllegalArgumentException("pin is not valid base64", e)
        }
        require(bytes.size == 32) { "pin must be 32 SHA-256 bytes, got ${bytes.size}" }
        return bytes
    }

    /**
     * Socket factory + trust manager that trust exactly the pinned certificate, for
     * `OkHttpClient.Builder.sslSocketFactory(factory, trustManager)`.
     */
    fun sslSocketFactory(pin: String): Pair<SSLSocketFactory, X509TrustManager> {
        val tm = PinnedTrustManager(decodePin(pin))
        val context = SSLContext.getInstance("TLS")
        context.init(null, arrayOf(tm), null)
        return context.socketFactory to tm
    }

    /**
     * Scope an OkHttp builder to exactly the pinned office certificate. The pin replaces
     * BOTH default checks — the CA ladder (a self-signed cert has none) and hostname
     * verification (CN `agent-office` never matches a LAN IP, and a cert hash is a
     * strictly stronger identity than a name match anyway). Call only for a pinned
     * office; unpinned builders keep the full defaults. Throws on a malformed pin.
     */
    fun applyTo(builder: OkHttpClient.Builder, pin: String): OkHttpClient.Builder {
        val (factory, trustManager) = sslSocketFactory(pin)
        builder.sslSocketFactory(factory, trustManager)
        builder.hostnameVerifier { _, _ -> true }
        return builder
    }

    /**
     * Trust manager that accepts a chain iff one of its certificates hashes to the pin
     * (normally the leaf; accepting it anywhere in the chain is the standard pinning
     * semantic). Public for unit tests.
     */
    class PinnedTrustManager(private val pin: ByteArray) : X509TrustManager {
        override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) {
            val match = chain.any { cert ->
                runCatching {
                    MessageDigest.getInstance("SHA-256").digest(cert.encoded).contentEquals(pin)
                }.getOrDefault(false)
            }
            if (!match) {
                // Marker "pinned fingerprint" is matched by ConnectErrors for the re-pair hint.
                throw CertificateException(
                    "office certificate does not match the pinned fingerprint — " +
                        "re-pair from the laptop's VR panel",
                )
            }
        }

        override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) {
            throw CertificateException("client certificates unsupported")
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
}
