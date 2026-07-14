require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { executeSqlScript } = require("./sqlScriptRunner");

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function stableBackupChecksum(backup) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        backup_type: backup.backup_type,
        included_tables: backup.included_tables,
        table_counts: backup.table_counts,
        tables: backup.tables,
      })
    )
    .digest("hex");
}

function assertSafeTarget({ host, database, confirm }) {
  if (!confirm) {
    throw new Error("--confirm is required before restoring a local _test database.");
  }

  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`Refusing database host '${host}'.`);
  }

  if (/railway/i.test(host) || /railway/i.test(database)) {
    throw new Error("Refusing Railway-like host or database name.");
  }

  if (!/_test$/i.test(database)) {
    throw new Error(`Refusing database '${database}'. Restore tests require a name ending in _test.`);
  }
}

function readBackup(backupPath) {
  const resolved = path.resolve(backupPath);
  const backup = JSON.parse(fs.readFileSync(resolved, "utf8"));

  if (backup.backup_type !== "full_system_backup") {
    throw new Error("Invalid backup_type. Expected full_system_backup.");
  }

  if (!backup.tables || typeof backup.tables !== "object") {
    throw new Error("Backup does not contain a tables object.");
  }

  if (backup.checksum_sha256) {
    const actual = stableBackupChecksum(backup);
    if (actual !== backup.checksum_sha256) {
      throw new Error("Backup checksum does not match backup contents.");
    }
  }

  return backup;
}

async function knownTableNames(connection) {
  const [rows] = await connection.query(
    "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'"
  );
  return new Set(rows.map((row) => String(Object.values(row)[0])));
}

function validateBackupTables(backup, knownTables) {
  const tableNames = Object.keys(backup.tables);
  if (tableNames.length === 0) {
    throw new Error("Backup contains no tables.");
  }

  for (const tableName of tableNames) {
    if (!/^[A-Za-z0-9_]+$/.test(tableName)) {
      throw new Error(`Unsafe table identifier in backup: ${tableName}`);
    }
    if (!knownTables.has(tableName)) {
      throw new Error(`Backup contains unknown table not present in schema: ${tableName}`);
    }
    if (!Array.isArray(backup.tables[tableName])) {
      throw new Error(`Backup table ${tableName} is not an array of rows.`);
    }
  }

  if (backup.table_counts && typeof backup.table_counts === "object") {
    for (const [tableName, expectedCount] of Object.entries(backup.table_counts)) {
      if (!/^[A-Za-z0-9_]+$/.test(tableName) || !knownTables.has(tableName)) {
        throw new Error(`Backup table_counts contains unknown table: ${tableName}`);
      }
      const actualCount = backup.tables[tableName]?.length || 0;
      if (Number(expectedCount) !== actualCount) {
        throw new Error(
          `Backup table_counts mismatch for ${tableName}: manifest ${expectedCount}, rows ${actualCount}.`
        );
      }
    }
  }

  return tableNames;
}

async function tableColumns(connection, tableName) {
  const [columns] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
  return columns.map((column) => column.Field);
}

async function insertRows(connection, tableName, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const availableColumns = await tableColumns(connection, tableName);
  const columns = availableColumns.filter((column) =>
    rows.some((row) => Object.prototype.hasOwnProperty.call(row, column))
  );

  if (columns.length === 0) {
    return 0;
  }

  const columnSql = columns.map((column) => `\`${column}\``).join(", ");
  const placeholders = `(${columns.map(() => "?").join(", ")})`;
  let inserted = 0;

  for (let index = 0; index < rows.length; index += 250) {
    const chunk = rows.slice(index, index + 250);
    const values = [];
    const valueSql = chunk
      .map((row) => {
        values.push(...columns.map((column) => row[column] ?? null));
        return placeholders;
      })
      .join(", ");

    await connection.query(
      `INSERT INTO \`${tableName}\` (${columnSql}) VALUES ${valueSql}`,
      values
    );
    inserted += chunk.length;
  }

  return inserted;
}

async function checkRestoredTables(connection, tableNames) {
  for (const tableName of tableNames) {
    const [rows] = await connection.query(`CHECK TABLE \`${tableName}\``);
    const failed = rows.find(
      (row) =>
        String(row.Msg_type || "").toLowerCase() === "error" ||
        String(row.Msg_text || "").toUpperCase() !== "OK"
    );
    if (failed) {
      throw new Error(`CHECK TABLE failed for ${tableName}: ${failed.Msg_text}`);
    }
  }
}

async function verifyForeignKeys(connection) {
  const [foreignKeys] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND REFERENCED_TABLE_NAME IS NOT NULL`
  );

  for (const foreignKey of foreignKeys) {
    const childTable = foreignKey.TABLE_NAME;
    const childColumn = foreignKey.COLUMN_NAME;
    const parentTable = foreignKey.REFERENCED_TABLE_NAME;
    const parentColumn = foreignKey.REFERENCED_COLUMN_NAME;
    const [[row]] = await connection.query(
      `SELECT COUNT(*) AS missing_count
       FROM \`${childTable}\` child_rows
       LEFT JOIN \`${parentTable}\` parent_rows
         ON child_rows.\`${childColumn}\` = parent_rows.\`${parentColumn}\`
       WHERE child_rows.\`${childColumn}\` IS NOT NULL
         AND parent_rows.\`${parentColumn}\` IS NULL`
    );
    if (Number(row.missing_count || 0) > 0) {
      throw new Error(
        `Foreign-key consistency failed for ${childTable}.${childColumn} -> ${parentTable}.${parentColumn}.`
      );
    }
  }
}

async function main() {
  const backupPath = argValue("--backup");
  const host = argValue("--host", process.env.DB_HOST || process.env.MYSQLHOST || "localhost");
  const database = argValue("--database", "chalin03_full_test");
  const user = argValue("--user", process.env.DB_USER || process.env.MYSQLUSER || "root");
  const password = argValue("--password", process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || "");
  const confirm = hasArg("--confirm");

  if (!backupPath) {
    throw new Error("--backup path is required.");
  }

  assertSafeTarget({ host, database, confirm });
  const backup = readBackup(backupPath);
  const schemaPath = path.resolve(__dirname, "../../database/schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");

  const connection = await mysql.createConnection({
    host,
    user,
    password,
    multipleStatements: true,
  });

  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.query(`CREATE DATABASE \`${database}\``);
    await connection.changeUser({ database });
    await executeSqlScript(connection, schemaSql, "database/schema.sql");

    const knownTables = await knownTableNames(connection);
    const tableNames = validateBackupTables(backup, knownTables);
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const tableName of [...tableNames].reverse()) {
        await connection.query(`DELETE FROM \`${tableName}\``);
      }

      const restoredCounts = {};
      for (const tableName of tableNames) {
        restoredCounts[tableName] = await insertRows(
          connection,
          tableName,
          backup.tables[tableName]
        );
      }
    } finally {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    }

    for (const [tableName, rows] of Object.entries(backup.tables)) {
      const [[countRow]] = await connection.query(
        `SELECT COUNT(*) AS count FROM \`${tableName}\``
      );
      const expected = Array.isArray(rows) ? rows.length : 0;
      if (Number(countRow.count) !== expected) {
        throw new Error(
          `Row-count mismatch for ${tableName}: expected ${expected}, restored ${countRow.count}.`
        );
      }
    }

    await checkRestoredTables(connection, tableNames);
    await verifyForeignKeys(connection);

    const representativeTable = Object.entries(backup.tables).find(
      ([, rows]) => Array.isArray(rows) && rows.length > 0
    )?.[0];

    if (representativeTable) {
      const [[row]] = await connection.query(
        `SELECT COUNT(*) AS count FROM \`${representativeTable}\``
      );
      if (Number(row.count) <= 0) {
        throw new Error(`Representative rows were not restored for ${representativeTable}.`);
      }
    }

    console.log("PASS - backup checksum, schema load, restore and row-count verification completed.");
    console.log(`PASS - restored ${tableNames.length} tables into ${database} on ${host}.`);
    console.log("PASS - normal chalin03_db was not touched.");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`FAIL - ${error.message}`);
  process.exit(1);
});
