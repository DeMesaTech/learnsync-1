<#
.SYNOPSIS  Restore a backup into a SEPARATE database and upload folder, then verify it.
.DESCRIPTION
  Never touches the live database or upload root, and refuses to:
    - use the live database name, or a database name that already exists,
    - use the live upload root (or a folder inside it), or a folder that already has content.
  After restoring it ends every login session and emailed link in the copy, then compares counts,
  file checksums and the grade/result/revision history with manifest.json.
  To use the copy, point a second API at it (DATABASE_URL / UPLOAD_ROOT / another port); see docs/OPERATIONS.md.
.EXAMPLE   pwsh scripts/restore.ps1 -Backup var\backups\learnsync-20261006-140000 -TargetDb learnsync_restore_check -TargetUploads var\restore-check\uploads
#>
param([Parameter(Mandatory)][string]$Backup, [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9_]{2,40}$')][string]$TargetDb, [Parameter(Mandatory)][string]$TargetUploads)
. (Join-Path $PSScriptRoot 'common.ps1')

$env = Read-DotEnv
$live = Split-DatabaseUrl $env['DATABASE_URL']
$liveUploads = Resolve-RealPath $(if ($env['UPLOAD_ROOT']) { $env['UPLOAD_ROOT'] } else { Join-Path $Root 'var/uploads' })
$backupDir = [IO.Path]::GetFullPath($Backup)
$target = Resolve-RealPath -RejectLinks $(if ([IO.Path]::IsPathRooted($TargetUploads)) { $TargetUploads } else { Join-Path $Root $TargetUploads })
foreach ($need in 'database.dump', 'manifest.json', 'uploads') { if (-not (Test-Path (Join-Path $backupDir $need))) { throw "Not a complete backup: $need is missing." } }

if ($TargetDb -eq $live.Db) { throw "Refusing: $TargetDb is the live database." }
# Real, long-form paths (8.3 names expanded, links rejected): case-insensitive overlap test in both directions.
if (Test-Overlap $target $liveUploads) { throw "Refusing: the target upload folder overlaps the live upload root." }
Assert-NotProtected $target
if ((Test-Path $target) -and (Get-ChildItem $target -Force | Select-Object -First 1)) { throw "Refusing: $target is not empty." }
$container = Get-PostgresContainer
$exists = docker exec $container psql -U $live.User -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$TargetDb'"
if ($exists -match '1') { throw "Refusing: database $TargetDb already exists." }

Write-Host "1/5 Creating database $TargetDb..."
docker exec $container createdb -U $live.User $TargetDb
if ($LASTEXITCODE) { throw "createdb failed." }
Write-Host "2/5 Restoring the dump..."
docker cp (Join-Path $backupDir 'database.dump') "${container}:/tmp/restore.dump" | Out-Null
docker exec $container pg_restore -U $live.User -d $TargetDb --no-owner /tmp/restore.dump
$restoreExit = $LASTEXITCODE
docker exec $container rm -f /tmp/restore.dump | Out-Null
if ($restoreExit) { throw "pg_restore reported errors (exit $restoreExit); $TargetDb was left in place for inspection." }
Write-Host "3/5 Copying uploads to $target..."
New-Item -ItemType Directory -Force $target | Out-Null
$target = Resolve-RealPath -RejectLinks $target                 # re-check immediately before writing
if (Test-Overlap $target $liveUploads) { throw "Refusing: the target resolves into the live upload root." }
Assert-NotProtected $target
robocopy (Join-Path $backupDir 'uploads') $target /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying uploads failed (robocopy $LASTEXITCODE)." }
$url = "postgresql+psycopg://$($live.User):$($live.Password)@$($live.Host):$($live.Port)/$TargetDb"
Write-Host "4/5 Ending restored sessions and emailed links..."
Invoke-Cli revoke-restored --database-url $url
Write-Host "5/5 Verifying against the manifest..."
Invoke-Cli verify-restore --manifest (Join-Path $backupDir 'manifest.json') --uploads $target --database-url $url
Write-Host "Restored copy ready: database $TargetDb, uploads $target"
