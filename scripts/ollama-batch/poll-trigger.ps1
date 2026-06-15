# poll-trigger.ps1 — JAG batch trigger poller
#
# Runs every 2 minutes via Windows Task Scheduler.
# Checks the JAG API for a pending batch trigger set from the platform UI.
# When triggered, runs run-batch.ps1 immediately and clears the flag.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile   = Join-Path $ScriptDir ".env.ollama-batch"
$LogFile   = Join-Path $ScriptDir "poll-trigger.log"

function Log($msg) {
  $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  "$ts  $msg" | Tee-Object -FilePath $LogFile -Append
}

# ── Load env file ─────────────────────────────────────────────────────────────
if (-not (Test-Path $EnvFile)) {
  Log "ERROR: $EnvFile not found."
  exit 1
}

foreach ($line in Get-Content $EnvFile) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $parts = $line -split '=', 2
  $key   = $parts[0].Trim()
  $val   = $parts[1].Trim()
  Set-Item "Env:\$key" $val
}

$ApiBase      = $env:JAG_API_URL ?? "https://api.jagcorporate.com/api/v1"
$KcUrl        = "https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token"
$KcClientId   = "jag-api"
$KcClientSecret = $env:KC_CLIENT_SECRET ?? "FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU"
$KcUsername   = $env:KC_USERNAME
$KcPassword   = $env:KC_PASSWORD

if (-not $KcUsername -or -not $KcPassword) {
  Log "ERROR: KC_USERNAME and KC_PASSWORD must be set in .env.ollama-batch"
  exit 1
}

# ── Get Keycloak token ────────────────────────────────────────────────────────
try {
  $tokenResp = Invoke-RestMethod -Method Post -Uri $KcUrl -ContentType "application/x-www-form-urlencoded" -Body @{
    grant_type    = "password"
    client_id     = $KcClientId
    client_secret = $KcClientSecret
    username      = $KcUsername
    password      = $KcPassword
  } -ErrorAction Stop
  $Token = $tokenResp.access_token
} catch {
  Log "ERROR: Failed to get Keycloak token: $_"
  exit 1
}

$Headers = @{ Authorization = "Bearer $Token" }

# ── Check trigger status ──────────────────────────────────────────────────────
try {
  $status = Invoke-RestMethod -Method Get -Uri "$ApiBase/finance/document-jobs/trigger/status" -Headers $Headers -ErrorAction Stop
} catch {
  Log "ERROR: Failed to check trigger status: $_"
  exit 1
}

if (-not $status.data.pending) {
  exit 0   # No trigger — nothing to do
}

Log "Trigger detected (set at $($status.data.triggered_at)). Running batch..."

# ── Run the batch ─────────────────────────────────────────────────────────────
$BatchScript = Join-Path $ScriptDir "run-batch.ps1"
try {
  & powershell -ExecutionPolicy Bypass -File $BatchScript
  $exitCode = $LASTEXITCODE
  Log "Batch finished with exit code $exitCode."
} catch {
  Log "ERROR running batch: $_"
  $exitCode = 1
}

# ── Clear the trigger ─────────────────────────────────────────────────────────
try {
  Invoke-RestMethod -Method Post -Uri "$ApiBase/finance/document-jobs/trigger/clear" -Headers $Headers -ErrorAction Stop | Out-Null
  Log "Trigger cleared."
} catch {
  Log "WARNING: Failed to clear trigger: $_"
}

exit $exitCode
