const mysql = require("mysql2/promise");
require("dotenv").config();

const RESET_RECORD =
  "20260805_user_authorized_equipment_installment_restart_reset";
const RESET_LOCK =
  "chalin03:equipment-finance:user-authorized-restart-reset:20260805";
const RESET_DESCRIPTION =
  "One-time user-authorized removal of Equipment Installment Finance operational records so the complete process can be tested again from the beginning.";
const CHUNK_SIZE = 400;

const PRESERVED_DOMAINS = Object.freeze([
  "Spare Parts sales, stock, debts, purchases and accounting",
  "Mining Operations records",
  "Equipment Hire enquiries, quotations, contracts, jobs, dispatches, returns and invoices",
  "shared customer identities",
  "fleet asset identities, photographs and specifications",
  "users, roles, permissions and workspace access",
  "Finance settings, document settings and numbering configuration",
  "system audit and migration history",
]);

function normalizeEnvironment(environment = process.env) {
  return String(environment.NODE_ENV || "development").trim().toLowerCase();
}

function resolveExecutionMode(environment = process.env) {
  return normalizeEnvironment(environment) === "production"
    ? "execute_once"
    : "skip_non_production";
}

function requiredEnv(primaryName, fallbackName, environment = process.env) {
  const value = environment[primaryName] || environment[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(
      `Missing required database variable ${primaryName}${
        fallbackName ? ` or ${fallbackName}` : ""
      }.`
    );
  }
  return value;
}

function getSslConfig(environment = process.env) {
  if (String(environment.DB_SSL || "").trim().toLowerCase() !== "true") {
    return undefined;
  }

  const encodedCa = String(environment.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) {
    return {
      ca: Buffer.from(encodedCa, "base64").toString("utf8"),
      rejectUnauthorized: true,
    };
  }

  const rejectUnauthorized = !["0", "false", "no", "off"].includes(
    String(environment.DB_SSL_REJECT_UNAUTHORIZED || "true")
      .trim()
      .toLowerCase()
  );
  return { rejectUnauthorized };
}

function connectionOptions(environment = process.env) {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST", environment),
    port: Number(environment.DB_PORT || environment.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER", environment),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD", environment),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE", environment),
    ssl: getSslConfig(environment),
    connectTimeout: Number(environment.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function safeIdentifier(value) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9_]+$/.test(text)) {
    throw new Error(`Unsafe database identifier: ${text || "(blank)"}`);
  }
  return `\`${text}\``;
}

function uniqueNumericIds(values) {
  return [
    ...new Set(
      (values || [])
        .map((value) => Number(value))
        .filter((value) => Number.isSafeInteger(value) && value > 0)
    ),
  ];
}

function chunks(values, size = CHUNK_SIZE) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function buildInstallmentAgreementPredicate(columns) {
  const available = columns instanceof Set ? columns : new Set(columns || []);
  const clauses = [];
  if (available.has("sale_type")) clauses.push("sale_type = 'installment'");
  if (available.has("activation_source")) {
    clauses.push("activation_source = 'approved_credit_application'");
  }
  if (available.has("credit_application_id")) {
    clauses.push("credit_application_id IS NOT NULL");
  }
  if (!clauses.length) {
    throw new Error(
      "equipment_sale_agreements has no verified Installment Finance discriminator."
    );
  }
  return `(${clauses.join(" OR ")})`;
}

async function tableExists(connection, tableName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS table_count
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(row?.table_count || 0) === 1;
}

async function tableColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function verifyDatabaseIdentity(connection, environment = process.env) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(row?.database_name || "").trim();
  const expected = String(environment.CHALIN03_EXPECTED_DATABASE || "").trim();

  if (!databaseName || !expected) {
    throw new Error(
      "Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name."
    );
  }
  if (databaseName !== expected) {
    throw new Error(
      `Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`
    );
  }
  return databaseName;
}

async function ensureMigrationLedger(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      migration_name VARCHAR(150) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      description TEXT NULL,
      INDEX idx_schema_migration_name (migration_name),
      INDEX idx_schema_migration_applied_at (applied_at)
    )
  `);
}

async function resetAlreadyApplied(connection) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS applied_count
       FROM schema_migrations
      WHERE migration_name = ?`,
    [RESET_RECORD]
  );
  return Number(row?.applied_count || 0) > 0;
}

async function getReferencingForeignKeys(connection, parentTable) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS child_table,
            COLUMN_NAME AS child_column,
            REFERENCED_COLUMN_NAME AS parent_column
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME = ?
        AND REFERENCED_COLUMN_NAME = 'id'
      ORDER BY TABLE_NAME, COLUMN_NAME`,
    [parentTable]
  );
  return rows;
}

async function hasIdColumn(connection, tableName) {
  const columns = await tableColumns(connection, tableName);
  return columns.has("id");
}

function addDeletedCount(state, tableName, affectedRows) {
  const previous = state.deleted.get(tableName) || 0;
  state.deleted.set(tableName, previous + Number(affectedRows || 0));
}

async function fetchChildIds(
  connection,
  childTable,
  childColumn,
  parentIds
) {
  const output = [];
  for (const batch of chunks(parentIds)) {
    const [rows] = await connection.query(
      `SELECT id
         FROM ${safeIdentifier(childTable)}
        WHERE ${safeIdentifier(childColumn)} IN (${placeholders(batch)})`,
      batch
    );
    output.push(...rows.map((row) => row.id));
  }
  return uniqueNumericIds(output);
}

async function deleteDirectDependents(
  connection,
  childTable,
  childColumn,
  parentIds,
  state
) {
  const grandchildren = await getReferencingForeignKeys(connection, childTable);
  if (grandchildren.length) {
    throw new Error(
      `Cannot safely delete ${childTable}: it has dependent rows but no id column.`
    );
  }

  for (const batch of chunks(parentIds)) {
    const [result] = await connection.query(
      `DELETE FROM ${safeIdentifier(childTable)}
        WHERE ${safeIdentifier(childColumn)} IN (${placeholders(batch)})`,
      batch
    );
    addDeletedCount(state, childTable, result.affectedRows);
  }
}

async function deleteRowsByIds(connection, tableName, ids, state) {
  const known = state.seen.get(tableName) || new Set();
  const freshIds = uniqueNumericIds(ids).filter((id) => !known.has(id));
  if (!freshIds.length) return;

  freshIds.forEach((id) => known.add(id));
  state.seen.set(tableName, known);

  const foreignKeys = await getReferencingForeignKeys(connection, tableName);
  for (const foreignKey of foreignKeys) {
    const childTable = foreignKey.child_table;
    const childColumn = foreignKey.child_column;

    if (
      tableName === "equipment_sale_agreements" &&
      childTable === "equipment_credit_applications" &&
      childColumn === "agreement_id"
    ) {
      continue;
    }

    if (await hasIdColumn(connection, childTable)) {
      const childIds = await fetchChildIds(
        connection,
        childTable,
        childColumn,
        freshIds
      );
      await deleteRowsByIds(connection, childTable, childIds, state);
    } else {
      await deleteDirectDependents(
        connection,
        childTable,
        childColumn,
        freshIds,
        state
      );
    }
  }

  for (const batch of chunks(freshIds)) {
    const [result] = await connection.query(
      `DELETE FROM ${safeIdentifier(tableName)}
        WHERE id IN (${placeholders(batch)})`,
      batch
    );
    addDeletedCount(state, tableName, result.affectedRows);
  }
}

async function selectRows(connection, tableName, selectedColumns, whereClause) {
  if (!(await tableExists(connection, tableName))) return [];
  const columns = await tableColumns(connection, tableName);
  const selected = selectedColumns.filter((column) => columns.has(column));
  if (!selected.includes("id")) selected.unshift("id");
  const [rows] = await connection.query(
    `SELECT ${selected.map(safeIdentifier).join(", ")}
       FROM ${safeIdentifier(tableName)}
      ${whereClause ? `WHERE ${whereClause}` : ""}
      FOR UPDATE`
  );
  return rows;
}

function collectIds(rows, columnName) {
  return uniqueNumericIds(rows.map((row) => row[columnName]));
}

async function removeAgreementCycle(connection, applicationIds) {
  if (!applicationIds.length) return 0;
  if (!(await tableExists(connection, "equipment_credit_applications"))) return 0;
  const columns = await tableColumns(connection, "equipment_credit_applications");
  if (!columns.has("agreement_id")) return 0;

  let affected = 0;
  for (const batch of chunks(applicationIds)) {
    const [result] = await connection.query(
      `UPDATE equipment_credit_applications
          SET agreement_id = NULL
        WHERE id IN (${placeholders(batch)})`,
      batch
    );
    affected += Number(result.affectedRows || 0);
  }
  return affected;
}

async function filterUnreferencedQuotationIds(connection, ids) {
  if (!ids.length || !(await tableExists(connection, "equipment_sales_quotations"))) {
    return [];
  }

  const quotationColumns = await tableColumns(
    connection,
    "equipment_sales_quotations"
  );
  if (!quotationColumns.has("id")) return [];

  const applicationExists = await tableExists(
    connection,
    "equipment_credit_applications"
  );
  const agreementExists = await tableExists(
    connection,
    "equipment_sale_agreements"
  );
  const applicationColumns = applicationExists
    ? await tableColumns(connection, "equipment_credit_applications")
    : new Set();
  const agreementColumns = agreementExists
    ? await tableColumns(connection, "equipment_sale_agreements")
    : new Set();

  const output = [];
  for (const batch of chunks(ids)) {
    const guards = [];
    if (applicationColumns.has("quotation_id")) {
      guards.push(
        "NOT EXISTS (SELECT 1 FROM equipment_credit_applications application WHERE application.quotation_id = quotation.id)"
      );
    }
    if (agreementColumns.has("quotation_id")) {
      guards.push(
        "NOT EXISTS (SELECT 1 FROM equipment_sale_agreements agreement WHERE agreement.quotation_id = quotation.id)"
      );
    }
    const [rows] = await connection.query(
      `SELECT quotation.id
         FROM equipment_sales_quotations quotation
        WHERE quotation.id IN (${placeholders(batch)})
          ${guards.length ? `AND ${guards.join(" AND ")}` : ""}`,
      batch
    );
    output.push(...rows.map((row) => row.id));
  }
  return uniqueNumericIds(output);
}

async function filterUnreferencedEnquiryIds(connection, ids) {
  if (!ids.length || !(await tableExists(connection, "equipment_sales_enquiries"))) {
    return [];
  }

  const guards = [];
  if (await tableExists(connection, "equipment_credit_applications")) {
    const columns = await tableColumns(connection, "equipment_credit_applications");
    if (columns.has("enquiry_id")) {
      guards.push(
        "NOT EXISTS (SELECT 1 FROM equipment_credit_applications application WHERE application.enquiry_id = enquiry.id)"
      );
    }
  }
  if (await tableExists(connection, "equipment_sales_quotations")) {
    const columns = await tableColumns(connection, "equipment_sales_quotations");
    if (columns.has("enquiry_id")) {
      guards.push(
        "NOT EXISTS (SELECT 1 FROM equipment_sales_quotations quotation WHERE quotation.enquiry_id = enquiry.id)"
      );
    }
  }

  const output = [];
  for (const batch of chunks(ids)) {
    const [rows] = await connection.query(
      `SELECT enquiry.id
         FROM equipment_sales_enquiries enquiry
        WHERE enquiry.id IN (${placeholders(batch)})
          ${guards.length ? `AND ${guards.join(" AND ")}` : ""}`,
      batch
    );
    output.push(...rows.map((row) => row.id));
  }
  return uniqueNumericIds(output);
}

async function restoreFleetAssets(connection, assetIds) {
  if (!assetIds.length || !(await tableExists(connection, "fleet_assets"))) {
    return 0;
  }
  const columns = await tableColumns(connection, "fleet_assets");
  if (!columns.has("sale_status")) return 0;

  let affected = 0;
  for (const batch of chunks(assetIds)) {
    const assignments = ["sale_status = 'available'"];
    if (columns.has("current_status")) {
      assignments.push(
        "current_status = CASE WHEN current_status IN ('sold','reserved') THEN 'available' ELSE current_status END"
      );
    }
    if (columns.has("sold_at")) assignments.push("sold_at = NULL");

    const [result] = await connection.query(
      `UPDATE fleet_assets asset
          SET ${assignments.join(", ")}
        WHERE asset.id IN (${placeholders(batch)})
          AND NOT EXISTS (
            SELECT 1
              FROM equipment_sale_agreements remaining
             WHERE remaining.asset_id = asset.id
               AND remaining.agreement_status NOT IN ('completed','cancelled','defaulted','returned')
          )
          AND NOT EXISTS (
            SELECT 1
              FROM equipment_asset_sale_locks remaining_lock
             WHERE remaining_lock.asset_id = asset.id
               AND remaining_lock.released_at IS NULL
          )`,
      batch
    );
    affected += Number(result.affectedRows || 0);
  }
  return affected;
}

async function countRemainingFinanceRoots(connection) {
  let applications = 0;
  let agreements = 0;

  if (await tableExists(connection, "equipment_credit_applications")) {
    const [[row]] = await connection.query(
      "SELECT COUNT(*) AS row_count FROM equipment_credit_applications"
    );
    applications = Number(row?.row_count || 0);
  }

  if (await tableExists(connection, "equipment_sale_agreements")) {
    const columns = await tableColumns(connection, "equipment_sale_agreements");
    const predicate = buildInstallmentAgreementPredicate(columns);
    const [[row]] = await connection.query(
      `SELECT COUNT(*) AS row_count
         FROM equipment_sale_agreements
        WHERE ${predicate}`
    );
    agreements = Number(row?.row_count || 0);
  }

  return { applications, agreements };
}

async function runUserAuthorizedInstallmentRestartReset20260805({
  environment = process.env,
  connection = null,
} = {}) {
  if (resolveExecutionMode(environment) !== "execute_once") {
    console.log(
      `Skipped ${RESET_RECORD}: the one-time reset runs only in production.`
    );
    return { skipped: true, reason: "non_production" };
  }

  const ownsConnection = !connection;
  const db = connection || (await mysql.createConnection(connectionOptions(environment)));
  let lockAcquired = false;
  let transactionStarted = false;

  try {
    const databaseName = await verifyDatabaseIdentity(db, environment);
    await ensureMigrationLedger(db);

    const [[lockRow]] = await db.query("SELECT GET_LOCK(?, 60) AS acquired", [
      RESET_LOCK,
    ]);
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the one-time Installment Finance reset lock.");
    }

    if (await resetAlreadyApplied(db)) {
      console.log(`Skipped ${RESET_RECORD}: it has already completed.`);
      return {
        skipped: true,
        reason: "already_applied",
        database: databaseName,
        reset_record: RESET_RECORD,
      };
    }

    await db.beginTransaction();
    transactionStarted = true;

    const applicationRows = await selectRows(
      db,
      "equipment_credit_applications",
      ["id", "asset_id", "quotation_id", "enquiry_id", "agreement_id"],
      ""
    );

    let agreementRows = [];
    if (await tableExists(db, "equipment_sale_agreements")) {
      const agreementColumns = await tableColumns(
        db,
        "equipment_sale_agreements"
      );
      agreementRows = await selectRows(
        db,
        "equipment_sale_agreements",
        ["id", "asset_id", "quotation_id", "credit_application_id"],
        buildInstallmentAgreementPredicate(agreementColumns)
      );
    }

    const applicationIds = collectIds(applicationRows, "id");
    const agreementIds = collectIds(agreementRows, "id");
    const assetIds = uniqueNumericIds([
      ...collectIds(applicationRows, "asset_id"),
      ...collectIds(agreementRows, "asset_id"),
    ]);
    const quotationIds = uniqueNumericIds([
      ...collectIds(applicationRows, "quotation_id"),
      ...collectIds(agreementRows, "quotation_id"),
    ]);
    const enquiryIds = collectIds(applicationRows, "enquiry_id");

    if (quotationIds.length && (await tableExists(db, "equipment_sales_quotations"))) {
      const quotationColumns = await tableColumns(
        db,
        "equipment_sales_quotations"
      );
      if (quotationColumns.has("enquiry_id")) {
        for (const batch of chunks(quotationIds)) {
          const [rows] = await db.query(
            `SELECT enquiry_id
               FROM equipment_sales_quotations
              WHERE id IN (${placeholders(batch)})
              FOR UPDATE`,
            batch
          );
          enquiryIds.push(...collectIds(rows, "enquiry_id"));
        }
      }
    }

    const cycleLinksCleared = await removeAgreementCycle(db, applicationIds);
    const state = { deleted: new Map(), seen: new Map() };

    await deleteRowsByIds(db, "equipment_sale_agreements", agreementIds, state);
    await deleteRowsByIds(db, "equipment_credit_applications", applicationIds, state);

    const removableQuotationIds = await filterUnreferencedQuotationIds(
      db,
      quotationIds
    );
    await deleteRowsByIds(
      db,
      "equipment_sales_quotations",
      removableQuotationIds,
      state
    );

    const removableEnquiryIds = await filterUnreferencedEnquiryIds(
      db,
      uniqueNumericIds(enquiryIds)
    );
    await deleteRowsByIds(
      db,
      "equipment_sales_enquiries",
      removableEnquiryIds,
      state
    );

    const restoredAssets = await restoreFleetAssets(db, assetIds);
    const remaining = await countRemainingFinanceRoots(db);
    if (remaining.applications !== 0 || remaining.agreements !== 0) {
      throw new Error(
        `Installment Finance reset verification failed: ${remaining.applications} applications and ${remaining.agreements} installment agreements remain.`
      );
    }

    await db.query(
      `INSERT INTO schema_migrations (migration_name, description)
       VALUES (?, ?)`,
      [RESET_RECORD, RESET_DESCRIPTION]
    );

    await db.commit();
    transactionStarted = false;

    const deleted = [...state.deleted.entries()]
      .map(([table, deletedRows]) => ({ table, deleted_rows: deletedRows }))
      .sort((left, right) => left.table.localeCompare(right.table));

    const result = {
      status: "success",
      mode: "production_one_time_installment_restart_reset",
      database: databaseName,
      reset_record: RESET_RECORD,
      applications_selected: applicationIds.length,
      agreements_selected: agreementIds.length,
      quotations_deleted: removableQuotationIds.length,
      enquiries_deleted: removableEnquiryIds.length,
      agreement_cycle_links_cleared: cycleLinksCleared,
      fleet_assets_restored: restoredAssets,
      deleted,
      remaining,
      preserved: [...PRESERVED_DOMAINS],
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await db.rollback();
      } catch (_rollbackError) {
        // Preserve the original reset error.
      }
    }
    throw error;
  } finally {
    if (lockAcquired) {
      try {
        await db.query("SELECT RELEASE_LOCK(?)", [RESET_LOCK]);
      } catch (_releaseError) {
        // Closing the connection also releases the advisory lock.
      }
    }
    if (ownsConnection) await db.end();
  }
}

if (require.main === module) {
  runUserAuthorizedInstallmentRestartReset20260805().catch((error) => {
    console.error("One-time Installment Finance restart reset failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  PRESERVED_DOMAINS,
  RESET_DESCRIPTION,
  RESET_LOCK,
  RESET_RECORD,
  buildInstallmentAgreementPredicate,
  connectionOptions,
  resolveExecutionMode,
  runUserAuthorizedInstallmentRestartReset20260805,
  safeIdentifier,
  uniqueNumericIds,
  verifyDatabaseIdentity,
};
