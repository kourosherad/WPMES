$ErrorActionPreference = 'Stop'
$app = 'C:\Project\FactoryFlowPhase1'
$log = Join-Path $app 'logs\phase1-update.log'

Set-Location -LiteralPath $app
New-Item -ItemType Directory -Path (Join-Path $app 'logs') -Force | Out-Null

try {
  $smokeOut = Join-Path $app 'logs\smoke-route-out.log'
  $smokeError = Join-Path $app 'logs\smoke-route-error.log'
  $smoke = Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList 'scripts\smoke-production-flow.mjs' -WorkingDirectory $app -Wait -PassThru -RedirectStandardOutput $smokeOut -RedirectStandardError $smokeError
  Get-Content -LiteralPath $smokeOut -ErrorAction SilentlyContinue | Set-Content -LiteralPath $log
  Get-Content -LiteralPath $smokeError -ErrorAction SilentlyContinue | Add-Content -LiteralPath $log
  if ($smoke.ExitCode -ne 0) { throw "Production flow smoke test failed with exit code $($smoke.ExitCode)" }

  & (Join-Path $app 'scripts\restart-server.ps1')
  Start-Sleep -Seconds 2

  $listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 443, 8080 }
  if (-not $listener) { throw 'WPMES did not open an application listener after restart.' }

  "DEPLOYED $(Get-Date -Format o)" | Add-Content -LiteralPath $log
} catch {
  "FAILED $(Get-Date -Format o)`n$($_ | Out-String)" | Add-Content -LiteralPath $log
  exit 1
}
