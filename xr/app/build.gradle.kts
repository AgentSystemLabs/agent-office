import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    // AGP 9 compiles Kotlin via built-in support; no kotlin-android plugin.
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.agentoffice.xr"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.agentoffice.xr"
        minSdk = 24
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"

        ndk {
            abiFilters += listOf("arm64-v8a")
        }

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        // Needed for the BuildConfig.DEBUG gate on the emulator debug-pairing
        // path (see DebugPairing / MainActivity). AGP 9 no longer generates
        // BuildConfig unless explicitly opted in.
        buildConfig = true
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    lint {
        abortOnError = false
    }
}

// AGP 9 built-in Kotlin: the kotlinOptions{} DSL is gone, so the compiler
// target is set via the top-level kotlin{} extension. Emits JVM 17 bytecode
// while running Gradle on JDK 21 (JDK 25 crashes the Kotlin compiler).
kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.xr.runtime)
    implementation(libs.androidx.xr.scenecore)
    implementation(libs.androidx.xr.compose)
    implementation(libs.androidx.xr.arcore)
    // Compile-only XR platform extensions stub (matches Google's xr-samples).
    compileOnly(libs.androidx.xr.extensions)
    // Permission-less QR scan path (preferred) + CameraX + ML Kit fallback.
    implementation(libs.play.services.code.scanner)
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.mlkit.barcode.scanning)
    // Encrypted-at-rest storage (Android Keystore-backed) for the device token.
    implementation(libs.androidx.security.crypto)
    // WebSocket + HTTP claim call to the agent-office server.
    implementation(platform(libs.okhttp.bom))
    implementation(libs.okhttp)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Local unit tests (`./gradlew :app:testDebugUnitTest`).
    testImplementation(libs.junit)
    // PairingPayload + welcome parsing use android's bundled org.json. The
    // mockable android.jar returns default values for it, so pull in the real
    // impl for host-JVM tests that parse fixture payloads.
    testImplementation(libs.json)
    testImplementation(libs.kotlinx.coroutines.test)
}
