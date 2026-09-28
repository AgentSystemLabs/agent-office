package com.agentoffice.xr.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Central design tokens for all XR UI. No `Color(0x…)` literals outside this object.
 * (Same pattern as orbXR's `GhosttyTokens`.)
 */
object OfficeTokens {
    val Background = Color(0xFF0A0E13)
    val Surface = Color(0xFF10151C)
    val SurfaceContainer = Color(0xFF141B24)
    val Outline = Color(0xFF2C3A49)
    val OnSurface = Color(0xFFE7EDF4)
    val OnSurfaceVariant = Color(0xFFA6B6C7)
    val OnSurfaceFaint = Color(0xFF7E8EA0)

    /** Office blue — primary accent, matches the default avatar color. */
    val Accent = Color(0xFF4F86F7)
    val Online = Color(0xFF6BE675)
    val Danger = Color(0xFFFF8A80)
    val Warning = Color(0xFFFFC773)
    val Scrim = Color(0xCC0A0E13)

    val PanelCorner = 24.dp
    val ChromeCorner = 10.dp

    val TitleSize = 26.sp
    val BodySize = 16.sp
    val CaptionSize = 13.sp
}
