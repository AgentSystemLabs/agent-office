package com.agentoffice.xr.ui.pairing

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.SessionConfig
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.agentoffice.xr.qr.PairingPayload
import com.agentoffice.xr.qr.PendingPairing
import com.agentoffice.xr.ui.CAMERA_FALLBACK_BUTTON_TEST_TAG
import com.agentoffice.xr.ui.PAIRING_ROOT_TEST_TAG
import com.agentoffice.xr.ui.PAIRING_STATUS_TEST_TAG
import com.agentoffice.xr.ui.SCAN_BUTTON_TEST_TAG
import com.agentoffice.xr.ui.theme.OfficeTokens
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.ZoomSuggestionOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

private const val TAG = "QrScannerScreen"

/** Cap for ML Kit's auto-zoom suggestion — enough for a distant laptop screen. */
internal const val QR_AUTO_ZOOM_MAX_RATIO = 4.0f

/**
 * QR pairing screen. Tries the permission-less Google code scanner first (no CAMERA
 * prompt); falls back to an in-app CameraX + ML Kit scanner when Play services are
 * missing/outdated or the user asks for it. A decoded [PairingPayload] is stashed in
 * [PendingPairing] and surfaced through [onPaired]. (Dual-path structure adapted from
 * orbXR's `QrScannerScreen`, with the XR-QR-tracking path replaced by the code
 * scanner per the vr-docs Q3 finding.)
 */
@Composable
fun QrScannerScreen(
    modifier: Modifier = Modifier,
    onPaired: (PairingPayload) -> Unit = {},
    onRawQr: ((String) -> Boolean)? = null,
) {
    var useCameraFallback by remember { mutableStateOf(false) }

    if (!useCameraFallback) {
        CodeScannerEntry(
            modifier = modifier,
            onPaired = onPaired,
            onRawQr = onRawQr,
            onFallback = { useCameraFallback = true },
        )
    } else {
        CameraQrScanner(
            modifier = modifier,
            onPaired = onPaired,
            onRawQr = onRawQr,
        )
    }
}

@Composable
private fun CodeScannerEntry(
    modifier: Modifier,
    onPaired: (PairingPayload) -> Unit,
    onRawQr: ((String) -> Boolean)?,
    onFallback: () -> Unit,
) {
    val context = LocalContext.current
    val router = remember { QrPayloadRouter() }
    var error by remember { mutableStateOf<String?>(null) }
    var scanning by remember { mutableStateOf(false) }
    val currentOnPaired by rememberUpdatedState(onPaired)
    val currentOnRawQr by rememberUpdatedState(onRawQr)
    val currentOnFallback by rememberUpdatedState(onFallback)

    fun startScan() {
        scanning = true
        error = null
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .enableAutoZoom()
            .build()
        val scanner = try {
            GmsBarcodeScanning.getClient(context, options)
        } catch (e: Exception) {
            Log.w(TAG, "code scanner unavailable; falling back to camera", e)
            scanning = false
            currentOnFallback()
            return
        }
        scanner.startScan()
            .addOnSuccessListener { barcode ->
                scanning = false
                val raw = barcode.rawValue
                if (raw.isNullOrBlank()) {
                    error = "Empty scan result — try again."
                    return@addOnSuccessListener
                }
                when (val result = router.route(raw, currentOnRawQr, currentOnPaired)) {
                    is QrRouteResult.Invalid -> {
                        Log.w(TAG, "QR parse failed", result.error)
                        error = result.error.message
                    }
                    else -> Unit
                }
            }
            .addOnCanceledListener {
                scanning = false
            }
            .addOnFailureListener { e ->
                // Play services missing or outdated on this headset — drop to CameraX.
                Log.w(TAG, "code scanner failed; falling back to camera", e)
                scanning = false
                currentOnFallback()
            }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(32.dp)
            .testTag(PAIRING_ROOT_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Pair this headset",
            color = OfficeTokens.OnSurface,
            fontSize = OfficeTokens.TitleSize,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = "Scan the QR code shown by agent-office on your laptop.",
            color = OfficeTokens.OnSurfaceVariant,
            fontSize = OfficeTokens.BodySize,
            textAlign = TextAlign.Center,
        )
        Button(
            modifier = Modifier
                .padding(top = 8.dp)
                .testTag(SCAN_BUTTON_TEST_TAG),
            onClick = ::startScan,
            enabled = !scanning,
        ) {
            Text(if (scanning) "Scanning…" else "Scan pairing QR")
        }
        OutlinedButton(
            modifier = Modifier.testTag(CAMERA_FALLBACK_BUTTON_TEST_TAG),
            onClick = onFallback,
        ) {
            Text("Use camera scanner")
        }
        val errorMessage = error
        if (errorMessage != null) {
            Text(
                text = errorMessage,
                color = OfficeTokens.Danger,
                fontSize = OfficeTokens.CaptionSize,
                textAlign = TextAlign.Center,
                modifier = Modifier.testTag(PAIRING_STATUS_TEST_TAG),
            )
        }
    }
}

@Composable
private fun CameraQrScanner(
    modifier: Modifier,
    onPaired: (PairingPayload) -> Unit,
    onRawQr: ((String) -> Boolean)?,
) {
    val context = LocalContext.current
    var hasCameraPermission by remember {
        mutableStateOf(context.hasPermission(Manifest.permission.CAMERA))
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> hasCameraPermission = granted }

    LifecycleResumeEffect(Unit) {
        hasCameraPermission = context.hasPermission(Manifest.permission.CAMERA)
        onPauseOrDispose {}
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
            .testTag(PAIRING_ROOT_TEST_TAG),
    ) {
        if (hasCameraPermission) {
            CameraQrScannerContent(onPaired = onPaired, onRawQr = onRawQr)
        } else {
            PermissionRequest(
                onRequest = { permissionLauncher.launch(Manifest.permission.CAMERA) },
                rationale = "Agent Office XR needs camera access to scan pairing QR codes shown on your laptop.",
            )
        }
    }
}

@Composable
private fun PermissionRequest(
    onRequest: () -> Unit,
    rationale: String,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Connect your office",
            color = OfficeTokens.OnSurface,
            fontSize = OfficeTokens.TitleSize,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = rationale,
            color = OfficeTokens.OnSurfaceVariant,
            fontSize = OfficeTokens.BodySize,
            textAlign = TextAlign.Center,
        )
        Button(
            modifier = Modifier.padding(top = 8.dp),
            onClick = onRequest,
        ) {
            Text("Allow QR scanning")
        }
    }
}

@SuppressLint("UnsafeOptInUsageError")
@Composable
private fun CameraQrScannerContent(
    onPaired: (PairingPayload) -> Unit,
    onRawQr: ((String) -> Boolean)?,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val analyzerExecutor = remember { Executors.newSingleThreadExecutor() }
    // Filled in once bindToLifecycle returns; the ML Kit zoom callback reads it to drive
    // CameraControl.setZoomRatio(). A holder (not a recomposed state) because the callback
    // fires from ML Kit's executor thread, outside composition.
    val zoomCameraHolder = remember { ZoomCameraHolder() }
    // enableAllPotentialBarcodes keeps partially-visible codes flowing so zoom suggestions
    // arrive for small/distant laptop-screen QR codes the user shouldn't have to lean into.
    val barcodeScanner: BarcodeScanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .enableAllPotentialBarcodes()
                .setZoomSuggestionOptions(zoomSuggestionOptions(zoomCameraHolder))
                .build(),
        )
    }
    var lastError by remember { mutableStateOf<String?>(null) }
    var cameraUnavailable by remember { mutableStateOf<String?>(null) }
    val currentOnPaired by rememberUpdatedState(onPaired)
    val currentOnRawQr by rememberUpdatedState(onRawQr)
    val router = remember { QrPayloadRouter() }

    DisposableEffect(Unit) {
        onDispose {
            analyzerExecutor.shutdown()
            barcodeScanner.close()
        }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            val previewView = PreviewView(ctx).apply {
                scaleType = PreviewView.ScaleType.FILL_CENTER
            }
            val providerFuture = ProcessCameraProvider.getInstance(ctx)
            providerFuture.addListener({
                val provider = providerFuture.get()
                val preview = Preview.Builder().build().apply {
                    setSurfaceProvider(previewView.surfaceProvider)
                }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(analyzerExecutor) { proxy ->
                    val image = proxy.image
                    if (image == null) {
                        proxy.close()
                        return@setAnalyzer
                    }
                    val input = InputImage.fromMediaImage(image, proxy.imageInfo.rotationDegrees)
                    barcodeScanner.process(input)
                        .addOnSuccessListener { barcodes ->
                            val raw = barcodes.firstNotNullOfOrNull { it.rawValue }
                            if (raw != null) {
                                val result = router.route(
                                    raw = raw,
                                    onRawQr = currentOnRawQr,
                                    onPaired = currentOnPaired,
                                )
                                if (result is QrRouteResult.Invalid) {
                                    Log.w(TAG, "QR parse failed", result.error)
                                    lastError = result.error.message
                                }
                            }
                        }
                        .addOnFailureListener { err ->
                            Log.w(TAG, "ML Kit barcode scan failed", err)
                        }
                        .addOnCompleteListener {
                            proxy.close()
                        }
                }

                provider.unbindAll()
                // Pre-flight: on XR headsets the camera may be claimed by the spatial runtime.
                // Validate the Preview + Analysis session before binding so a resource conflict
                // surfaces a readable status instead of stalling pairing inside bindToLifecycle.
                val available = runCatching {
                    provider.getCameraInfo(CameraSelector.DEFAULT_BACK_CAMERA)
                }.fold(
                    onSuccess = { cameraInfo ->
                        cameraInfo.isSessionConfigSupported(SessionConfig(preview, analysis))
                    },
                    onFailure = { false },
                )
                if (!available) {
                    Log.w(TAG, "Camera session not supported; showing pairing guidance")
                    cameraUnavailable =
                        "Camera is busy or unavailable — check no other app is using it, then reopen the scanner."
                    analysis.clearAnalyzer()
                    return@addListener
                }
                val camera: Camera = provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis,
                )
                // Hand the bound camera to the ML Kit zoom callback so suggested ratios for
                // distant laptop-screen QR codes reach CameraControl.
                zoomCameraHolder.camera = camera
            }, ContextCompat.getMainExecutor(ctx))
            previewView
        },
    )

    val errorMessage = lastError
    if (errorMessage != null) {
        Box(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            contentAlignment = Alignment.BottomStart,
        ) {
            Text(
                text = "ignored invalid QR: $errorMessage",
                color = OfficeTokens.Danger,
                fontSize = OfficeTokens.CaptionSize,
                modifier = Modifier
                    .background(Color(0x99000000))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
                    .testTag(PAIRING_STATUS_TEST_TAG),
            )
        }
    }

    // Pre-flight session check failed (XR runtime holding the camera): keep the scanner chrome
    // up with a real explanation instead of a black stall. Never invents connectivity — the
    // pairing payload path is untouched, only camera availability is reported.
    val unavailableMessage = cameraUnavailable
    if (unavailableMessage != null) {
        ScannerPrompt(title = "Camera unavailable", detail = unavailableMessage)
    }
}

@Composable
private fun ScannerPrompt(title: String, detail: String) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = title,
            color = OfficeTokens.OnSurface,
            fontSize = OfficeTokens.TitleSize,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        Text(
            text = detail,
            color = OfficeTokens.OnSurfaceVariant,
            fontSize = OfficeTokens.BodySize,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag(PAIRING_STATUS_TEST_TAG),
        )
    }
}

/**
 * Bound-camera holder for ML Kit's zoom callback. Written once from the CameraX main-executor
 * bind callback, read from ML Kit's detector thread — hence volatile.
 */
internal class ZoomCameraHolder {
    @Volatile
    var camera: Camera? = null
}

/**
 * Intelligent auto-zoom for QR pairing: ML Kit suggests a zoom ratio when the code is small or
 * distant (the laptop screen across the room) and the callback applies it through
 * CameraControl.setZoomRatio, clamped to [QR_AUTO_ZOOM_MAX_RATIO] and the device's reported
 * max so out-of-range suggestions can't throw. Declines (returns false) when no camera is
 * bound yet.
 */
internal fun zoomSuggestionOptions(holder: ZoomCameraHolder): ZoomSuggestionOptions =
    ZoomSuggestionOptions.Builder { suggestedRatio ->
        val camera = holder.camera ?: return@Builder false
        val maxZoom = camera.cameraInfo.zoomState.value
            ?.maxZoomRatio
            ?.takeIf { it >= 1f }
            ?: QR_AUTO_ZOOM_MAX_RATIO
        val clamped = suggestedRatio.coerceIn(1f, minOf(maxZoom, QR_AUTO_ZOOM_MAX_RATIO))
        camera.cameraControl.setZoomRatio(clamped)
        true
    }
        .setMaxSupportedZoomRatio(QR_AUTO_ZOOM_MAX_RATIO)
        .build()

private fun Context.hasPermission(permission: String): Boolean =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

internal class QrPayloadRouter {
    private var lastDecodedRaw: String? = null

    fun route(
        raw: String,
        onRawQr: ((String) -> Boolean)?,
        onPaired: (PairingPayload) -> Unit,
    ): QrRouteResult {
        if (raw == lastDecodedRaw) return QrRouteResult.Duplicate
        lastDecodedRaw = raw

        if (onRawQr?.invoke(raw) == true) return QrRouteResult.HandledRaw

        return PairingPayload.parse(raw).fold(
            onSuccess = { payload ->
                PendingPairing.set(payload)
                onPaired(payload)
                QrRouteResult.Paired(payload)
            },
            onFailure = QrRouteResult::Invalid,
        )
    }
}

internal sealed interface QrRouteResult {
    data object Duplicate : QrRouteResult
    data object HandledRaw : QrRouteResult
    data class Paired(val payload: PairingPayload) : QrRouteResult
    data class Invalid(val error: Throwable) : QrRouteResult
}
