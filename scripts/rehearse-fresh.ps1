<#
.SYNOPSIS  Fresh-installation rehearsal: empty database + empty upload folder -> migrations -> bootstrap admin ->
           API + web app on spare ports -> the complete multi-role browser flow -> tear down.
.DESCRIPTION
  Never touches the live database or upload root (it proves that by comparing the live data with a
  manifest taken before and after). Uses database learnsync_fresh, uploads var/fresh/uploads, API port 8002,
  web port 5174. The admin password is generated for this run, never printed, and never stored.
  Requires: Docker Postgres + Mailpit running (docker compose up -d), frontend dependencies installed.
.EXAMPLE   pwsh scripts/rehearse-fresh.ps1
#>
param([string]$Database = 'learnsync_fresh', [switch]$Keep)
. (Join-Path $PSScriptRoot 'common.ps1')

$e = Read-DotEnv
$live = Split-DatabaseUrl $e['DATABASE_URL']
if ($Database -eq $live.Db -or $Database -like '*test*' -or $Database -notmatch '^[a-z][a-z0-9_]{2,40}$') { throw "Refusing database name '$Database'." }
$fresh = Join-Path $Root 'var/fresh'
$uploads = Join-Path $fresh 'uploads'
Assert-NotProtected (Resolve-RealPath $uploads)
if ((Test-Path $uploads) -and (Get-ChildItem $uploads -Force | Select-Object -First 1)) { throw "Refusing: $uploads is not empty." }
$container = Get-PostgresContainer
if ((docker exec $container psql -U $live.User -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$Database'") -match '1') { throw "Refusing: database $Database already exists." }
foreach ($port in 8002, 5174) { if (Test-NetConnection 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue) { throw "Port $port is already in use." } }

New-Item -ItemType Directory -Force $uploads | Out-Null
Write-Host "0/7 Recording the live data so we can prove it is untouched..."
$before = Join-Path $fresh 'live-before.json'
Invoke-Cli backup-manifest --uploads $(if ($e["UPLOAD_ROOT"]) { $e["UPLOAD_ROOT"] } else { Join-Path $Root "var/uploads" }) --out $before

$saved = @{}; foreach ($n in 'DATABASE_URL', 'UPLOAD_ROOT', 'APP_ORIGIN', 'ADMIN_PW', 'VITE_PORT', 'VITE_API') { $saved[$n] = [Environment]::GetEnvironmentVariable($n) }
$procs = @(); $failed = $false
try {
    $env:DATABASE_URL = "postgresql+psycopg://$($live.User):$($live.Password)@$($live.Host):$($live.Port)/$Database"
    $env:UPLOAD_ROOT = $uploads
    $env:APP_ORIGIN = 'http://127.0.0.1:5174'
    $env:ADMIN_PW = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })

    Write-Host "1/7 Creating the empty database $Database..."
    docker exec $container createdb -U $live.User $Database
    if ($LASTEXITCODE) { throw "createdb failed" }
    Write-Host "2/7 Applying migrations (alembic upgrade head)..."
    Push-Location (Join-Path $Root 'backend')
    try {
        & (Join-Path $Root 'backend/.venv/Scripts/alembic.exe') upgrade head
        if ($LASTEXITCODE) { throw "alembic upgrade failed" }
        $head = (& (Join-Path $Root 'backend/.venv/Scripts/alembic.exe') heads) -replace ' \(head\)', ''
        $current = (& (Join-Path $Root 'backend/.venv/Scripts/alembic.exe') current) -replace ' \(head\)', ''
        if ($head -ne $current) { throw "Database is at '$current', not at head '$head'." }
        Write-Host "    schema is at head $head"
    } finally { Pop-Location }
    Write-Host "3/7 Bootstrapping the first administrator (before any seeding)..."
    Invoke-Cli bootstrap-admin --email fresh-admin@example.com --name 'Fresh Admin' --password-env ADMIN_PW

    Write-Host "4/7 Starting the API (8002) and the web app (5174)..."
    $procs += Start-Process -FilePath $Python -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8002' -WorkingDirectory (Join-Path $Root 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fresh 'api.log') -RedirectStandardError (Join-Path $fresh 'api.err')
    $env:VITE_PORT = '5174'; $env:VITE_API = 'http://127.0.0.1:8002'
    $procs += Start-Process -FilePath 'node' -ArgumentList 'node_modules/vite/bin/vite.js' -WorkingDirectory (Join-Path $Root 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fresh 'web.log') -RedirectStandardError (Join-Path $fresh 'web.err')
    foreach ($n in 1..40) { if ((Test-ApiRunning 8002) -and (Test-NetConnection 127.0.0.1 -Port 5174 -InformationLevel Quiet -WarningAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 500 }
    if (-not (Test-ApiRunning 8002)) { throw "The fresh API did not start; see var/fresh/api.err" }
    Write-Host "5/7 Health check passed; the fresh install has no accounts except the bootstrap admin."

    Write-Host "6/7 Running the complete browser flow..."
    $env:BASE = 'http://127.0.0.1:5174'; $env:ADMIN_EMAIL = 'fresh-admin@example.com'; $env:ADMIN_PASSWORD = $env:ADMIN_PW
    $env:SHOTS = (Join-Path $Root 'var/screens-flow')
    Push-Location (Join-Path $Root 'frontend')
    try { node e2e/flow.mjs; if ($LASTEXITCODE) { $failed = $true } } finally { Pop-Location }
}
finally {
    foreach ($p in $procs) { if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
    # restore exactly what was there; a variable that did not exist is DELETED, not set to an empty string
    foreach ($n in $saved.Keys) { if ($null -eq $saved[$n]) { Remove-Item "Env:\$n" -ErrorAction SilentlyContinue } else { Set-Item "Env:\$n" $saved[$n] } }
    foreach ($n in 'BASE', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'SHOTS') { Remove-Item "Env:\$n" -ErrorAction SilentlyContinue }
    if (-not $Keep) {
        docker exec $container dropdb -U $live.User --if-exists $Database | Out-Null
        Remove-Item -Recurse -Force $uploads -ErrorAction SilentlyContinue
    }
}
Write-Host "7/7 Proving the live installation was not touched..."
Invoke-Cli verify-restore --manifest $before --uploads $(if ($e['UPLOAD_ROOT']) { $e['UPLOAD_ROOT'] } else { Join-Path $Root 'var/uploads' }) --database-url $e['DATABASE_URL']
if ($failed) { throw "The browser flow failed. Screenshots: var/screens-flow, logs: var/fresh" }
Write-Host "Fresh-installation rehearsal PASSED."
