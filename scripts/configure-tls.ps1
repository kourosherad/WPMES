$ErrorActionPreference = 'Stop'
$certDir = 'C:\Project\FactoryFlowPhase1\certs'

try {
  $passText = Get-Content -LiteralPath "$certDir\tls.pass" -Raw
  $securePass = ConvertTo-SecureString $passText -AsPlainText -Force
  $root = New-SelfSignedCertificate -Type Custom -Subject 'CN=Rivet Factory Local Root CA' -FriendlyName 'Rivet Factory Local Root CA' -CertStoreLocation 'Cert:\LocalMachine\My' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage CertSign,CRLSign,DigitalSignature -KeyUsageProperty Sign -NotAfter (Get-Date).AddYears(5) -TextExtension @('2.5.29.19={critical}{text}ca=true&pathlength=1')
  $leaf = New-SelfSignedCertificate -Type Custom -Subject 'CN=172.30.197.93' -FriendlyName 'Rivet Factory Flow HTTPS' -Signer $root -CertStoreLocation 'Cert:\LocalMachine\My' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage DigitalSignature,KeyEncipherment -NotAfter (Get-Date).AddYears(2) -TextExtension @('2.5.29.17={text}IPAddress=172.30.197.93&DNS=factoryflow.local')
  Export-PfxCertificate -Cert $leaf -FilePath "$certDir\server.pfx" -Password $securePass -Force | Out-Null
  Export-Certificate -Cert $root -FilePath "$certDir\rivet-ca.cer" -Force | Out-Null
  Import-Certificate -FilePath "$certDir\rivet-ca.cer" -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
  Set-Content -LiteralPath "$certDir\ready.txt" -Value ($root.Thumbprint + '|' + $leaf.Thumbprint) -Encoding ascii
  Set-Content -LiteralPath "$certDir\certjob.txt" -Value 'OK' -Encoding ascii
} catch {
  Set-Content -LiteralPath "$certDir\certjob.txt" -Value ($_ | Out-String) -Encoding utf8
  exit 1
}
