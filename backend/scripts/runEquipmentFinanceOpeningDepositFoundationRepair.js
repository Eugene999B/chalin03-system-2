const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const MIGRATION_LOCK = "chalin03:equipment-finance:opening-deposit-foundation-repair";
const BASE_MIGRATION_FILE = "20260729_equipment_finance_deposit_reservation.sql";
const MIGRATION_RECORD = "20260805_equipment_finance_opening_deposit_foundation_repair";
const MIGRATION_FILE = "20260805_equipment_finance_opening_deposit_foundation_repair.sql";
const VERIFIER_FILE = "20260805_equipment_finance_opening_deposit_foundation_repair_verify.sql";
const INTEGRITY_MIGRATION_RECORD = "20260803_equipment_finance_phase4_deposit_reservation_integrity";
const INTEGRITY_MIGRATION_FILE = "20260825_equipment_finance_opening_deposit_trigger_fix.sql";
const REQUIRED_TRIGGERS = Object.freeze([
  "trg_equipment_finance_payment_gate_before_insert",
  "trg_equipment_finance_reservation_gate_before_insert",
  "trg_equipment_finance_commitment_gate_before_update",
]);

function requiredEnv(primary, fallback) {
  const value = process.env[primary] || process.env[fallback];
  if (!String(value || "").trim()) {
    throw new Error(`Missing required database variable ${primary}${fallback ? ` or ${fallback}` : ""}.`);
  }
  return value;
}

function booleanValue(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

// Keep deployment repair TLS behavior identical to backend/config/db.js.
function sslConfig() {
  const dbSsl = String(process.env.DB_SSL || "").trim().toLowerCase();
  if (dbSsl === "false") return false;
  if (dbSsl !== "true") return undefined;

  const encodedCa = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  const rejectUnauthorized = booleanValue(
    process.env.DB_SSL_REJECT_UNAUTHORIZED,
    true
  );

  if (encodedCa) {
    return {
      ca: Buffer.from(encodedCa, "base64").toString("utf8"),
      rejectUnauthorized,
    };
  }

  return { rejectUnauthorized };
}

function migrationCandidates(relativePath) {
  return [
    path.join(__dirname, "../../database/migrations", relativePath),
    path.join(__dirname, "../database/migrations", relativePath),
    path.join(process.cwd(), "database/migrations", relativePath),
  ];
}

function resolveMigrationFile(relativePath, { required = true } = {}) {
  for (const candidate of migrationCandidates(relativePath)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  if (!required) return null;
  throw new Error(`Migration file not found: ${relativePath}`);
}

function stripSqlComments(value) {
  return value
    .replace(/\/\*![\s\S]*?\*\//g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\n)\s*--.*(?=\n|$)/g, "$1")
    .replace(/(^|\n)\s*#.*(?=\n|$)/g, "$1");
}

function splitSql(sqlText) {
  const text = stripSqlComments(String(sqlText || "")).replace(/\r\n/g, "\n");
  const statements = [];
  let delimiter = ";";
  let current = "";
  let quote = null;
  let escaped = false;

  const flush = () => {
    const statement = current.trim();
    if (statement) statements.push(statement);
    current = "";
  };

  const lines = text.split("\n");
  for (const line of lines) {
    const delimiterMatch = line.trim().match(/^DELIMITER\s+(.+)$/i);
    if (delimiterMatch) {
      if (current.trim()) {
        throw new Error("SQL DELIMITER appeared before the previous statement was complete.");
      }
      delimiter = delimiterMatch[1].trim();
      continue;
    }

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];

      if (quote) {
        current += char;
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === "'" || char === '"' || char === "`") {
        quote = char;
        current += char;
        continue;
      }

      if (line.startsWith(delimiter, index)) {
        flush();
        index += delimiter.length - 1;
        continue;
      }

      current += char;
    }

    current += "\n";
  }

  if (current.trim()) flush();
  return statements;
}

async function createConnection() {
  return mysql.createConnection({
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: process.env.DB_PASSWORD ?? process.env.MYSQLPASSWORD ?? "",
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: sslConfig(),
    multipleStatements: false,
  });
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS present
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(rows[0]?.present || 0) === 1;
}

async function ensureSchemaMigrationsTable(connection) {
  if (await tableExists(connection, "schema_migrations")) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function migrationRecorded(connection, migrationName) {
  await ensureSchemaMigrationsTable(connection);
  const [rows] = await connection.query(
    `SELECT migration_name FROM schema_migrations WHERE migration_name = ? LIMIT 1`,
    [migrationName]
  );
  return rows.length > 0;
}

async function recordMigration(connection, migrationName) {
  await ensureSchemaMigrationsTable(connection);
  await connection.query(
    `INSERT INTO schema_migrations (migration_name) VALUES (?)
     ON DUPLICATE KEY UPDATE migration_name = VALUES(migration_name)`,
    [migrationName]
  );
}

async function executeSqlFile(connection, filePath) {
  const sql = fs.readFileSync(filePath, "utf8");
  const statements = splitSql(sql);
  for (const statement of statements) {
    await connection.query(statement);
  }
}

async function verifyRequiredTriggers(connection) {
  const placeholders = REQUIRED_TRIGGERS.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TRIGGER_NAME
       FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()
        AND TRIGGER_NAME IN (${placeholders})`,
    REQUIRED_TRIGGERS
  );
  const found = new Set(rows.map((row) => row.TRIGGER_NAME));
  const missing = REQUIRED_TRIGGERS.filter((name) => !found.has(name));
  if (missing.length) {
    throw new Error(`Opening Deposit repair did not install required triggers: ${missing.join(", ")}`);
  }
  return { ok: true, triggers: REQUIRED_TRIGGERS.slice() };
}

async function runEquipmentFinanceOpeningDepositFoundationRepair() {
  const connection = await createConnection();
  try {
    const lockName = MIGRATION_LOCK;
    await connection.query("SELECT GET_LOCK(?, 30)", [lockName]);

    try {
      const baseFile = resolveMigrationFile(BASE_MIGRATION_FILE, { required: false });
      const repairFile = resolveMigrationFile(MIGRATION_FILE);
      const integrityFile = resolveMigrationFile(INTEGRITY_MIGRATION_FILE);

      if (baseFile && !(await migrationRecorded(connection, BASE_MIGRATION_FILE))) {
        await executeSqlFile(connection, baseFile);
        await recordMigration(connection, BASE_MIGRATION_FILE);
      }

      if (!(await migrationRecorded(connection, MIGRATION_RECORD))) {
        await executeSqlFile(connection, repairFile);
        await recordMigration(connection, MIGRATION_RECORD);
      }

      await executeSqlFile(connection, integrityFile);
      await recordMigration(connection, INTEGRITY_MIGRATION_RECORD);

      const verifierFile = resolveMigrationFile(VERIFIER_FILE);
      await executeSqlFile(connection, verifierFile);
      await verifyRequiredTriggers(connection);
    } finally {
      await connection.query("DO RELEASE_LOCK(?)", [lockName]);
    }
  } finally {
    await connection.end();
  }
}

module.exports = {
  runEquipmentFinanceOpeningDepositFoundationRepair,
  splitSql,
  verifyRequiredTriggers,
};

if (require.main === module) {
  runEquipmentFinanceOpeningDepositFoundationRepair()
    .then(() => {
      console.log("Equipment Finance Opening Deposit startup repair completed.");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Equipment Finance Opening Deposit startup repair failed.");
      console.error(error);
      process.exit(1);
    });
}
