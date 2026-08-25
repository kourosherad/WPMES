$ErrorActionPreference = 'Stop'

$certificateOutput = 'C:\Users\esfahani\Documents\Codex\2026-08-23\new-chat\tools\khatnegar-certificates'
$serverPasswordFile = '\\172.30.197.93\C$\Project\FactoryFlowPhase1\certs\tls.pass'
New-Item -ItemType Directory -Path $certificateOutput -Force | Out-Null

$rootCertificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject 'CN=Khatnegar Factory Local Root CA 2026' `
    -KeyAlgorithm RSA `
    -KeyLength 4096 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -KeyUsage CertSign, CRLSign, DigitalSignature `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -NotBefore (Get-Date).AddMinutes(-5) `
    -NotAfter (Get-Date).AddYears(10) `
    -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=1')

$rootFile = Join-Path $certificateOutput 'Khatnegar-Local-Root-CA.cer'
Export-Certificate -Cert $rootCertificate -FilePath $rootFile -Force | Out-Null
Import-Certificate -FilePath $rootFile -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null

$serverCertificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject 'CN=172.30.197.93' `
    -Signer $rootCertificate `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -NotBefore (Get-Date).AddMinutes(-5) `
    -NotAfter (Get-Date).AddYears(2) `
    -TextExtension @(
        '2.5.29.17={text}IPAddress=172.30.197.93&DNS=factoryflow.local',
        '2.5.29.37={text}1.3.6.1.5.5.7.3.1'
    )

$serverPasswordText = (Get-Content -LiteralPath $serverPasswordFile -Raw).Trim()
$serverPassword = ConvertTo-SecureString $serverPasswordText -AsPlainText -Force
$serverPfx = Join-Path $certificateOutput 'server.pfx'
Export-PfxCertificate -Cert $serverCertificate -FilePath $serverPfx -Password $serverPassword -ChainOption BuildChain -Force | Out-Null

[pscustomobject]@{
    RootSubject = $rootCertificate.Subject
    RootThumbprint = $rootCertificate.Thumbprint
    ServerSubject = $serverCertificate.Subject
    ServerIssuer = $serverCertificate.Issuer
    ServerThumbprint = $serverCertificate.Thumbprint
    ServerExpires = $serverCertificate.NotAfter
    PfxPath = $serverPfx
    RootPath = $rootFile
}
