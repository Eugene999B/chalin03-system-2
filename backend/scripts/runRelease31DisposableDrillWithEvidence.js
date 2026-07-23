const fs = require("node:fs");
const path = require("node:path");

const { run } = require("./runRelease31DisposableDrill");

const SCHEMA_PATH = path.resolve(__dirname, "../../database/schema.sql");
const HISTORICAL_BASELINE_FILES = [
  path.resolve(
    __dirname,
    "../../database/migrations/20260716_release2_final_security_backup_workers_executive.sql"
  ),
  path.resolve(
    __dirname,
    "../../database/migrations/20260716_release3_group_command_configuration.sql"
  ),
  path.resolve(
    __dirname,
    "../../database/migrations/20260719_worker_hr_letters.sql"
  ),
  path.resolve(
    __dirname,
    "../../database/migrations/20260719_standalone_employment_documents_signature.sql"
  ),
  path.resolve(
    __dirname,
    "../../database/migrations/20260722_equipment_sales_installments_foundation.sql"
  ),
];

function evidencePath() {
  return path.resolve(
    process.env.RELEASE31_DRILL_EVIDENCE_PATH ||
      path.join(__dirname, "../release31-disposable-drill-evidence.json")
  );
}

function normalizeHistoricalSql(source) {
  return String(source).replaceAll(
    "PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;",
    "PREPARE stmt FROM @sql;\nEXECUTE stmt;\nDEALLOCATE PREPARE stmt;"
  );
}

function installDisposableBaselineOverlay() {
  const originalReadFileSync = fs.readFileSync;

  fs.readFileSync = function readFileSyncWithHistoricalBaseline(filePath, ...args) {
    const resolvedPath = path.resolve(String(filePath));
    const content = originalReadFileSync.call(fs, filePath, ...args);

    if (resolvedPath !== SCHEMA_PATH) return content;

    const schemaText = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
    const historicalSql = HISTORICAL_BASELINE_FILES.map((migrationPath) =>
      normalizeHistoricalSql(originalReadFileSync.call(fs, migrationPath, "utf8"))
    ).join("\n\n");

    return `${schemaText}\n\n${historicalSql}\n`;
  };

  return () => {
    fs.readFileSync = originalReadFileSync;
  };
}

async function main() {
  const restoreReadFileSync = installDisposableBaselineOverlay();

  try {
    await run();
  } catch (error) {
    const evidence = {
      status: "failed",
      generated_at: new Date().toISOString(),
      disposable_baseline_overlays: HISTORICAL_BASELINE_FILES.map((filePath) =>
        path.basename(filePath)
      ),
      error: {
        name: error?.name || "Error",
        code: error?.code || null,
        message: error?.message || "Unknown Release 3.1 drill failure.",
        errno: error?.errno ?? null,
        sql_state: error?.sqlState || null,
        sql_message: error?.sqlMessage || null,
        sql: error?.sql ? String(error.sql).slice(0, 4000) : null,
        stack: error?.stack ? String(error.stack).slice(0, 8000) : null,
      },
    };
    fs.writeFileSync(evidencePath(), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.error(JSON.stringify(evidence, null, 2));
    process.exitCode = 1;
  } finally {
    restoreReadFileSync();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  HISTORICAL_BASELINE_FILES,
  SCHEMA_PATH,
  evidencePath,
  installDisposableBaselineOverlay,
  main,
  normalizeHistoricalSql,
};
