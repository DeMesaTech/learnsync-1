# Shared helpers for backup.ps1 / restore.ps1 / rehearse.ps1. Dot-source this file; it changes nothing by itself.
$ErrorActionPreference = 'Stop'
$script:Root = Split-Path $PSScriptRoot
$script:Python = Join-Path $Root 'backend/.venv/Scripts/python.exe'

function Read-DotEnv {
    $values = @{}
    foreach ($line in Get-Content (Join-Path $Root '.env')) {
        if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim() }
    }
    $values
}

# postgresql+psycopg://user:pass@host:port/db  ->  parts
function Split-DatabaseUrl([string]$Url) {
    if ($Url -notmatch '^postgresql\+psycopg://([^:]+):([^@]*)@([^:/]+):(\d+)/(\w+)$') { throw "Unrecognised DATABASE_URL shape." }
    @{ User = $Matches[1]; Password = $Matches[2]; Host = $Matches[3]; Port = $Matches[4]; Db = $Matches[5] }
}

function Get-PostgresContainer {
    $id = (docker compose -f (Join-Path $Root 'compose.yaml') ps -q postgres).Trim()
    if (-not $id) { throw "The v2 Postgres container is not running (docker compose up -d postgres)." }
    $id
}

function Invoke-Cli {
    # Runs `python -m app.cli ...` from backend/. Fails the script on a non-zero exit.
    Push-Location (Join-Path $Root 'backend')
    try { & $Python -m app.cli @args; if ($LASTEXITCODE -ne 0) { throw "app.cli $($args[0]) failed (exit $LASTEXITCODE)." } }
    finally { Pop-Location }
}

function Test-ApiRunning([int]$Port = 8001) {
    try { Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; $true } catch { $false }
}

# ---- path safety (Windows): short 8.3 names and junction/symlink aliases must not hide the live upload root ----
Add-Type -Namespace Win -Name Paths -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern uint GetLongPathName(string shortPath, System.Text.StringBuilder longPath, uint size);' -ErrorAction SilentlyContinue

function Resolve-RealPath([string]$Path, [switch]$RejectLinks) {
    # Full, long-form path of what $Path really points at. Components that do not exist yet are kept as written.
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $existing = $full; $tail = @()
    while ($existing -and -not (Test-Path -LiteralPath $existing)) { $tail = @([IO.Path]::GetFileName($existing)) + $tail; $existing = Split-Path $existing -Parent }
    if (-not $existing) { throw "Cannot resolve $Path" }
    $sb = New-Object System.Text.StringBuilder 2048
    if ([Win.Paths]::GetLongPathName($existing, $sb, 2048) -gt 0) { $existing = $sb.ToString() }
    $built = [IO.Path]::GetPathRoot($existing)
    foreach ($part in ($existing.Substring($built.Length) -split '[\\/]' | Where-Object { $_ })) {
        $next = Join-Path $built $part
        $item = Get-Item -LiteralPath $next -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            if ($RejectLinks) { throw "Refusing: $next is a junction or symbolic link, so the real destination is ambiguous." }
            $target = $item.ResolveLinkTarget($true)
            $next = if ($target) { $target.FullName } else { $next }
        }
        $built = $next
    }
    (@($built.TrimEnd('\')) + $tail) -join '\'
}

function Test-Overlap([string]$A, [string]$B) {
    $ic = [StringComparison]::OrdinalIgnoreCase
    $a1 = $A.TrimEnd('\'); $b1 = $B.TrimEnd('\')
    $a1.Equals($b1, $ic) -or $a1.StartsWith($b1 + '\', $ic) -or $b1.StartsWith($a1 + '\', $ic)
}

# Any process that can write to the v2 data: an API (any port) or a maintenance command.
function Get-V2Writers {
    # Conservative on purpose: any Python running `uvicorn app.main` or `-m app.cli` counts, whichever folder it
    # was started from (the command line does not say), so an unrelated project with the same module name can
    # trigger a refusal; -AllowLive overrides it.
    Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^python' -and $_.CommandLine -match 'uvicorn app\.main|-m app\.cli' }
}

# Folders no script may ever write into: the old LearnSync v1 project (a read-only reference) next to this repo,
# plus anything listed in PROTECTED_PATHS (semicolon-separated) in .env.
function Get-ProtectedRoots {
    $roots = @((Join-Path (Split-Path $Root -Parent) 'learnsync'))
    $extra = (Read-DotEnv)['PROTECTED_PATHS']
    if ($extra) { $roots += $extra -split ';' | Where-Object { $_ } }
    $roots | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { Resolve-RealPath $_ }
}

function Assert-NotProtected([string]$Path) {
    foreach ($protected in Get-ProtectedRoots) {
        if (Test-Overlap $Path $protected) { throw "Refusing: $Path is inside or around a protected folder ($protected)." }
    }
}
