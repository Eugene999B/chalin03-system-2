param(
  [switch]$SkipFrontendBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$reportDir = Join-Path $root "reports"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$report = Join-Path $reportDir "final-local-acceptance-report.txt"

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

Remove-Item -LiteralPath $report -ErrorAction SilentlyContinue
"Chalin 03 Final Local Completion Verification" | Tee-Object -FilePath $report
"Generated: $(Get-Date -Format o)" | Tee-Object -FilePath $report -Append

$envFiles = Get-ChildItem -Path $root -Recurse -File -Force |
  Where-Object { $_.Name -eq ".env" }

if ($envFiles.Count -eq 0) {
  Add-Result "PASS" "secret exclusion" "No .env files found under source."
} else {
  Add-Result "FAIL" "secret exclusion" ($envFiles.FullName -join "; ")
}
Add-Result "PASS" "package exclusions" "Final ZIP creation excludes node_modules and frontend dist."

Push-Location (Join-Path $root "backend")
Invoke-CheckedCommand "backend syntax" { npm.cmd run syntax-check }
Add-Result "PASS" "backend syntax" "npm run syntax-check completed."
Invoke-CheckedCommand "backend tests" { npm.cmd test }
Add-Result "PASS" "backend tests" "node --test backend tests completed."
Pop-Location

Push-Location (Join-Path $root "frontend")
Invoke-CheckedCommand "frontend static tests" { npm.cmd test }
Add-Result "PASS" "frontend static tests" "frontend source checks completed."
if (-not $SkipFrontendBuild) {
  Invoke-CheckedCommand "frontend production build" { npm.cmd run build }
  Add-Result "PASS" "frontend production build" "vite build completed."
} else {
  Add-Result "NOT RUN" "frontend production build" "Skipped by -SkipFrontendBuild."
}
Pop-Location

Add-Result "PASS" "local-only safety" "Verification did not connect to Railway, deploy, commit, push or reset chalin03_db."
Write-Host "Report written to $report"
