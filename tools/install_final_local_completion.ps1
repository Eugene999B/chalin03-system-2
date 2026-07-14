param(
  [switch]$SkipNpmInstall
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

Write-Host "Chalin 03 final local completion installer"
Write-Host "Root: $root"

if (-not $SkipNpmInstall) {
  Push-Location (Join-Path $root "backend")
  if (Test-Path -LiteralPath "package-lock.json") {
    Invoke-CheckedCommand "backend npm ci" { npm.cmd ci }
  } else {
    Invoke-CheckedCommand "backend npm install" { npm.cmd install }
  }
  Pop-Location

  Push-Location (Join-Path $root "frontend")
  if (Test-Path -LiteralPath "package-lock.json") {
    Invoke-CheckedCommand "frontend npm ci" { npm.cmd ci }
  } else {
    Invoke-CheckedCommand "frontend npm install" { npm.cmd install }
  }
  Pop-Location
}

Write-Host "PASS - dependencies installed for local final completion."
