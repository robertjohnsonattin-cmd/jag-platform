# setup-credentials.ps1
# Run ONCE to securely store your JAG Keycloak password.
# The password is encrypted with Windows DPAPI - tied to YOUR Windows user account
# on THIS machine only. The encrypted blob is useless to anyone else.
# Usage: Right-click -> Run as PowerShell (no admin needed)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CredsFile = Join-Path $ScriptDir ".jag-kc-credentials"

Write-Host ""
Write-Host "JAG Keycloak Credential Setup"
Write-Host "================================"
Write-Host "Your password will be encrypted with Windows DPAPI."
Write-Host "Only YOUR Windows account on THIS machine can decrypt it."
Write-Host ""

$Username = Read-Host "Keycloak username (email)"
$SecurePassword = Read-Host "Keycloak password" -AsSecureString

$EncryptedPassword = $SecurePassword | ConvertFrom-SecureString

Set-Content -Path $CredsFile -Encoding UTF8 -Value "USERNAME=$Username`nENCRYPTED_PASSWORD=$EncryptedPassword"

Write-Host ""
Write-Host "Saved to: $CredsFile"
Write-Host "Password is DPAPI-encrypted - safe on this machine."
Write-Host ""
Write-Host "Setup complete. Run register-poll-task.ps1 next (as Administrator)."
pause
