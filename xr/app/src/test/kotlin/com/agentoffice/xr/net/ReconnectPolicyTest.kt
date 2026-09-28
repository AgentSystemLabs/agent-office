package com.agentoffice.xr.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReconnectPolicyTest {

    @Test
    fun `first delay equals base without jitter`() {
        val policy = ReconnectPolicy(jitter = false)

        assertEquals(1_000L, policy.delayMsFor(1))
    }

    @Test
    fun `delays double every attempt without jitter`() {
        val policy = ReconnectPolicy(jitter = false)

        assertEquals(1_000L, policy.delayMsFor(1))
        assertEquals(2_000L, policy.delayMsFor(2))
        assertEquals(4_000L, policy.delayMsFor(3))
        assertEquals(8_000L, policy.delayMsFor(4))
    }

    @Test
    fun `delays clamp to max`() {
        val policy = ReconnectPolicy(jitter = false, maxDelayMs = 5_000L)

        assertEquals(5_000L, policy.delayMsFor(10))
        assertEquals(5_000L, policy.delayMsFor(100))
    }

    @Test
    fun `huge attempts do not overflow`() {
        val policy = ReconnectPolicy(jitter = false)

        assertEquals(60_000L, policy.delayMsFor(Int.MAX_VALUE))
    }

    @Test
    fun `jitter lands in half-to-full ceiling with deterministic random`() {
        val policy = ReconnectPolicy(random = { 0.0 })
        assertEquals(500L, policy.delayMsFor(1)) // ceiling 1000 → [500, 1000]

        val policyFull = ReconnectPolicy(random = { 0.9999 })
        assertEquals(999L, policyFull.delayMsFor(1))
    }

    @Test
    fun `jitter clamps out-of-range random`() {
        val policy = ReconnectPolicy(random = { 7.0 })

        assertEquals(1_000L, policy.delayMsFor(1))
    }

    @Test
    fun `shouldRetry stops at maxAttempts`() {
        val policy = ReconnectPolicy(maxAttempts = 3)

        assertTrue(policy.shouldRetry(1))
        assertTrue(policy.shouldRetry(2))
        assertFalse(policy.shouldRetry(3))
        assertFalse(policy.shouldRetry(4))
    }

    @Test
    fun `attempt is 1-based`() {
        val policy = ReconnectPolicy()

        try {
            policy.delayMsFor(0)
            throw AssertionError("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            // Expected.
        }
    }

    @Test
    fun `constructor validates arguments`() {
        try {
            ReconnectPolicy(maxAttempts = 0)
            throw AssertionError("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            // Expected.
        }
        try {
            ReconnectPolicy(baseDelayMs = 5_000L, maxDelayMs = 1_000L)
            throw AssertionError("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            // Expected.
        }
    }
}
