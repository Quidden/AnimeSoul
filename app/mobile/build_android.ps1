param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$mobileRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$androidRoot = Join-Path $mobileRoot "android"
$toolchains = Join-Path $mobileRoot ".toolchains"
$bundledJava = Get-ChildItem (Join-Path $toolchains "jdk") -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue |
    Select-Object -First 1
$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $toolchains "android-sdk" }

if (-not $env:JAVA_HOME -and $bundledJava) {
    $env:JAVA_HOME = $bundledJava.FullName
}
if (-not $env:JAVA_HOME) {
    throw "JDK 17 не найден. Установите JAVA_HOME или положите JDK в app/mobile/.toolchains/jdk."
}
if (-not (Test-Path (Join-Path $sdkRoot "platforms/android-35"))) {
    throw "Android SDK 35 не найден: $sdkRoot"
}

$env:ANDROID_SDK_ROOT = $sdkRoot
$escapedSdk = $sdkRoot.Replace('\', '/').Replace(':', '\:')
Set-Content -LiteralPath (Join-Path $androidRoot "local.properties") -Value "sdk.dir=$escapedSdk" -Encoding ASCII

Push-Location $androidRoot
try {
    & ".\gradlew.bat" "assemble$Configuration"
    if ($LASTEXITCODE -ne 0) { throw "Gradle завершился с кодом $LASTEXITCODE" }
} finally {
    Pop-Location
}

$variant = $Configuration.ToLowerInvariant()
$source = Join-Path $androidRoot "app/build/outputs/apk/$variant/app-$variant.apk"
$releaseDirectory = Join-Path $mobileRoot "releases"
New-Item -ItemType Directory -Force $releaseDirectory | Out-Null
$suffix = if ($Configuration -eq "Release") { "" } else { "-debug" }
$destination = Join-Path $releaseDirectory "AnimeSoul-0.2.4-android-arm64$suffix.apk"
Copy-Item -LiteralPath $source -Destination $destination -Force
Write-Host "APK: $destination"
