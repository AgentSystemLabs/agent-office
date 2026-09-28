package com.agentoffice.xr.net

import android.content.SharedPreferences
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * [CookieJar] persisted to plain [SharedPreferences].
 *
 * Plain prefs are a deliberate choice, not an oversight: these are the office's
 * `ao_session` HTTP session cookies, and the device token — the actual long-lived
 * credential — stays in the encrypted vault ([PairedOfficeStore]). A stolen session
 * cookie expires with the server session; a stolen device token does not.
 *
 * Storage: one entry per `host|name` → `value;expiresAt`. Cookies are rebuilt as
 * host-only with path `/`, which matches how the office sets its session cookie.
 */
class PrefsCookieJar(private val prefs: SharedPreferences) : CookieJar {
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val now = System.currentTimeMillis()
        val edit = prefs.edit()
        for (cookie in cookies) {
            val key = "${cookie.domain}|${cookie.name}"
            if (cookie.expiresAt <= now) {
                edit.remove(key)
            } else {
                edit.putString(key, "${cookie.value};${cookie.expiresAt}")
            }
        }
        edit.apply()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        return prefs.all.mapNotNull { (key, raw) ->
            val stored = raw as? String ?: return@mapNotNull null
            val sep = key.indexOf('|')
            if (sep < 0) return@mapNotNull null
            val host = key.substring(0, sep)
            val name = key.substring(sep + 1)
            if (!hostMatches(url.host, host)) return@mapNotNull null
            val parts = stored.split(';', limit = 2)
            if (parts.size != 2) return@mapNotNull null
            val expiresAt = parts[1].toLongOrNull() ?: return@mapNotNull null
            if (expiresAt <= now) return@mapNotNull null
            Cookie.Builder()
                .name(name)
                .value(parts[0])
                .path("/")
                .hostOnlyDomain(host)
                .expiresAt(expiresAt)
                .build()
        }
    }

    private fun hostMatches(requestHost: String, cookieHost: String): Boolean =
        requestHost == cookieHost || requestHost.endsWith(".$cookieHost")
}
