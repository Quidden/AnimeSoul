param(
    [string]$DistinguishedName = "CN=AnimeSoul, O=Quidden, C=UA"
)

$ErrorActionPreference = "Stop"
$mobileRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$signingRoot = Join-Path $mobileRoot "android\signing"
$propertiesPath = Join-Path $signingRoot "keystore.properties"
$keystorePath = Join-Path $signingRoot "animesoul-release.p12"
$keytool = Join-Path $mobileRoot ".toolchains\jdk\jdk-17.0.19+10\bin\keytool.exe"

if (-not (Test-Path -LiteralPath $keytool)) {
    $keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
}
if (-not (Test-Path -LiteralPath $keytool)) {
    throw "JDK keytool не найден."
}
if ((Test-Path -LiteralPath $keystorePath) -or (Test-Path -LiteralPath $propertiesPath)) {
    throw "Release-ключ уже существует. Скрипт никогда не заменяет его автоматически."
}

New-Item -ItemType Directory -Path $signingRoot -Force | Out-Null
$random = New-Object byte[] 36
[Security.Cryptography.RandomNumberGenerator]::Fill($random)
$password = [Convert]::ToBase64String($random).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$env:ANIMESOUL_GENERATED_KEY_PASSWORD = $password

try {
    & $keytool `
        -genkeypair `
        -alias animesoul `
        -keyalg RSA `
        -keysize 4096 `
        -sigalg SHA256withRSA `
        -validity 10950 `
        -dname $DistinguishedName `
        -storetype PKCS12 `
        -keystore $keystorePath `
        -storepass:env ANIMESOUL_GENERATED_KEY_PASSWORD `
        -keypass:env ANIMESOUL_GENERATED_KEY_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw "keytool завершился с кодом $LASTEXITCODE" }

    @(
        "storeFile=animesoul-release.p12"
        "storePassword=$password"
        "keyAlias=animesoul"
        "keyPassword=$password"
    ) | Set-Content -LiteralPath $propertiesPath -Encoding UTF8
} finally {
    Remove-Item Env:ANIMESOUL_GENERATED_KEY_PASSWORD -ErrorAction SilentlyContinue
}

Write-Host "Release-ключ создан в $signingRoot"
Write-Host "Сделайте защищённую резервную копию всей папки: без неё обновить опубликованный APK будет невозможно."
