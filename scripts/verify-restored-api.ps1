<#
.SYNOPSIS  Start a SECOND API on a restored copy and check it through real authenticated requests.
.DESCRIPTION
  Uses port 8003 and a throwaway origin, never the live API. Checks: health, sign-in, published content,
  a file download, published grade history, a grade export, and that a session cookie from before the
  backup is not honoured. Stops the API again when done.
.EXAMPLE   pwsh scripts/verify-restored-api.ps1 -Database learnsync_restore_check -Uploads var\restore-check\uploads
#>
param([Parameter(Mandatory)][string]$Database, [Parameter(Mandatory)][string]$Uploads, [Parameter(Mandatory)][string]$OfferingId, [string]$Faculty = 'faculty1@example.com', [string]$Password = 'LearnSync-demo-2026')
. (Join-Path $PSScriptRoot 'common.ps1')

$e = Read-DotEnv
$l = Split-DatabaseUrl $e['DATABASE_URL']
if ($Database -eq $l.Db) { throw "Refusing: that is the live database." }
$saved = @{ DATABASE_URL = [Environment]::GetEnvironmentVariable('DATABASE_URL'); UPLOAD_ROOT = [Environment]::GetEnvironmentVariable('UPLOAD_ROOT'); APP_ORIGIN = [Environment]::GetEnvironmentVariable('APP_ORIGIN') }
$env:DATABASE_URL = "postgresql+psycopg://$($l.User):$($l.Password)@$($l.Host):$($l.Port)/$Database"
$env:UPLOAD_ROOT = (Resolve-Path $Uploads).Path
$env:APP_ORIGIN = 'http://127.0.0.1:5175'
$api = $null
try {
    $api = Start-Process -FilePath $Python -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8003' `
        -WorkingDirectory (Join-Path $Root 'backend') -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $Root 'var/restore-api.log') -RedirectStandardError (Join-Path $Root 'var/restore-api.err')
    foreach ($n in 1..20) { if (Test-ApiRunning 8003) { break }; Start-Sleep -Milliseconds 500 }
    $check = Join-Path $PSScriptRoot 'verify_restored_api.py'
    & $Python $check --offering $OfferingId --faculty $Faculty --password $Password
    if ($LASTEXITCODE -ne 0) { throw "The restored copy failed verification." }
}
finally {
    if ($api) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
    foreach ($n in $saved.Keys) { if ($null -eq $saved[$n]) { Remove-Item "Env:\$n" -ErrorAction SilentlyContinue } else { Set-Item "Env:\$n" $saved[$n] } }
}
