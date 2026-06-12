# register-task.ps1 - Register the JAG Ollama Batch as a Windows Task Scheduler job.
#
# Run once as Administrator:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\register-task.ps1
#
# The task runs daily at 02:00 using the current user's credentials.
# Ollama must already be running on the workstation before 02:00 (it auto-starts
# if you set it to run on login via the Ollama system tray option).

$TaskName    = "JAG-Ollama-Batch"
$Description = "JAG Holdings - nightly bank statement AI processing via Ollama"

# Resolve paths relative to this script's location
$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunScript    = Join-Path $ScriptDir "run-batch.ps1"
$CompiledBatch = Join-Path $ScriptDir "dist\index.js"

if (-not (Test-Path $RunScript)) {
  Write-Error "run-batch.ps1 not found at $RunScript."
  exit 1
}
if (-not (Test-Path $CompiledBatch)) {
  Write-Error "Compiled batch not found at $CompiledBatch. Run 'npm run build:batch' from jag-api first."
  exit 1
}

# Remove existing task if present
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed existing task '$TaskName'"
}

# Trigger: daily at 02:00
$Trigger = New-ScheduledTaskTrigger -Daily -At "02:00"

# Action: powershell.exe runs run-batch.ps1 (which opens SSH tunnel then runs node)
$PwshExe = (Get-Command powershell.exe).Source
$Action = New-ScheduledTaskAction `
  -Execute $PwshExe `
  -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$RunScript`"" `
  -WorkingDirectory $ScriptDir

# Settings: run whether logged on or not; wake to run; 30-min timeout
$Settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -StartWhenAvailable `
  -WakeToRun `
  -RunOnlyIfNetworkAvailable

# Register under the current user (Ollama runs in user session)
Register-ScheduledTask `
  -TaskName    $TaskName `
  -Description $Description `
  -Trigger     $Trigger `
  -Action      $Action `
  -Settings    $Settings `
  -RunLevel    Limited `
  -Force | Out-Null

Write-Host ""
Write-Host "Task '$TaskName' registered successfully."
Write-Host "  Schedule : Daily at 02:00"
Write-Host "  Launcher : run-batch.ps1 (opens SSH tunnel, runs batch, closes tunnel)"
Write-Host "  WorkDir  : $ScriptDir"
Write-Host ""
Write-Host "To test immediately:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "To check last run result:"
Write-Host "  (Get-ScheduledTaskInfo -TaskName '$TaskName').LastTaskResult"
Write-Host "  0 = success"
Write-Host ""
Write-Host "Logs written to: $ScriptDir\run-batch.log"
