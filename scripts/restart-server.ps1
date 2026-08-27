$ErrorActionPreference = 'Stop'
$app = 'C:\Project\FactoryFlowPhase1'
$listenerPids = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 443, 8080 } |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($processId in $listenerPids) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq 'node') { Stop-Process -Id $processId -Force }
}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*server.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$deadline = (Get-Date).AddSeconds(10)
do {
  $occupied = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 443, 8080 }
  if (-not $occupied) { break }
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
if ($occupied) { throw 'Application ports 443/8080 did not become available.' }
Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList 'server.mjs' -WorkingDirectory $app -WindowStyle Hidden -RedirectStandardOutput "$app\logs\server-out.log" -RedirectStandardError "$app\logs\server-error.log"
