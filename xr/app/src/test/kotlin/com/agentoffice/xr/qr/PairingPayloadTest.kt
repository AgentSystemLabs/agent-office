package com.agentoffice.xr.qr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingPayloadTest {

    @Test
    fun `parses valid ws payload`() {
        val payload = PairingPayload.parse("""{"url":"ws://192.168.1.10:4600/ws","code":"ABCD-1234"}""")
            .getOrThrow()

        assertEquals("ws://192.168.1.10:4600/ws", payload.serverUrl)
        assertEquals("ABCD-1234", payload.code)
        assertEquals("http://192.168.1.10:4600", payload.httpBaseUrl)
        assertEquals("http://192.168.1.10:4600", payload.originHeader)
    }

    @Test
    fun `parses contract base url without path`() {
        // The real contract QR carries the office base (no /ws); normalization to the
        // endpoint happens at connect time (see WsUrlsTest).
        val payload = PairingPayload.parse("""{"url":"ws://192.168.1.5:4600","code":"K7Q2M9XD"}""")
            .getOrThrow()

        assertEquals("ws://192.168.1.5:4600", payload.serverUrl)
        assertEquals("K7Q2M9XD", payload.code)
        assertEquals("http://192.168.1.5:4600", payload.httpBaseUrl)
        assertEquals("http://192.168.1.5:4600", payload.originHeader)
    }

    @Test
    fun `parses valid wss payload with https base`() {
        val payload = PairingPayload.parse("""{"url":"wss://office.example.com/ws","code":"x"}""")
            .getOrThrow()

        assertEquals("https://office.example.com", payload.httpBaseUrl)
        assertEquals("https://office.example.com", payload.originHeader)
    }

    @Test
    fun `tolerates surrounding whitespace and extra fields`() {
        val payload = PairingPayload.parse("""  {"url" : "ws://h:1/ws" , "code" : "c" , "v" : 2 }  """)
            .getOrThrow()

        assertEquals("ws://h:1/ws", payload.serverUrl)
        assertEquals("c", payload.code)
    }

    @Test
    fun `rejects empty payload`() {
        assertTrue(PairingPayload.parse("   ").isFailure)
    }

    @Test
    fun `rejects non-JSON payload`() {
        assertTrue(PairingPayload.parse("ws://host:4600/ws").isFailure)
    }

    @Test
    fun `rejects missing url`() {
        assertTrue(PairingPayload.parse("""{"code":"c"}""").isFailure)
    }

    @Test
    fun `rejects missing code`() {
        assertTrue(PairingPayload.parse("""{"url":"ws://host:4600/ws"}""").isFailure)
    }

    @Test
    fun `rejects blank code`() {
        assertTrue(PairingPayload.parse("""{"url":"ws://host:4600/ws","code":"  "}""").isFailure)
    }

    @Test
    fun `rejects non-ws scheme`() {
        assertTrue(PairingPayload.parse("""{"url":"http://host:4600/ws","code":"c"}""").isFailure)
    }

    @Test
    fun `rejects missing host`() {
        assertTrue(PairingPayload.parse("""{"url":"ws:///ws","code":"c"}""").isFailure)
    }

    @Test
    fun `rejects out-of-range port`() {
        assertTrue(PairingPayload.parse("""{"url":"ws://host:99999/ws","code":"c"}""").isFailure)
    }

    @Test
    fun `parses the pin when present`() {
        val payload = PairingPayload.parse(
            """{"url":"wss://192.168.1.5:4600","code":"K7Q2M9XD","pin":"sha256/gKUv3xNTJS02lTP3c8Qs2Y1P49/vwfdAnc40KnQGciY="}""",
        ).getOrThrow()

        assertEquals("sha256/gKUv3xNTJS02lTP3c8Qs2Y1P49/vwfdAnc40KnQGciY=", payload.pin)
    }

    @Test
    fun `pin is null when absent`() {
        val payload = PairingPayload.parse("""{"url":"ws://h:1/ws","code":"c"}""").getOrThrow()

        assertEquals(null, payload.pin)
    }

    @Test
    fun `rejects a malformed pin`() {
        assertTrue(PairingPayload.parse("""{"url":"wss://h:1/ws","code":"c","pin":"bogus"}""").isFailure)
        assertTrue(PairingPayload.parse("""{"url":"wss://h:1/ws","code":"c","pin":"sha256/short"}""").isFailure)
    }
}
