<#
.SYNOPSIS  One consistent backup: database dump + private uploads + manifest.
.DESCRIPTION
  Writes <Out>/learnsync-<timestamp>/ containing database.dump (pg_dump custom format), uploads/ and
  manifest.json (schema revision, row counts, SHA-256 of every stored file, history fingerprints).
  - Refuses to run while the API is up, because files and database must not change mid-backup
    (use -AllowLive only to rehearse on development data).
  - Fails, and writes nothing usable, if a file the database refers to is missing or altered.
  - Never reads or copies .env or any provider key. Keep the output folder private.
  - Never modifies the live database or upload root.
.EXAMPLE   pwsh scripts/backup.ps1 -Out D:\learnsync-backups
#>
param([string]$Out = 'var/backups', [switch]$AllowLive, [int]$ApiPort = 8001)
. (Join-Path $PSScriptRoot 'common.ps1')

$env = Read-DotEnv
$db = Split-DatabaseUrl $env['DATABASE_URL']
$uploads = if ($env['UPLOAD_ROOT']) { $env['UPLOAD_ROOT'] } else { Join-Path $Root 'var/uploads' }
if (-not (Test-Path $uploads)) { throw "Upload root not found: $uploads" }
$writers = @(Get-V2Writers)
if ($writers.Count -gt 0 -and -not $AllowLive) { throw "Stop every v2 writer first (an API on ANY port or a maintenance command); still running: " + (($writers | ForEach-Object { "PID $($_.ProcessId)" }) -join ', ') + ". Use -AllowLive only for a development rehearsal." }
if ((Test-ApiRunning $ApiPort) -and -not $AllowLive) { throw "The API is running on port $ApiPort. Stop it first so no upload or grade changes during the backup (or pass -AllowLive for a development rehearsal)." }

$outRoot = if ([IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $Root $Out }
Assert-NotProtected (Resolve-RealPath $outRoot)
$dir = Join-Path $outRoot ("learnsync-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path $dir) { throw "Refusing to reuse $dir" }
New-Item -ItemType Directory -Path $dir | Out-Null
$container = Get-PostgresContainer

try {
    Write-Host "1/4 Checking every referenced file and describing the data..."
    Invoke-Cli backup-manifest --uploads $uploads --out (Join-Path $dir 'manifest.json')
    Write-Host "2/4 Dumping the database ($($db.Db))..."
    docker exec $container pg_dump -U $db.User -Fc -f /tmp/learnsync.dump $db.Db
    if ($LASTEXITCODE) { throw "pg_dump failed." }
    docker cp "${container}:/tmp/learnsync.dump" (Join-Path $dir 'database.dump') | Out-Null
    docker exec $container rm -f /tmp/learnsync.dump | Out-Null
    Write-Host "3/4 Copying uploads..."
    robocopy $uploads (Join-Path $dir 'uploads') /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copying uploads failed (robocopy $LASTEXITCODE)." }
    Write-Host "4/4 Checking nothing changed while the backup ran..."
    Invoke-Cli verify-restore --manifest (Join-Path $dir 'manifest.json') --uploads $uploads --database-url $env['DATABASE_URL']
    Write-Host "Backup complete: $dir"
}
catch {
    Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue   # never leave a half backup that looks usable
    throw
}
