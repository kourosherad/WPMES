$ErrorActionPreference = 'Stop'

$toolRoot = 'C:\Users\esfahani\Documents\Codex\2026-08-23\new-chat\tools'
$logRoot = Join-Path $toolRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

$existing = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
    Where-Object { $_.ExecutablePath -eq (Join-Path $toolRoot 'cloudflared.exe') }
foreach ($process in $existing) {
    Invoke-CimMethod -InputObject $process -MethodName Terminate | Out-Null
}

foreach ($name in 'cloudflared.log', 'cloudflared-out.log', 'cloudflared-error.log') {
    $path = Join-Path $logRoot $name
    if (Test-Path -LiteralPath $path) { Clear-Content -LiteralPath $path }
}

$arguments = @(
    'tunnel'
    '--no-autoupdate'
    '--url', 'http://172.30.197.93:8080'
    '--logfile', (Join-Path $logRoot 'cloudflared.log')
    '--loglevel', 'info'
)

$process = Start-Process `
    -FilePath (Join-Path $toolRoot 'cloudflared.exe') `
    -ArgumentList $arguments `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot 'cloudflared-out.log') `
    -RedirectStandardError (Join-Path $logRoot 'cloudflared-error.log') `
    -PassThru

$process.Id
