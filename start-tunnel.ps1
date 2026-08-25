$ErrorActionPreference = 'Stop'

$appRoot = 'C:\Project\FactoryFlowPhase1'
$logRoot = Join-Path $appRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

$existing = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
    Where-Object { $_.CommandLine -like '*FactoryFlowPhase1*' }
foreach ($process in $existing) {
    Invoke-CimMethod -InputObject $process -MethodName Terminate | Out-Null
}

$arguments = @(
    'tunnel'
    '--no-autoupdate'
    '--url', 'http://127.0.0.1:8080'
    '--logfile', (Join-Path $logRoot 'cloudflared.log')
    '--loglevel', 'info'
)

$process = Start-Process `
    -FilePath (Join-Path $appRoot 'cloudflared.exe') `
    -ArgumentList $arguments `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot 'cloudflared-out.log') `
    -RedirectStandardError (Join-Path $logRoot 'cloudflared-error.log') `
    -PassThru

$process.Id
