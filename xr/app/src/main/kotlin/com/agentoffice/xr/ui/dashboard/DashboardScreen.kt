package com.agentoffice.xr.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.agentoffice.xr.net.OfficeSnapshot
import com.agentoffice.xr.net.WorkerSummary
import com.agentoffice.xr.ui.DASHBOARD_FLOOR_TEST_TAG
import com.agentoffice.xr.ui.DASHBOARD_PEERS_TEST_TAG
import com.agentoffice.xr.ui.DASHBOARD_ROOT_TEST_TAG
import com.agentoffice.xr.ui.DASHBOARD_SERVER_TEST_TAG
import com.agentoffice.xr.ui.DASHBOARD_STATUS_TEST_TAG
import com.agentoffice.xr.ui.DASHBOARD_WORKERS_TEST_TAG
import com.agentoffice.xr.ui.FORGET_BUTTON_TEST_TAG
import com.agentoffice.xr.ui.theme.OfficeTokens

/**
 * Connected dashboard: connection status, server URL, floor name, worker list, peer
 * count. Plain Compose controls — controller rays and hand rays click through the
 * system pointer, no per-button controller API needed (vr-docs Q2).
 */
@Composable
fun DashboardScreen(
    snapshot: OfficeSnapshot,
    serverUrl: String,
    connectionLabel: String,
    modifier: Modifier = Modifier,
    onForget: () -> Unit = {},
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(32.dp)
            .testTag(DASHBOARD_ROOT_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(12.dp)
                    .clip(CircleShape)
                    .background(OfficeTokens.Online),
            )
            Text(
                text = connectionLabel,
                color = OfficeTokens.OnSurface,
                fontSize = OfficeTokens.BodySize,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.testTag(DASHBOARD_STATUS_TEST_TAG),
            )
        }
        Text(
            text = serverUrl,
            color = OfficeTokens.OnSurfaceVariant,
            fontSize = OfficeTokens.BodySize,
            modifier = Modifier.testTag(DASHBOARD_SERVER_TEST_TAG),
        )

        SectionLabel("Floor")
        Text(
            text = snapshot.floorName,
            color = OfficeTokens.OnSurface,
            fontSize = OfficeTokens.TitleSize,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.testTag(DASHBOARD_FLOOR_TEST_TAG),
        )

        SectionLabel("Workers (${snapshot.workers.size})")
        LazyColumn(
            modifier = Modifier
                .weight(1f, fill = false)
                .testTag(DASHBOARD_WORKERS_TEST_TAG),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(snapshot.workers, key = { it.id }) { worker ->
                WorkerRow(worker)
            }
        }

        Text(
            text = "Peers online: ${snapshot.peers.size}",
            color = OfficeTokens.OnSurface,
            fontSize = OfficeTokens.BodySize,
            modifier = Modifier.testTag(DASHBOARD_PEERS_TEST_TAG),
        )

        Spacer(modifier = Modifier.weight(1f))

        OutlinedButton(
            modifier = Modifier.testTag(FORGET_BUTTON_TEST_TAG),
            onClick = onForget,
        ) {
            Text("Forget pairing")
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text.uppercase(),
        color = OfficeTokens.OnSurfaceFaint,
        fontSize = OfficeTokens.CaptionSize,
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun WorkerRow(worker: WorkerSummary) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OfficeTokens.ChromeCorner))
            .background(OfficeTokens.SurfaceContainer)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(statusColor(worker.status)),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = worker.name,
                color = OfficeTokens.OnSurface,
                fontSize = OfficeTokens.BodySize,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = worker.status,
                color = OfficeTokens.OnSurfaceVariant,
                fontSize = OfficeTokens.CaptionSize,
            )
        }
        val desk = worker.deskId
        if (desk.isNotEmpty()) {
            Text(
                text = desk,
                color = OfficeTokens.OnSurfaceFaint,
                fontSize = OfficeTokens.CaptionSize,
            )
        }
    }
}

private fun statusColor(status: String): Color = when (status) {
    "working" -> OfficeTokens.Online
    "needs_input", "done" -> OfficeTokens.Warning
    "starting" -> OfficeTokens.Accent
    "idle" -> OfficeTokens.OnSurfaceVariant
    else -> OfficeTokens.OnSurfaceFaint
}
