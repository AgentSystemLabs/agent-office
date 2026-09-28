package com.agentoffice.xr.ui.connecting

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.agentoffice.xr.ui.CONNECTING_ROOT_TEST_TAG
import com.agentoffice.xr.ui.CONNECTING_STATUS_TEST_TAG
import com.agentoffice.xr.ui.FORGET_BUTTON_TEST_TAG
import com.agentoffice.xr.ui.theme.OfficeTokens

/**
 * Claim / connect / reconnect status. [error] is set when the claim failed or
 * reconnect gave up; "Forget pairing and rescan" always returns to the scanner.
 */
@Composable
fun ConnectingScreen(
    status: String,
    serverUrl: String?,
    error: String?,
    modifier: Modifier = Modifier,
    onForget: () -> Unit = {},
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(32.dp)
            .testTag(CONNECTING_ROOT_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = OfficeTokens.Accent)
        Text(
            text = status,
            color = OfficeTokens.OnSurface,
            fontSize = OfficeTokens.TitleSize,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag(CONNECTING_STATUS_TEST_TAG),
        )
        if (serverUrl != null) {
            Text(
                text = serverUrl,
                color = OfficeTokens.OnSurfaceVariant,
                fontSize = OfficeTokens.BodySize,
                textAlign = TextAlign.Center,
            )
        }
        if (error != null) {
            Text(
                text = error,
                color = OfficeTokens.Danger,
                fontSize = OfficeTokens.BodySize,
                textAlign = TextAlign.Center,
            )
        }
        OutlinedButton(
            modifier = Modifier
                .padding(top = 8.dp)
                .testTag(FORGET_BUTTON_TEST_TAG),
            onClick = onForget,
        ) {
            Text("Forget pairing and rescan")
        }
    }
}
