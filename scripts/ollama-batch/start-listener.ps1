# start-listener.ps1
# Decrypts DPAPI credentials and launches the SSE listener.
# Called by Task Scheduler on login — do not run directly.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CredsFile = Join-Path $ScriptDir ".jag-kc-credentials"

if (-not (Test-Path $CredsFile)) {
  Write-Error "Credentials not found. Run setup-credentials.ps1 first."
  exit 1
}

$creds = @{}
foreach ($line in Get-Content $CredsFile) {
  if ($line -notmatch '=') { continue }
  $parts = $line -split '=', 2
  $creds[$parts[0].Trim()] = $parts[1].Trim()
}

try {
  $SecurePass = $creds['ENCRYPTED_PASSWORD'] | ConvertTo-SecureString
  $PlainPass  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePass)
  )
} catch {
  Write-Error "Failed to decrypt credentials. Re-run setup-credentials.ps1."
  exit 1
}

$env:KC_USERNAME = $creds['USERNAME']
$env:KC_PASSWORD = $PlainPass

node "$ScriptDir\sse-listener.js"
