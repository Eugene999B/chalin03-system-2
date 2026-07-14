param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $BackupPath)) {
  throw "Backup file not found: $BackupPath"
}

$json = Get-Content -Raw -LiteralPath $BackupPath | ConvertFrom-Json

if ($json.backup_type -ne "full_system_backup") {
  throw "Invalid backup_type. Expected full_system_backup."
}

if (-not $json.tables) {
  throw "Backup does not contain a tables object."
}

$tableNames = @($json.tables.PSObject.Properties.Name)
if ($tableNames.Count -eq 0) {
  throw "Backup contains no tables."
}

if ($json.checksum_sha256) {
  Write-Host "PASS - backup declares checksum $($json.checksum_sha256)."
} else {
  Write-Host "NOT RUN - checksum comparison - backup has no checksum_sha256 field."
}

Write-Host "PASS - backup JSON structure is valid."
Write-Host "Tables: $($tableNames.Count)"
