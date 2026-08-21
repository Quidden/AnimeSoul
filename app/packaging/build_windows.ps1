param(
    [string]$InnoCompiler = ""
)

$ErrorActionPreference = "Stop"
$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $AppRoot "..")).Path
$Version = "0.2.2"
$WorkRoot = Join-Path $RepoRoot "release-work"
$PyInstallerWork = Join-Path $WorkRoot "pyinstaller"
$PackageRoot = Join-Path $WorkRoot "AnimeSoul-$Version"
$Python = Join-Path $AppRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python environment not found: $Python"
}

Write-Host "Building React client..."
& npm.cmd --prefix (Join-Path $AppRoot "frontend") run build
if ($LASTEXITCODE -ne 0) {
    throw "React build failed."
}

Write-Host "Building launcher..."
& $Python -m PyInstaller `
    --noconfirm `
    --clean `
    --workpath (Join-Path $PyInstallerWork "launcher") `
    --distpath (Join-Path $PyInstallerWork "launcher-dist") `
    (Join-Path $PSScriptRoot "launcher.spec")
if ($LASTEXITCODE -ne 0) {
    throw "Launcher build failed."
}

Write-Host "Building runtime..."
& $Python -m PyInstaller `
    --noconfirm `
    --clean `
    --workpath (Join-Path $PyInstallerWork "runtime") `
    --distpath (Join-Path $PyInstallerWork "runtime-dist") `
    (Join-Path $PSScriptRoot "runtime.spec")
if ($LASTEXITCODE -ne 0) {
    throw "Runtime build failed."
}

if (Test-Path -LiteralPath $PackageRoot) {
    Remove-Item -LiteralPath $PackageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $PackageRoot | Out-Null

Copy-Item `
    -LiteralPath (Join-Path $PyInstallerWork "launcher-dist\AnimeSoul Launcher.exe") `
    -Destination $PackageRoot
Copy-Item `
    -LiteralPath (Join-Path $PyInstallerWork "runtime-dist\AnimeSoul Runtime") `
    -Destination (Join-Path $PackageRoot "runtime") `
    -Recurse
Copy-Item -LiteralPath (Join-Path $AppRoot "README.md") -Destination $PackageRoot
Copy-Item -LiteralPath (Join-Path $AppRoot "SAVE_COMPATIBILITY.md") -Destination $PackageRoot

if (-not $InnoCompiler) {
    $Candidates = @(
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe",
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe")
    )
    $InnoCompiler = $Candidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
}
if (-not $InnoCompiler -or -not (Test-Path -LiteralPath $InnoCompiler)) {
    throw "Inno Setup 6 compiler not found. Pass -InnoCompiler with the path to ISCC.exe."
}

Write-Host "Building installer..."
& $InnoCompiler (Join-Path $PSScriptRoot "AnimeSoul.iss")
if ($LASTEXITCODE -ne 0) {
    throw "Installer build failed."
}

$Installer = Join-Path $WorkRoot "AnimeSoul-Setup-$Version.exe"
if (-not (Test-Path -LiteralPath $Installer)) {
    throw "Installer was not created: $Installer"
}

Write-Host "Installer ready: $Installer"
