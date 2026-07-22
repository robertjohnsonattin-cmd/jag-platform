# JAG Holdings - pull latest DB dumps from the Oracle VM down to this machine.
#
# The VM's own nightly backup-databases.sh (02:00 UTC) writes dumps to
# /opt/jag/backups/<today>/ and uploads a copy to the jag-backups MinIO bucket,
# but both live on the same Oracle instance, so a total instance loss takes both
# out together. This script gives a third copy, off-instance entirely, on the
# local workstation. Run daily via Windows Task Scheduler after the VM backup
# has had time to complete.
#
# Manual run:  powershell -File pull-backups.ps1

$ErrorActionPreference = "Stop"

$SshKey     = "$env:USERPROFILE\.ssh\jag_oracle2"
$VmHost     = "ubuntu@150.136.151.64"
$LocalRoot  = "$env:USERPROFILE\JAG-DB-Backups"
$RetainDays = 90
$LogFile    = "$LocalRoot\pull-backups.log"

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Output $line
    Add-Content -Path $LogFile -Value $line
}

if (-not (Test-Path $LocalRoot)) {
    New-Item -ItemType Directory -Path $LocalRoot -Force | Out-Null
}

Log "=== pull-backups start ==="

# Ask the VM directly which date-named backup dirs actually exist (VM runs on UTC,
# this workstation runs on local time -- don't guess date strings, query reality).
$listCmd = "ls -1 /opt/jag/backups/ 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort -r | head -3"
$remoteDirs = & ssh -i $SshKey -o ConnectTimeout=10 -o BatchMode=yes $VmHost $listCmd

if (-not $remoteDirs) {
    Log "WARNING: could not list any date-named backup dirs on the VM - VM backup may not have run"
}

$pulled = 0
foreach ($dateDir in $remoteDirs) {
    $dateDir = $dateDir.Trim()
    if (-not $dateDir) { continue }

    $remotePath = "/opt/jag/backups/$dateDir"
    $localPath = Join-Path $LocalRoot $dateDir

    if (-not (Test-Path $localPath)) {
        New-Item -ItemType Directory -Path $localPath -Force | Out-Null
    }

    Log "Pulling $remotePath to $localPath"
    $remoteSpec = "${VmHost}:${remotePath}/*.dump"
    & scp -i $SshKey -o ConnectTimeout=10 -o BatchMode=yes -q $remoteSpec "$localPath\"
    if ($LASTEXITCODE -ne 0) {
        Log "WARNING: scp exited $LASTEXITCODE for $dateDir"
    } else {
        $pulled++
    }
}

if ($pulled -eq 0) {
    Log "WARNING: zero backup directories were successfully pulled this run"
}

# Prune local copies older than RetainDays
$cutoff = (Get-Date).AddDays(-$RetainDays)
Get-ChildItem -Path $LocalRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $dirDate = [datetime]::ParseExact($_.Name, "yyyy-MM-dd", $null)
        if ($dirDate -lt $cutoff) {
            Log "Pruning old local backup dir: $($_.Name)"
            Remove-Item -Path $_.FullName -Recurse -Force
        }
    } catch {
        # not a date-named dir, skip
    }
}

Log "=== pull-backups done ==="
