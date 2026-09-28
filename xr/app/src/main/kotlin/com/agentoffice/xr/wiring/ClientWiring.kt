package com.agentoffice.xr.wiring

import android.content.Context
import com.agentoffice.xr.net.ClaimService
import com.agentoffice.xr.net.OfficeProtocolClient
import com.agentoffice.xr.net.OkHttpClaimService
import com.agentoffice.xr.net.PrefsCookieJar
import com.agentoffice.xr.net.ReconnectPolicy
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
        onTokenClaimed: (serverUrl: String, token: String) -> Unit = { _, _ -> },
    ): OfficeProtocolClient {
        val appContext = context.applicationContext
        val cookieJar = PrefsCookieJar(
            appContext.getSharedPreferences(COOKIE_PREFS, Context.MODE_PRIVATE),
        )
        val okHttp = OkHttpClient.Builder()
            .cookieJar(cookieJar)
            .build()
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
