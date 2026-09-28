package com.agentoffice.xr.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WsUrlsTest {

    @Test
    fun `base url gets ws path appended`() {
        assertEquals(
            "ws://192.168.1.5:4600/ws",
            normalizeServerUrl("ws://192.168.1.5:4600"),
        )
    }

    @Test
    fun `base url with trailing slash gets ws path appended`() {
        assertEquals(
            "ws://192.168.1.5:4600/ws",
            normalizeServerUrl("ws://192.168.1.5:4600/"),
        )
    }

    @Test
    fun `full ws url stays untouched`() {
        assertEquals(
            "ws://192.168.1.5:4600/ws",
            normalizeServerUrl("ws://192.168.1.5:4600/ws"),
        )
    }

    @Test
    fun `wss base normalizes too`() {
        assertEquals(
            "wss://office.example.com/ws",
            normalizeServerUrl("wss://office.example.com"),
        )
    }

    @Test
    fun `normalization rejects bad scheme and missing host`() {
        try {
            normalizeServerUrl("http://host:4600")
            throw AssertionError("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            // Expected.
        }
        try {
            normalizeServerUrl("ws:///ws")
            throw AssertionError("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            // Expected.
        }
    }

    @Test
    fun `connect url appends ws path and query params`() {
        val url = buildConnectUrl("ws://192.168.1.5:4600", "tok", ConnectOptions())

        assertTrue(url.startsWith("ws://192.168.1.5:4600/ws?"))
        assertTrue(url.contains("name=VR+Guest"))
        assertTrue(url.contains("color=%234F86F7"))
        assertTrue(url.contains("skin=0"))
        assertTrue(url.contains("hair=0"))
        assertTrue(url.contains("style=0"))
        assertTrue(url.contains("token=tok"))
    }

    @Test
    fun `connect url keeps existing ws path and encodes params`() {
        val url = buildConnectUrl(
            "ws://192.168.1.5:4600/ws",
            "tok",
            ConnectOptions(name = "Quest 3", color = "#ff0000", floor = "agent-office"),
        )

        assertEquals(
            "ws://192.168.1.5:4600/ws?name=Quest+3&color=%23ff0000&skin=0&hair=0&style=0&floor=agent-office&token=tok",
            url,
        )
    }

    @Test
    fun `connect url rejects blank token`() {
        try {
            buildConnectUrl("ws://host:4600", "  ", ConnectOptions())
            throw AssertionError("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            // Expected.
        }
    }

    @Test
    fun `http base drops path and swaps scheme`() {
        assertEquals("http://h:4600", httpBaseUrlOf("ws://h:4600/ws"))
        assertEquals("http://h:4600", httpBaseUrlOf("ws://h:4600"))
        assertEquals("https://h", httpBaseUrlOf("wss://h"))
    }
}
