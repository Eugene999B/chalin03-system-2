param(
  [switch]$ConfirmLocalTestDatabase,
  [string]$DatabaseName = "chalin03_full_test",
  [string]$DatabaseHost = "localhost",
  [string]$DatabaseUser = "",
  [string]$DatabasePassword = ""
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
  throw "Refusing database '$DatabaseName'. Cleanup is allowed only for names ending in _test."
}
if (-not $ConfirmLocalTestDatabase) {
  throw "Explicit -ConfirmLocalTestDatabase is required."
}

$databaseArgs = @(
  "scripts/dropLocalTestDatabase.js",
  "--host", $DatabaseHost,
  "--database", $DatabaseName,
  "--confirm"
)

if ($DatabaseUser) {
  $databaseArgs += @("--user", $DatabaseUser)
}
if ($DatabasePassword) {
  $databaseArgs += @("--password", $DatabasePassword)
}

Push-Location (Join-Path $root "backend")
try {
  Invoke-CheckedCommand "cleanup guarded _test database" {
    node @databaseArgs
  }
} finally {
  Pop-Location
}
Write-Host "PASS - cleaned local test database $DatabaseName on $DatabaseHost."
