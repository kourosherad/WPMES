$ErrorActionPreference = 'Stop'

$toolRoot = 'C:\Users\esfahani\Documents\Codex\2026-08-23\new-chat\tools'
$logRoot = Join-Path $toolRoot 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

$existing = Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" |
    Where-Object { $_.CommandLine -like '*172.30.197.93:8080*localhost.run*' }
foreach ($process in $existing) {
    Invoke-CimMethod -InputObject $process -MethodName Terminate | Out-Null
}

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdout = Join-Path $logRoot "localhost-run-$runId-out.log"
$stderr = Join-Path $logRoot "localhost-run-$runId-error.log"

$arguments = @(
    '-T'
    '-o', 'StrictHostKeyChecking=accept-new'
    '-o', 'ExitOnForwardFailure=yes'
    '-o', 'ServerAliveInterval=30'
    '-o', 'ServerAliveCountMax=3'
    '-R', '80:172.30.197.93:8080'
    'nokey@localhost.run'
)

$process = Start-Process `
    -FilePath (Get-Command ssh.exe).Source `
    -ArgumentList $arguments `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

$process.Id
