package com.agentoffice.xr.wiring

import android.content.Context
import com.agentoffice.xr.net.ClaimService
import com.agentoffice.xr.net.OfficeProtocolClient
import com.agentoffice.xr.net.OkHttpClaimService
import com.agentoffice.xr.net.PrefsCookieJar
import com.agentoffice.xr.net.ReconnectPolicy
import com.agentoffice.xr.net.TlsPins
import com.agentoffice.xr.net.WebSocketFactory
import kotlinx.coroutines.CoroutineScope
import okhttp3.OkHttpClient

/**
 * Android-touching construction for the protocol stack. Everything the client logic
 * needs from the framework (the cookie prefs file) is built here so `net/` stays
 * injectable and unit-tests with fakes.
 */
object ClientWiring {
    private const val COOKIE_PREFS = "agentoffice_cookies"

    fun buildProtocolClient(
        context: Context,
        scope: CoroutineScope,
        claimService: ClaimService? = null,
        onTokenClaimed: (serverUrl: String, token: String, certPin: String?) -> Unit = { _, _, _ -> },
        /**
         * `sha256/…` pin for the office's TLS certificate (from the pairing QR or the vault).
         * Null for cleartext offices. The pin scopes this client instance to exactly that
         * office's certificate (see `TlsPins`); re-pairing rebuilds the client with the new pin.
         */
        certPin: String? = null,
    ): OfficeProtocolClient {
        val appContext = context.applicationContext
        val cookieJar = PrefsCookieJar(
            appContext.getSharedPreferences(COOKIE_PREFS, Context.MODE_PRIVATE),
        )
        val builder = OkHttpClient.Builder()
            .cookieJar(cookieJar)
        if (certPin != null) {
            // Scoped to this office's certificate (see TlsPins); unpinned offices keep defaults.
            TlsPins.applyTo(builder, certPin)
        }
        val okHttp = builder.build()
        val webSocketFactory = WebSocketFactory { request, listener ->
            okHttp.newWebSocket(request, listener)
        }
        return OfficeProtocolClient(
            webSocketFactory = webSocketFactory,
            claimService = claimService ?: OkHttpClaimService(okHttp),
            scope = scope,
            onTokenClaimed = onTokenClaimed,
            reconnectPolicy = ReconnectPolicy(maxAttempts = Int.MAX_VALUE),
        )
    }
}
