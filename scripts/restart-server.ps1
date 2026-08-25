$ErrorActionPreference = 'Stop'
$app = 'C:\Project\FactoryFlowPhase1'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*FactoryFlowPhase1*server.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Milliseconds 700
Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList 'server.mjs' -WorkingDirectory $app -WindowStyle Hidden -RedirectStandardOutput "$app\logs\server-out.log" -RedirectStandardError "$app\logs\server-error.log"
