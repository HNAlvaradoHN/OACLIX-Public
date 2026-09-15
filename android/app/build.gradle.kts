plugins {
    id("com.android.application")
}

val ciVersionCode = providers.environmentVariable("OACLIX_ANDROID_VERSION_CODE")
    .orNull
    ?.toIntOrNull()
    ?.takeIf { it > 0 }

val ciApplicationIdSuffix = providers.environmentVariable("OACLIX_ANDROID_APPLICATION_ID_SUFFIX")
    .orNull
    ?.trim()
    ?.takeIf { it.matches(Regex("\\.[A-Za-z0-9._-]+")) }
    .orEmpty()

val webBundleDir = rootProject.file("../dist-android")

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
                .orElse("https://oaclix.invalid")
                .get(),
        )
    }

    buildFeatures {
        resValues = true
    }

    sourceSets {
        getByName("main").assets.srcDir(webBundleDir)
    }

    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".dev"
            if (ciApplicationIdSuffix.isNotEmpty()) {
                applicationIdSuffix = ".dev$ciApplicationIdSuffix"
            }
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

tasks.register("verifyWebBundle") {
    doLast {
        check(webBundleDir.resolve("index.html").isFile) {
            "Falta dist-android/index.html. Ejecuta npm run build:android-web antes de compilar Android."
        }
    }
}

tasks.named("preBuild").configure {
    dependsOn("verifyWebBundle")
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:5.3.0")
    implementation("io.github.webrtc-sdk:android-prefixed-stripped:150.7871.01")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
}
