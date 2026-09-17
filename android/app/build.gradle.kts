plugins {
    id("com.android.application")
}

val ciVersionCode = providers.environmentVariable("OACLIX_ANDROID_VERSION_CODE")
    .orNull
    ?.toIntOrNull()
    ?.takeIf { it > 0 }

android {
    namespace = "app.oaclix.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.oaclix.android"
        minSdk = 26
        targetSdk = 36
        versionCode = ciVersionCode ?: 1
        versionName = "0.1.0"

        resValue(
            "string",
            "oaclix_api_base_url",
            providers.gradleProperty("OACLIX_API_BASE_URL")
                .orElse("https://oaclix.geovaalvarado0.workers.dev")
                .get(),
        )
    }

    buildFeatures {
        resValues = true
    }

    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
        }

        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:5.3.0")
    implementation("io.github.webrtc-sdk:android-prefixed-stripped:150.7871.01")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
}
