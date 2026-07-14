param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,
  [switch]$ConfirmLocalTestDatabase,
  [string]$DatabaseName = "chalin03_full_test",
  [string]$DatabaseHost = "localhost"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE."
  }
}

if ($DatabaseHost -notin @("localhost", "127.0.0.1", "::1")) {
  throw "Refusing database host '$DatabaseHost'."
}
if ($DatabaseHost -match "railway" -or $DatabaseName -match "railway") {
  throw "Refusing Railway-like host or database name."
}
if ($DatabaseName -notmatch "_test$") {
  throw "Refusing database '$DatabaseName'. Restore tests require a name ending in _test."
}
if (-not $ConfirmLocalTestDatabase) {
  throw "Explicit -ConfirmLocalTestDatabase is required."
}

& (Join-Path $PSScriptRoot "validate_backup.ps1") -BackupPath $BackupPath

$script = Join-Path $root "backend\scripts\restoreBackupToLocalTestDb.js"
Invoke-CheckedCommand "restore backup into guarded _test database" {
  Push-Location (Join-Path $root "backend")
  try {
    node $script --backup $BackupPath --host $DatabaseHost --database $DatabaseName --confirm
  } finally {
    Pop-Location
  }
}

Write-Host "PASS - restore test completed against $DatabaseName on $DatabaseHost only."
