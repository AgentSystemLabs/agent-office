package com.agentoffice.xr.net

import kotlin.math.min
import kotlin.random.Random

/**
 * Pure, side-effect-free reconnect backoff schedule.
 *
 * Only answers "how long before attempt N" and "should we keep trying" — the
 * [OfficeProtocolClient] owns the coroutine that actually sleeps. No Android framework,
 * so the timing math unit-tests on the host JVM (see `ReconnectPolicyTest`).
 *
 * Schedule: exponential backoff starting at [baseDelayMs], doubling every attempt,
 * clamped to [maxDelayMs]. Each delay is then de-correlated with **equal jitter**
 * (half fixed + half random) so a fleet of headsets dropped by the same Wi-Fi blip
 * don't reconnect in lockstep and stampede the office.
 *
 * `attempt` is 1-based: the first reconnect attempt is `1`.
 * (Copied from orbXR's `ReconnectPolicy`.)
 */
class ReconnectPolicy(
    val maxAttempts: Int = 8,
    private val baseDelayMs: Long = 1_000L,
    private val maxDelayMs: Long = 60_000L,
    private val jitter: Boolean = true,
    /** Injectable randomness in `[0.0, 1.0)`; deterministic in tests. */
    private val random: () -> Double = { Random.nextDouble() },
) {
    init {
        require(maxAttempts >= 1) { "maxAttempts must be >= 1, was $maxAttempts" }
        require(baseDelayMs >= 0L) { "baseDelayMs must be >= 0, was $baseDelayMs" }
        require(maxDelayMs >= baseDelayMs) {
            "maxDelayMs ($maxDelayMs) must be >= baseDelayMs ($baseDelayMs)"
        }
    }

    /** Whether another attempt is worthwhile after the 1-based [attempt] just failed. */
    fun shouldRetry(attempt: Int): Boolean = attempt < maxAttempts

    /**
     * Backoff before the 1-based [attempt]. The deterministic ceiling is
     * `min(baseDelayMs * 2^(attempt-1), maxDelayMs)`; with [jitter] enabled
     * the returned value lands in `[ceiling / 2, ceiling]`.
     */
    fun delayMsFor(attempt: Int): Long {
        require(attempt >= 1) { "attempt is 1-based, was $attempt" }
        // Cap the shift well under 63 so `baseDelayMs shl shift` can't wrap
        // a Long before min() clamps it (a 64-bit shift is also UB-ish: shl
        // only uses the low 6 bits, so shift==64 would be a no-op).
        val shift = min(attempt - 1, 32)
        val shifted = if (baseDelayMs == 0L) 0L else baseDelayMs shl shift
        // Overflow guard: a wrapped shift goes negative or shrinks.
        val uncapped = if (shifted < baseDelayMs) maxDelayMs else shifted
        val ceiling = min(uncapped, maxDelayMs)
        if (!jitter || ceiling <= 0L) return ceiling
        val half = ceiling / 2
        return half + (random().coerceIn(0.0, 1.0) * half).toLong()
    }
}
