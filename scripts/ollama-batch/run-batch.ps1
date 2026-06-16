# run-batch.ps1 — JAG Ollama Batch launcher
#
# Opens SSH tunnels to the VM (PG + MinIO), runs the batch, then closes them.
# Called by Windows Task Scheduler instead of node directly.
# Log written to run-batch.log in this directory.

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile    = Join-Path $ScriptDir "run-batch.log"
$ScriptPath = Join-Path $ScriptDir "dist\index.js"
$SshKey     = "$env:USERPROFILE\.ssh\jag_oracle2"
$VmHost     = "ubuntu@150.136.151.64"

function Log($msg) {
  $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  $line = "$ts  $msg"
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

Log "===== JAG Ollama Batch run starting ====="

# Validate compiled script exists
if (-not (Test-Path $ScriptPath)) {
  Log "ERROR: $ScriptPath not found. Run 'npm run build:batch' from jag-api first."
  exit 1
}

# Open SSH tunnels in background:
#   localhost:5432 → VM:5432  (PostgreSQL)
#   localhost:9000 → VM:9000  (MinIO)
Log "Opening SSH tunnels..."
$TunnelArgs = @(
  "-i", $SshKey,
  "-N",                        # no remote command
  "-o", "StrictHostKeyChecking=no",
  "-o", "ExitOnForwardFailure=yes",
  "-o", "ServerAliveInterval=30",
  "-L", "15432:localhost:5432",
  "-L", "19000:localhost:9000",
  $VmHost
)
$Tunnel = Start-Process -FilePath "ssh" -ArgumentList $TunnelArgs -PassThru -WindowStyle Hidden

# Give tunnel 5 seconds to establish
Start-Sleep -Seconds 5

if ($Tunnel.HasExited) {
  Log "ERROR: SSH tunnel failed to start (exit code $($Tunnel.ExitCode)). Check SSH key and VM connectivity."
  exit 1
}
Log "SSH tunnel PID=$($Tunnel.Id) established."

# Run the batch
try {
  $NodeExe     = (Get-Command node -ErrorAction Stop).Source
  $NodeModules = (Resolve-Path (Join-Path $ScriptDir "..\..\jag-api\node_modules")).Path
  $env:NODE_PATH = $NodeModules   # inherited by child process
  Log "Running: node $ScriptPath"
  $proc = Start-Process -FilePath $NodeExe -ArgumentList "`"$ScriptPath`"" `
    -WorkingDirectory $ScriptDir -PassThru -Wait -NoNewWindow `
    -RedirectStandardOutput "$ScriptDir\batch-stdout.log" `
    -RedirectStandardError  "$ScriptDir\batch-stderr.log"
  Get-Content "$ScriptDir\batch-stdout.log" | ForEach-Object { Log "  $_" }
  $exitCode = $proc.ExitCode
  Log "Batch exited with code $exitCode."
} catch {
  Log "ERROR launching node: $_"
  $exitCode = 1
} finally {
  # Always close the tunnel
  if (-not $Tunnel.HasExited) {
    Stop-Process -Id $Tunnel.Id -Force -ErrorAction SilentlyContinue
    Log "SSH tunnel closed."
  }
}

Log "===== Run complete ====="
exit $exitCode
