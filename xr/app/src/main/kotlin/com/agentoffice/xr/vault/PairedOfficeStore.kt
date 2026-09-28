package com.agentoffice.xr.vault

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

private const val TAG = "PairedOfficeStore"

/**
 * Durable, encrypted-at-rest record of the single office the headset is paired with.
 *
 * Persisting the device token is what lets the headset skip the QR scanner on every
 * launch after the first pairing: [load] hands `MainActivity` a [PairedOffice], and the
 * protocol client auto-connects with the stored token.
 *
 * Backed by [EncryptedSharedPreferences] (AES-256 via an Android Keystore master key) —
 * the token authenticates as this device to the user's office, so it must not sit in
 * cleartext.
 *
 * Single-office by design: the headset pairs with one office at a time, so [save]
 * overwrites any previous record. (Adapted from orbXR's `PairedMacStore` — same
 * object shape, `isPaired` flow, and dual-delete Keystore recovery; only the stored
 * fields changed.)
 */
object PairedOfficeStore {
    private val _isPaired = MutableStateFlow(false)

    /** Whether a paired office + token are on disk. Drives auto-connect-vs-scanner. */
    val isPaired: StateFlow<Boolean> = _isPaired.asStateFlow()

    @Volatile
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        if (prefs != null) return
        val p = openPrefs(context.applicationContext)
        prefs = p
        _isPaired.value = hasRecord(p)
    }

    /** Persist (or replace) the paired office and its device token. */
    fun save(office: PairedOffice) {
        val p = prefs ?: return
        // putString(key, null) removes the key: re-pairing without a pin clears a stale one.
        p.edit()
            .putString(KEY_SERVER_URL, office.serverUrl)
            .putString(KEY_DEVICE_TOKEN, office.deviceToken)
            .putLong(KEY_PAIRED_AT, office.pairedAtEpochMs)
            .putString(KEY_CERT_PIN, office.certPin)
            .apply()
        _isPaired.value = true
    }

    /** The paired office + token, or null if the headset has never paired. */
    fun load(): PairedOffice? {
        val p = prefs ?: return null
        val serverUrl = p.getString(KEY_SERVER_URL, null) ?: return null
        val deviceToken = p.getString(KEY_DEVICE_TOKEN, null) ?: return null
        return PairedOffice(
            serverUrl = serverUrl,
            deviceToken = deviceToken,
            pairedAtEpochMs = p.getLong(KEY_PAIRED_AT, 0L),
            certPin = p.getString(KEY_CERT_PIN, null),
        )
    }

    /** Forget the paired office and its token. Returns the headset to QR pairing. */
    fun clear() {
        prefs?.edit()?.clear()?.apply()
        _isPaired.value = false
    }

    /**
     * Test seam: bind an in-memory [SharedPreferences] fake so `save`/`load`/`clear`
     * unit-test on the host JVM without EncryptedSharedPreferences or a Keystore.
     * Production always goes through [init].
     */
    internal fun bindForTest(prefs: SharedPreferences) {
        this.prefs = prefs
        _isPaired.value = hasRecord(prefs)
    }

    /** Test seam: release the fake bound by [bindForTest]. */
    internal fun unbindForTest() {
        prefs = null
        _isPaired.value = false
    }

    private fun hasRecord(p: SharedPreferences): Boolean =
        p.getString(KEY_SERVER_URL, null) != null && p.getString(KEY_DEVICE_TOKEN, null) != null

    /**
     * Open the encrypted prefs. A corrupt Keystore master key (a known but
     * rare Android failure mode) throws here; recover by dropping BOTH the
     * undecryptable prefs file AND the master-key entry from the Android
     * Keystore, then rebuild — deleting only the file leaves the bad key in
     * place and the retry throws the same way, crash-looping startup. The
     * user just re-pairs. We never silently fall back to cleartext for a
     * credential that authenticates to the user's office.
     */
    private fun openPrefs(appContext: Context): SharedPreferences {
        return runCatching { buildEncryptedPrefs(appContext) }
            .getOrElse { first ->
                Log.w(TAG, "EncryptedSharedPreferences open failed; resetting paired-office store", first)
                appContext.deleteSharedPreferences(PREFS_NAME)
                runCatching {
                    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
                    keyStore.deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
                }.onFailure { Log.w(TAG, "could not delete master key during reset", it) }
                buildEncryptedPrefs(appContext)
            }
    }

    private fun buildEncryptedPrefs(appContext: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            appContext,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val PREFS_NAME = "agentoffice_paired_office"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val KEY_PAIRED_AT = "paired_at"
    private const val KEY_CERT_PIN = "cert_pin"
}
