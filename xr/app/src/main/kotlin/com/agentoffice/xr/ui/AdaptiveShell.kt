package com.agentoffice.xr.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.xr.compose.platform.LocalSpatialCapabilities
import androidx.xr.compose.spatial.Subspace
import androidx.xr.compose.subspace.SpatialPanel
import androidx.xr.compose.subspace.layout.MovePolicy
import androidx.xr.compose.subspace.layout.SubspaceModifier
import androidx.xr.compose.subspace.layout.height
import androidx.xr.compose.subspace.layout.movable
import androidx.xr.compose.subspace.layout.width
import com.agentoffice.xr.ui.theme.OfficeTokens

/**
 * Renders [content] in a movable [SpatialPanel] when spatial UI is enabled, else as a
 * plain 2D layout. The 2D fallback is mandatory: `Subspace { … }` is a no-op when
 * spatialization is off, so without it the app would render empty in HomeSpace and on
 * the XR emulator. `spatialEnabledOverride` pins the mode for previews and tests.
 * (Gating pattern copied from orbXR's `AdaptiveTerminalShell`.)
 */
@Composable
fun AdaptiveShell(
    modifier: Modifier = Modifier,
    spatialEnabledOverride: Boolean? = null,
    content: @Composable () -> Unit,
) {
    val isSpatial = spatialEnabledOverride ?: LocalSpatialCapabilities.current.isSpatialUiEnabled
    if (isSpatial) {
        Subspace {
            SpatialPanel(
                SubspaceModifier
                    .width(1100.dp)
                    .height(800.dp)
                    .movable(movePolicy = MovePolicy.Default),
            ) {
                content()
            }
        }
    } else {
        Box(
            modifier = modifier
                .fillMaxSize()
                .background(OfficeTokens.Background),
        ) {
            content()
        }
    }
}
