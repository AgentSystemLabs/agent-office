package com.agentoffice.xr.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

/** [ClaimService] over OkHttp. Runs the blocking call on `Dispatchers.IO`. */
class OkHttpClaimService(private val client: OkHttpClient) : ClaimService {
    override suspend fun claim(httpBaseUrl: String, code: String, name: String): Result<String> =
        withContext(Dispatchers.IO) {
            runCatching {
                require(code.isNotBlank()) { "missing pairing code" }
                val body = JSONObject()
                    .put("code", code)
                    .put("name", name.ifBlank { ConnectOptions.DEFAULT_NAME })
                    .toString()
                    .toRequestBody(JSON_MEDIA_TYPE)
                val request = Request.Builder()
                    .url("$httpBaseUrl/api/pair/claim")
                    .post(body)
                    .build()
                client.newCall(request).execute().use { response ->
                    require(response.isSuccessful) { "claim failed: HTTP ${response.code}" }
                    val json = JSONObject(response.body.string())
                    val token = json.optString("token", "")
                    require(token.isNotEmpty()) { "claim response missing token" }
                    token
                }
            }
        }
}
