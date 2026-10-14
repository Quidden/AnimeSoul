$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$envPath = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $envPath) {
    Write-Output 'Existing .env preserved.'
    exit 0
}
function New-HexSecret([int]$Length) {
    $bytes = New-Object byte[] $Length
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
$password = New-HexSecret 24
$key = New-HexSecret 32
$template = [System.IO.File]::ReadAllText((Join-Path $projectRoot '.env.example'))
$template = $template.Replace('replace-with-random-local-password', $password)
$template = [regex]::Replace($template, '(?m)^MFA_ENCRYPTION_KEY=\r?$', "MFA_ENCRYPTION_KEY=$key")
$stream = [System.IO.File]::Open($envPath, [System.IO.FileMode]::CreateNew)
try {
    $bytes = (New-Object System.Text.UTF8Encoding $false).GetBytes($template)
    $stream.Write($bytes, 0, $bytes.Length)
} finally { $stream.Dispose() }
Write-Output 'Created private .env. Docker will use PostgreSQL and compiled applications.'
