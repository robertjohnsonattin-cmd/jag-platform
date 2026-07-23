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
# entirely, on the local workstation -- then mirrors that local copy out to
# OneDrive (cloud-synced) and the E: drive (separate physical disk), so a
# single laptop-disk failure doesn't take out the off-instance copy too.
# Run daily via Windows Task Scheduler after all three VM backups have had
# time to complete.
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

# Mirror targets -- copied to after the local pull completes. Each is
# checked for availability at run time (OneDrive may not be signed in yet
# on a fresh boot; E: may be unplugged) so a missing one just logs a
# warning instead of failing the whole run -- the local pull is the copy
# that matters most and must not be blocked by a missing mirror.
$Mirrors = @(
    @{ Name = "OneDrive"; Root = "$env:USERPROFILE\OneDrive\JAG-DB-Backups"; RequireParent = "$env:USERPROFILE\OneDrive" },
    @{ Name = "E-Drive";  Root = "E:\JAG-DB-Backups";                        RequireParent = "E:\" }
)

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
                # cd into the target dir and use a relative filename only --
                # both git-bash tar and Windows' native tar.exe misparse any
                # "C:\..." argument as a remote host:path tape spec, so side-
                # step colons entirely instead of relying on a flag. (Do NOT
                # add --force-local back here: git-bash tar accepts it but
                # Windows' native tar.exe -- which Task Scheduler's plain
                # `powershell` picks up ahead of git-bash's on PATH -- errors
                # out on it entirely, since the relative filename never
                # needed the flag in the first place.)
                Push-Location $localPath
                & tar -xzf "minio-buckets.tar.gz"
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

# Back up the local SSH private keys used to reach the VM (jag_oracle,
# jag_oracle2). These live ONLY on this workstation -- they authenticate
# every deploy, every admin SSH session, everything -- and were never part
# of the VM-side secrets.tar.gz (that bundle only holds server-side .env
# files + the Keycloak realm export). Kept in a non-date-named subfolder so
# the retention prune below (which only matches yyyy-MM-dd dirs) never
# touches it -- keys don't rotate daily, so there's nothing to prune, just
# overwrite in place each run. Rides along on the existing OneDrive/E:
# mirror pass below since it lives under $LocalRoot.
$SshKeyBackupDir = Join-Path $LocalRoot "ssh-keys"
$SshKeyFiles = Get-ChildItem -Path "$env:USERPROFILE\.ssh" -Filter "jag_oracle*" -ErrorAction SilentlyContinue
if ($SshKeyFiles) {
    if (-not (Test-Path $SshKeyBackupDir)) {
        New-Item -ItemType Directory -Path $SshKeyBackupDir -Force | Out-Null
    }
    Copy-Item -Path $SshKeyFiles.FullName -Destination $SshKeyBackupDir -Force
    Log "Backed up $($SshKeyFiles.Count) SSH key file(s) (jag_oracle*) to $SshKeyBackupDir"
} else {
    Log "WARNING: no jag_oracle* SSH key files found in $env:USERPROFILE\.ssh - nothing to back up"
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


# Mirror the pruned local tree out to OneDrive + E: drive. /MIR keeps each
# mirror an exact copy of $LocalRoot, including deletions from the
# retention prune above, so old backups don't pile up forever on the
# mirrors either. robocopy exit codes 0-7 are all "success" (8+ is a real
# failure) -- see https://learn.microsoft.com/windows-server/administration/windows-commands/robocopy
# exit code table.
foreach ($mirror in $Mirrors) {
    if (-not (Test-Path $mirror.RequireParent)) {
        Log "WARNING: mirror target '$($mirror.Name)' unavailable (missing $($mirror.RequireParent)) - skipped this run"
        continue
    }

    if (-not (Test-Path $mirror.Root)) {
        New-Item -ItemType Directory -Path $mirror.Root -Force | Out-Null
    }

    Log "Mirroring $LocalRoot to $($mirror.Name) ($($mirror.Root))"
    & robocopy $LocalRoot $mirror.Root /MIR /R:2 /W:5 /NFL /NDL /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
        Log "WARNING: robocopy to $($mirror.Name) failed with exit code $LASTEXITCODE"
    } else {
        Log "Mirrored to $($mirror.Name) OK (robocopy exit $LASTEXITCODE)"
    }
}

Log "=== pull-backups done ==="
