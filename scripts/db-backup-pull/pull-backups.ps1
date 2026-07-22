# JAG Holdings - pull latest DB dumps + MinIO bucket mirrors from the Oracle VM
# down to this machine.
#
# The VM's own nightly backup scripts write everything under
# /opt/jag/backups/<today>/:
#   - backup-databases.sh      (02:00 UTC) -- 8 DB dumps, also uploaded to MinIO
#   - backup-minio-buckets.sh  (02:15 UTC) -- mirrors of the 5 file buckets
#   - backup-secrets.sh        (02:30 UTC) -- .env files + Keycloak realm
#                                              export, bundled as secrets.tar.gz
# All of this lives on the same Oracle instance, so a total instance loss
# takes it all out together. This script gives a third copy, off-instance
# entirely, on the local workstation. Run daily via Windows Task Scheduler
# after all three VM backups have had time to complete.
#
# secrets.tar.gz is left as a compressed tar, not auto-extracted -- it holds
# every credential the platform runs on, so it should not sit around as
# loose plaintext .env files in this pull directory. Extract manually only
# when actually needed for a restore.
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

    # MinIO bucket mirrors (jag-photos, jag-documents, etc.) live in a
    # minio-buckets/ subdir with many small files -- tar on the remote side
    # first rather than scp -r, which has silently stalled on directories
    # with hundreds of files in this project before (see CLAUDE.md deploy
    # notes on scp -r reliability).
    $remoteTar = "/tmp/minio-buckets-$dateDir.tar.gz"
    $checkCmd = "test -d '$remotePath/minio-buckets' && echo yes || echo no"
    $hasMinio = (& ssh -i $SshKey -o ConnectTimeout=10 -o BatchMode=yes $VmHost $checkCmd).Trim()
    if ($hasMinio -eq "yes") {
        $tarCmd = "tar -czf '$remoteTar' -C '$remotePath' minio-buckets"
        & ssh -i $SshKey -o ConnectTimeout=10 -o BatchMode=yes $VmHost $tarCmd
        if ($LASTEXITCODE -eq 0) {
            $localTar = Join-Path $localPath "minio-buckets.tar.gz"
            & scp -i $SshKey -o ConnectTimeout=10 -o BatchMode=yes -q "${VmHost}:${remoteTar}" $localTar
            if ($LASTEXITCODE -eq 0) {
                # cd into the target dir and use relative names only -- tar
                # (the git-bash /usr/bin/tar that's first on PATH here)
                # misparses any "C:\..." argument, even under -C, as a remote
                # host:path tape spec. Even --force-local didn't fully avoid
                # it for -C, so side-step colons entirely instead.
                Push-Location $localPath
                & tar --force-local -xzf "minio-buckets.tar.gz"
                Pop-Location
                Remove-Item $localTar -Force -ErrorAction SilentlyContinue
                Log "Pulled minio-buckets mirror for $dateDir"
            } else {
                Log "WARNING: scp of minio-buckets tar failed for $dateDir"
            }
            & ssh -i $SshKey -o ConnectTimeout=10 -o BatchMode=yes $VmHost "rm -f '$remoteTar'"
        } else {
            Log "WARNING: remote tar of minio-buckets failed for $dateDir"
        }
    }

    # Secrets bundle (.env files + Keycloak realm export) -- single small
    # file already, plain scp is fine, no tar-then-scp needed.
    $checkSecretsCmd = "test -f '$remotePath/secrets.tar.gz' && echo yes || echo no"
    $hasSecrets = (& ssh -i $SshKey -o ConnectTimeout=10 -o BatchMode=yes $VmHost $checkSecretsCmd).Trim()
    if ($hasSecrets -eq "yes") {
        & scp -i $SshKey -o ConnectTimeout=10 -o BatchMode=yes -q "${VmHost}:${remotePath}/secrets.tar.gz" "$localPath\"
        if ($LASTEXITCODE -eq 0) {
            Log "Pulled secrets.tar.gz for $dateDir"
        } else {
            Log "WARNING: scp of secrets.tar.gz failed for $dateDir"
        }
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
