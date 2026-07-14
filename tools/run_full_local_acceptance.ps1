param(
  [switch]$ConfirmLocalTestDatabase,
  [string]$DatabaseName = "chalin03_full_test",
  [string]$DatabaseHost = "localhost",
  [string]$DatabaseUser = "",
  [string]$DatabasePassword = "",
  [switch]$SkipDatabase,
  [switch]$SkipFrontendBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$reportDir = Join-Path $root "reports"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$report = Join-Path $reportDir "full-local-acceptance-report.txt"

function Add-Result($status, $name, $detail) {
  "$status - $name - $detail" | Tee-Object -FilePath $report -Append
}

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

function Assert-LocalTestDatabase {
  if ($DatabaseHost -notin @("localhost", "127.0.0.1", "::1")) {
    throw "Refusing database host '$DatabaseHost'. Use localhost, 127.0.0.1 or ::1 only."
  }
  if ($DatabaseHost -match "railway" -or $DatabaseName -match "railway") {
    throw "Refusing Railway-like host or database name."
  }
  if ($DatabaseName -notmatch "_test$") {
    throw "Refusing database '$DatabaseName'. Automated destructive tests require a name ending in _test."
  }
  if (-not $ConfirmLocalTestDatabase) {
    throw "Explicit -ConfirmLocalTestDatabase is required before creating or cleaning the _test database."
  }
}

Remove-Item -LiteralPath $report -ErrorAction SilentlyContinue
"Chalin 03 Full Local Acceptance" | Tee-Object -FilePath $report
"Generated: $(Get-Date -Format o)" | Tee-Object -FilePath $report -Append

Add-Result "PASS" "safety precheck" "No Railway, commit, push, deploy or chalin03_db reset commands are run by this script."

& (Join-Path $PSScriptRoot "install_final_local_completion.ps1")
Add-Result "PASS" "dependency install" "npm dependency installation completed for backend and frontend."

& (Join-Path $PSScriptRoot "verify_final_local_completion.ps1") -SkipFrontendBuild:$SkipFrontendBuild
Add-Result "PASS" "static acceptance" "syntax checks, unit tests and frontend checks completed."

if ($SkipDatabase) {
  Add-Result "NOT RUN" "guarded _test database" "Skipped by -SkipDatabase."
} else {
  Assert-LocalTestDatabase

  $databaseArgs = @(
    "scripts/runLocalDatabaseAcceptance.js",
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
    Invoke-CheckedCommand "guarded local database/API acceptance" {
      node @databaseArgs
    }
  } finally {
    Pop-Location
  }
  Add-Result "PASS" "guarded _test database" "Created, migrated, verified, seeded and API-tested $DatabaseName on $DatabaseHost with Node mysql2."
}

Write-Host "Full local acceptance report written to $report"
