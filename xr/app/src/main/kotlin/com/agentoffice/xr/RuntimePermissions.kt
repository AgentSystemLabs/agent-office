package com.agentoffice.xr

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * Every dangerous / special runtime permission declared in the manifest.
 *
 * Requested once at app startup so the system dialogs don't fire mid-flow and glitch
 * XR layout. Feature code still checks grant state and may offer a soft re-request if
 * the user denied at launch. (Adapted from orbXR's `RuntimePermissions`.)
 */
object RuntimePermissions {

    /**
     * Runtime permissions the app needs, filtered by API level.
     * Install-time normals (INTERNET, ACCESS_NETWORK_STATE) are omitted.
     */
    fun required(sdkInt: Int = Build.VERSION.SDK_INT): List<String> = buildList {
        add(Manifest.permission.CAMERA)
        if (sdkInt >= 37) add(Manifest.permission.ACCESS_LOCAL_NETWORK)
    }

    /** Permissions from [required] that are not currently granted. */
    fun missing(context: Context, sdkInt: Int = Build.VERSION.SDK_INT): Array<String> =
        required(sdkInt)
            .filterNot { context.hasPermission(it) }
            .toTypedArray()

    fun Context.hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
}
