# register-task.ps1
# Registers the statement watcher as a Windows Task Scheduler task.
# Run once as Administrator.  Repeats every 30 minutes.
#
# KC_PASSWORD is baked into the task via a wrapper script so it never touches
# the filesystem in plaintext — it lives only in the Task Scheduler credential store.

param(
  [string]$Password = ""
)

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeExe    = (Get-Command node -ErrorAction Stop).Source
$WrapperPs1 = Join-Path $ScriptDir "run-watcher.ps1"
$LogFile    = Join-Path $ScriptDir "watcher.log"

if (-not $Password) {
  $secPw   = Read-Host "Enter KC_PASSWORD for Robert's Keycloak account" -AsSecureString
  $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
               [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPw))
}

# Write a tiny wrapper that sets the env var then calls node — this is what the
# task actually executes. Overwrites on re-register.
$wrapper = @"
`$env:KC_PASSWORD = '$($Password -replace "'","''")'
Set-Location "$ScriptDir"
& "$NodeExe" "$ScriptDir\dist\index.js" >> "$LogFile" 2>&1
"@
Set-Content -Path $WrapperPs1 -Value $wrapper -Encoding utf8

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NonInteractive -WindowStyle Hidden -File `"$WrapperPs1`"" `
  -WorkingDirectory $ScriptDir

# Trigger: every 30 minutes, indefinitely
$trigger  = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 30) -Once -At (Get-Date)
$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName   "JAG Statement Watcher" `
  -Action     $action `
  -Trigger    $trigger `
  -Settings   $settings `
  -RunLevel   Highest `
  -Force

Write-Host "Task registered. Runs every 30 minutes." -ForegroundColor Green
Write-Host "To run immediately: Start-ScheduledTask 'JAG Statement Watcher'"
Write-Host "Log: $LogFile"
