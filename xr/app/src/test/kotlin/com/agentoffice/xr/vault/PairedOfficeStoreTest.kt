package com.agentoffice.xr.vault

import android.content.SharedPreferences
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * In-memory [SharedPreferences] fake so the vault's save/load/clear logic tests on
 * the host JVM without EncryptedSharedPreferences or an Android Keystore.
 */
private class FakeSharedPreferences : SharedPreferences {
    private val data = mutableMapOf<String, Any?>()

    override fun getAll(): Map<String, *> = HashMap(data)
    override fun getString(key: String?, defValue: String?): String? =
        data[key] as? String ?: defValue

    override fun getStringSet(key: String?, defValues: Set<String>?): Set<String>? =
        @Suppress("UNCHECKED_CAST") (data[key] as? Set<String> ?: defValues)

    override fun getInt(key: String?, defValue: Int): Int = data[key] as? Int ?: defValue
    override fun getLong(key: String?, defValue: Long): Long = data[key] as? Long ?: defValue
    override fun getFloat(key: String?, defValue: Float): Float = data[key] as? Float ?: defValue
    override fun getBoolean(key: String?, defValue: Boolean): Boolean =
        data[key] as? Boolean ?: defValue

    override fun contains(key: String?): Boolean = data.containsKey(key)
    override fun edit(): SharedPreferences.Editor = FakeEditor()
    override fun registerOnSharedPreferenceChangeListener(
        listener: SharedPreferences.OnSharedPreferenceChangeListener?,
    ) = Unit

    override fun unregisterOnSharedPreferenceChangeListener(
        listener: SharedPreferences.OnSharedPreferenceChangeListener?,
    ) = Unit

    private inner class FakeEditor : SharedPreferences.Editor {
        private val pending = mutableMapOf<String, Any?>()
        private val removals = mutableSetOf<String>()
        private var clearAll = false

        override fun putString(key: String?, value: String?): SharedPreferences.Editor =
            apply { pending[key!!] = value }

        override fun putStringSet(key: String?, values: Set<String>?): SharedPreferences.Editor =
            apply { pending[key!!] = values }

        override fun putInt(key: String?, value: Int): SharedPreferences.Editor =
            apply { pending[key!!] = value }

        override fun putLong(key: String?, value: Long): SharedPreferences.Editor =
            apply { pending[key!!] = value }

        override fun putFloat(key: String?, value: Float): SharedPreferences.Editor =
            apply { pending[key!!] = value }

        override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor =
            apply { pending[key!!] = value }

        override fun remove(key: String?): SharedPreferences.Editor =
            apply { removals.add(key!!) }

        override fun clear(): SharedPreferences.Editor = apply { clearAll = true }

        override fun commit(): Boolean {
            applyChange()
            return true
        }

        override fun apply() = applyChange()

        private fun applyChange() {
            if (clearAll) data.clear()
            removals.forEach { data.remove(it) }
            data.putAll(pending)
        }
    }
}

class PairedOfficeStoreTest {

    @Before
    fun bindFake() {
        PairedOfficeStore.bindForTest(FakeSharedPreferences())
    }

    @After
    fun unbindFake() {
        PairedOfficeStore.unbindForTest()
    }

    @Test
    fun `starts unpaired with empty prefs`() {
        assertFalse(PairedOfficeStore.isPaired.value)
        assertNull(PairedOfficeStore.load())
    }

    @Test
    fun `save then load round-trips the record`() {
        val office = PairedOffice(
            serverUrl = "ws://192.168.1.10:4600/ws",
            deviceToken = "secret-token",
            pairedAtEpochMs = 1_700_000_000_000L,
        )

        PairedOfficeStore.save(office)

        assertTrue(PairedOfficeStore.isPaired.value)
        assertEquals(office, PairedOfficeStore.load())
    }

    @Test
    fun `save then load round-trips the cert pin`() {
        val office = PairedOffice(
            serverUrl = "wss://192.168.1.10:4600/ws",
            deviceToken = "secret-token",
            pairedAtEpochMs = 1_700_000_000_000L,
            certPin = "sha256/gKUv3xNTJS02lTP3c8Qs2Y1P49/vwfdAnc40KnQGciY=",
        )

        PairedOfficeStore.save(office)

        assertEquals(office, PairedOfficeStore.load())
    }

    @Test
    fun `re-pairing without a pin clears the stored one`() {
        PairedOfficeStore.save(PairedOffice("wss://a/ws", "token-a", 1L, certPin = "sha256/AAAA"))

        PairedOfficeStore.save(PairedOffice("ws://a/ws", "token-b", 2L))

        assertNull(PairedOfficeStore.load()?.certPin)
    }

    @Test
    fun `legacy record without a pin loads with null pin`() {
        val prefs = FakeSharedPreferences()
        prefs.edit()
            .putString("server_url", "wss://a/ws")
            .putString("device_token", "token-a")
            .putLong("paired_at", 7L)
            .commit()
        PairedOfficeStore.bindForTest(prefs)

        val loaded = PairedOfficeStore.load()!!
        assertEquals("token-a", loaded.deviceToken)
        assertNull(loaded.certPin)
    }

    @Test
    fun `save overwrites the previous record`() {
        PairedOfficeStore.save(PairedOffice("ws://a/ws", "token-a", 1L))
        PairedOfficeStore.save(PairedOffice("ws://b/ws", "token-b", 2L))

        val loaded = PairedOfficeStore.load()!!
        assertEquals("ws://b/ws", loaded.serverUrl)
        assertEquals("token-b", loaded.deviceToken)
        assertEquals(2L, loaded.pairedAtEpochMs)
    }

    @Test
    fun `clear forgets the record`() {
        PairedOfficeStore.save(PairedOffice("ws://a/ws", "token-a", 1L))

        PairedOfficeStore.clear()

        assertFalse(PairedOfficeStore.isPaired.value)
        assertNull(PairedOfficeStore.load())
    }

    @Test
    fun `bind picks up an existing record`() {
        val prefs = FakeSharedPreferences()
        prefs.edit()
            .putString("server_url", "ws://a/ws")
            .putString("device_token", "token-a")
            .putLong("paired_at", 7L)
            .commit()
        PairedOfficeStore.bindForTest(prefs)

        assertTrue(PairedOfficeStore.isPaired.value)
        assertEquals("token-a", PairedOfficeStore.load()?.deviceToken)
    }
}
