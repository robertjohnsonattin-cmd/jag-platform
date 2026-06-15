# register-poll-task.ps1
# Run ONCE as Administrator to register the 2-minute polling task in Task Scheduler.
# Usage: Right-click → Run as Administrator

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$PollScript = Join-Path $ScriptDir "poll-trigger.ps1"
$TaskName   = "JAG - Batch Trigger Poller"

Write-Host "Registering Task Scheduler task: $TaskName"
Write-Host "Script: $PollScript"
Write-Host ""

# Remove existing task if present
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$action  = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PollScript`""

# Repeat every 2 minutes, indefinitely
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 2) -Once -At (Get-Date)

$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Highest

Register-ScheduledTask `
  -TaskName  $TaskName `
  -Action    $action `
  -Trigger   $trigger `
  -Settings  $settings `
  -Principal $principal `
  -Force | Out-Null

Write-Host "Task registered. Verifying..."
$task = Get-ScheduledTask -TaskName $TaskName
Write-Host "Status: $($task.State)"
Write-Host ""
Write-Host "Done. The poller will check for platform triggers every 2 minutes."
Write-Host "Check poll-trigger.log in this folder to monitor activity."
pause
