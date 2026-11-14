[CmdletBinding()]
param([switch]$TrustLocalCertificate)
# Explicit trust is current-user only and removed on normal shutdown. Hard termination can prevent cleanup.
& {
  param($PermitTrust)
  $ErrorActionPreference = 'Stop'
  if (-not $PermitTrust) { throw 'Run with -TrustLocalCertificate to permit temporary localhost certificate trust.' }
  $repo = 'C:\Users\caleb\Documents\GitHub\codeximmortal-mcp\codeximmortal-mcp'
  if ([IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\') -ne $repo) {
    throw 'Run this script from the protected nested checkout.'
  }
  foreach ($command in @('git','npm.cmd','node','New-SelfSignedCertificate','Export-PfxCertificate','Import-Certificate')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw ('Missing command: ' + $command) }
  }
  Push-Location -LiteralPath $repo
  $cert = $null; $trusted = $false; $temp = $null; $secure = $null; $again = $null
  $password = $null; $confirmation = $null
  $keys = @('PASSWORD','REVISION','PFX','PFX_PASSWORD','CA')
  $previous = @{}
  foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable(('CODEX_OWNER_LOCAL_' + $key),'Process') }
  $lock = Join-Path $repo 'package-lock.json'
  $lockHash = if (Test-Path -LiteralPath $lock) { (Get-FileHash -LiteralPath $lock).Hash } else { $null }
  try {
    $top = & git rev-parse --show-toplevel
    if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($top).TrimEnd('\') -ne $repo) { throw 'Wrong working copy.' }
    $branch = & git branch --show-current
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'feat/agent-native-commerce-api') { throw 'Wrong branch.' }
    & git diff --quiet HEAD --
    if ($LASTEXITCODE -ne 0) { throw 'Tracked changes present. No reset or overwrite performed.' }
    $revision = & git rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[a-f0-9]{40}$') { throw 'Cannot resolve local commit.' }
    if (-not (Test-Path 'node_modules/.bin/tsc.cmd') -or -not (Test-Path 'node_modules/.bin/vitest.cmd')) { throw 'Existing local dependencies are required. No installation performed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; dashboard not started.' }
    & npm.cmd exec -- vitest run src/control/owner-app.integration.test.ts src/control/owner-local.test.ts src/control/owner-console.test.ts src/control/owner-tasks-http.test.ts
    if ($LASTEXITCODE -ne 0) { throw 'Owner tests failed; dashboard not started.' }
    $after = & git rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $after -ne $revision) { throw 'HEAD changed during startup checks.' }
    $secure = Read-Host 'Choose a unique owner password (20-256 characters; never paste it into chat)' -AsSecureString
    $again = Read-Host 'Confirm the owner password' -AsSecureString
    $password = [Net.NetworkCredential]::new('', $secure).Password
    $confirmation = [Net.NetworkCredential]::new('', $again).Password
    if ($password.Length -lt 20 -or $password.Length -gt 256 -or $password -cne $confirmation) { throw 'Password length invalid or confirmation mismatch.' }
    $confirmation = $null
    $temp = Join-Path ([IO.Path]::GetTempPath()) ('codex-owner-' + [guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $temp)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule); Set-Acl -LiteralPath $temp -AclObject $acl
    $cert = New-SelfSignedCertificate -DnsName 'localhost' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays(2) -FriendlyName ('Codex local owner ' + [guid]::NewGuid().ToString('N'))
    $pfxPassword = [guid]::NewGuid().ToString('N')
    $pfxSecure = ConvertTo-SecureString $pfxPassword -AsPlainText -Force
    try { Export-PfxCertificate -Cert $cert -FilePath (Join-Path $temp 'owner.pfx') -Password $pfxSecure -CryptoAlgorithmOption AES256_SHA256 | Out-Null }
    finally { $pfxSecure.Dispose() }
    $cer = Join-Path $temp 'owner.cer'
    [IO.File]::WriteAllBytes($cer, $cert.RawData)
    $pem = '-----BEGIN CERTIFICATE-----' + "`n" + [Convert]::ToBase64String($cert.RawData,[Base64FormattingOptions]::InsertLineBreaks) + "`n-----END CERTIFICATE-----`n"
    [IO.File]::WriteAllText((Join-Path $temp 'owner.pem'),$pem,[Text.Encoding]::ASCII)
    Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
    $trusted = $true
    $env:CODEX_OWNER_LOCAL_PASSWORD = $password
    $env:CODEX_OWNER_LOCAL_REVISION = $revision
    $env:CODEX_OWNER_LOCAL_PFX = Join-Path $temp 'owner.pfx'
    $env:CODEX_OWNER_LOCAL_PFX_PASSWORD = $pfxPassword
    $env:CODEX_OWNER_LOCAL_CA = Join-Path $temp 'owner.pem'
    $password = $null; $pfxPassword = $null
    Write-Host 'Starting local owner dashboard. Keep this terminal open; Ctrl+C stops it.'
    & node dist/control/owner-local.js
    if ($LASTEXITCODE -ne 0) { throw 'Dashboard stopped with a startup/runtime error. No deployment was changed.' }
  } finally {
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable(('CODEX_OWNER_LOCAL_' + $key),$previous[$key],'Process') }
    $password = $null; $confirmation = $null
    if ($secure) { $secure.Dispose() }; if ($again) { $again.Dispose() }
    if ($cert) {
      if ($trusted) {
        try { Remove-Item -LiteralPath ('Cert:\CurrentUser\Root\' + $cert.Thumbprint) -ErrorAction Stop }
        catch { Write-Warning ('Remove script-created trusted certificate manually: ' + $cert.Thumbprint) }
      }
      try { Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $cert.Thumbprint) -DeleteKey -ErrorAction Stop }
      catch { Write-Warning ('Remove script-created private certificate manually: ' + $cert.Thumbprint) }
    }
    if ($temp) {
      try { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction Stop }
      catch { Write-Warning ('Remove script-owned temporary TLS directory manually: ' + $temp) }
    }
    if ($lockHash -and ((Get-FileHash -LiteralPath $lock).Hash -ne $lockHash)) { Write-Warning 'Lockfile changed; inspect without resetting.' }
    Pop-Location
  }
} $TrustLocalCertificate
