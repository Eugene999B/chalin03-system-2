const mysql = require("mysql2/promise");
require("dotenv").config();

const RECOVERY_DATE = "2026-08-05";
const RECOVERY_RECORD = "20260805_automatic_customer_merge_rollback";
const RECOVERY_LOCK = "chalin03:customer-rollback:20260805";
const MERGE_ACTION = "MERGE_CUSTOMER_IDENTITIES";
const UNDO_ACTION = "UNDO_CUSTOMER_IDENTITY_MERGE";

function requiredEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (String(value || "").trim()) return value;
  }
  throw new Error(`Missing required database variable: ${names.join(" or ")}.`);
}

function getSslConfig(env = process.env) {
  if (String(env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const encodedCa = String(env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) {
    return {
      ca: Buffer.from(encodedCa, "base64").toString("utf8"),
      rejectUnauthorized: true,
    };
  }
  return {
    rejectUnauthorized: !["0", "false", "no", "off"].includes(
      String(env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
    ),
  };
}

function connectionOptions() {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST", "MYSQL_HOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER", "MYSQL_USER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD", "MYSQL_PASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE", "MYSQL_DATABASE"),
    ssl: getSslConfig(),
    charset: "utf8mb4",
    multipleStatements: false,
  };
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("0")) digits = `233${digits.slice(1)}`;
  else if (digits.length === 9) digits = `233${digits}`;
  return digits.length >= 9 ? digits.slice(-12) : digits;
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function sqlIdentifier(value) {
  const identifier = String(value || "");
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) throw new Error("Unsafe database identifier.");
  return `\`${identifier}\``;
}

function identityScore(snapshotName, snapshotPhone, profile) {
  const snapshotPhoneValue = normalizePhone(snapshotPhone);
  const profilePhoneValue = normalizePhone(profile?.phone);
  const snapshotNameValue = normalizeName(snapshotName);
  const profileNameValue = normalizeName(profile?.name);
  let score = 0;
  if (snapshotPhoneValue && profilePhoneValue && snapshotPhoneValue === profilePhoneValue) score += 100;
  if (snapshotNameValue && profileNameValue && snapshotNameValue === profileNameValue) score += 40;
  return score;
}

function selectSourceProfile(snapshotName, snapshotPhone, sources, targetProfile) {
  const candidates = sources
    .map((profile) => ({ profile, score: identityScore(snapshotName, snapshotPhone, profile) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  if (!candidates.length) return null;
  const bestScore = candidates[0].score;
  const best = candidates.filter((item) => item.score === bestScore);
  const targetScore = identityScore(snapshotName, snapshotPhone, targetProfile);
  if (best.length !== 1 || bestScore <= targetScore) return null;
  return best[0].profile;
}

async function verifyDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = cleanText(row?.database_name, 255);
  const expected = cleanText(process.env.CHALIN03_EXPECTED_DATABASE, 255);
  if (!databaseName || !expected) {
    throw new Error("Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name.");
  }
  if (databaseName !== expected) {
    throw new Error(`Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`);
  }
  return databaseName;
}

async function recoveryRecordExists(connection) {
  const [[table]] = await connection.query(
    "SELECT COUNT(*) AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'"
  );
  if (Number(table?.present || 0) !== 1) throw new Error("The required schema_migrations table is missing.");
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [RECOVERY_RECORD]
  );
  return Number(row?.applied || 0) === 1;
}

async function tableHasColumns(connection, tableName, columns) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [tableName]
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));
  return columns.every((column) => existing.has(column));
}

async function linkedSaleCustomerTables(connection) {
  const [rows] = await connection.query(
    `SELECT c.TABLE_NAME AS table_name
     FROM information_schema.COLUMNS c
     WHERE c.TABLE_SCHEMA = DATABASE()
       AND c.COLUMN_NAME IN ('sale_id', 'customer_id')
     GROUP BY c.TABLE_NAME
     HAVING COUNT(DISTINCT c.COLUMN_NAME) = 2`
  );
  return rows
    .map((row) => row.table_name)
    .filter((table) => !["sales", "debts", "customers"].includes(table));
}

async function loadMergeAudits(connection) {
  const [rows] = await connection.query(
    `SELECT id, branch_id, user_id, entity_id, details, metadata_json, created_at
     FROM activity_log
     WHERE DATE(created_at) = ?
       AND (action = ? OR action_type = ?)
     ORDER BY created_at DESC, id DESC
     FOR UPDATE`,
    [RECOVERY_DATE, MERGE_ACTION, MERGE_ACTION]
  );
  return rows.map((row) => ({ ...row, metadata: parseMetadata(row.metadata_json) }));
}

async function wasAlreadyReversed(connection, branchId, activityId) {
  const marker = `[MergeUndo:${activityId}]`;
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM activity_log
     WHERE branch_id = ?
       AND (action = ? OR action_type = ?)
       AND details LIKE ?`,
    [branchId, UNDO_ACTION, UNDO_ACTION, `%${marker}%`]
  );
  return Number(row?.total || 0) > 0;
}

async function restoreCustomer(connection, branchId, profile) {
  const requestedId = positiveId(profile?.id);
  const name = cleanText(profile?.name, 150) || `Restored customer ${requestedId || ""}`.trim();
  const phone = cleanText(profile?.phone, 30) || null;
  const location = cleanText(profile?.location, 150) || null;

  if (requestedId) {
    const [[existing]] = await connection.query(
      `SELECT id, branch_id, name, phone, location
       FROM customers
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [requestedId]
    );
    if (!existing) {
      await connection.query(
        `INSERT INTO customers (id, branch_id, name, phone, location, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)`,
        [requestedId, branchId, name, phone, location, profile?.created_at || null]
      );
      return { customerId: requestedId, originalIdPreserved: true, name, phone, location };
    }
    const sameIdentity =
      Number(existing.branch_id) === Number(branchId) &&
      (normalizePhone(existing.phone) === normalizePhone(phone) ||
        normalizeName(existing.name) === normalizeName(name));
    if (sameIdentity) {
      await connection.query(
        `UPDATE customers SET name = ?, phone = ?, location = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND branch_id = ?`,
        [name, phone, location, requestedId, branchId]
      );
      return { customerId: requestedId, originalIdPreserved: true, name, phone, location };
    }
  }

  const [insert] = await connection.query(
    `INSERT INTO customers (branch_id, name, phone, location, created_at, updated_at)
     VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)`,
    [branchId, name, phone, location, profile?.created_at || null]
  );
  return {
    customerId: Number(insert.insertId),
    originalIdPreserved: false,
    name,
    phone,
    location,
  };
}

async function loadTargetSales(connection, branchId, targetCustomerId) {
  const [rows] = await connection.query(
    `SELECT
       s.id AS sale_id,
       s.receipt_number,
       s.customer_name AS sale_customer_name,
       s.customer_phone AS sale_customer_phone,
       s.total,
       s.amount_paid,
       s.balance,
       s.created_at,
       d.id AS debt_id,
       d.customer_name AS debt_customer_name,
       d.customer_phone AS debt_customer_phone
     FROM sales s
     LEFT JOIN debts d
       ON d.branch_id = s.branch_id
      AND d.sale_id = s.id
     WHERE s.branch_id = ?
       AND s.customer_id = ?
     ORDER BY s.id
     FOR UPDATE`,
    [branchId, targetCustomerId]
  );
  return rows;
}

async function updateLinkedTables(connection, tableNames, branchId, saleIds, customerId) {
  if (!saleIds.length) return [];
  const placeholders = saleIds.map(() => "?").join(",");
  const results = [];
  for (const tableName of tableNames) {
    const table = sqlIdentifier(tableName);
    const hasBranch = await tableHasColumns(connection, tableName, ["branch_id"]);
    const params = hasBranch
      ? [customerId, branchId, ...saleIds]
      : [customerId, ...saleIds];
    const where = hasBranch
      ? `branch_id = ? AND sale_id IN (${placeholders})`
      : `sale_id IN (${placeholders})`;
    const [result] = await connection.query(
      `UPDATE ${table} SET customer_id = ? WHERE ${where}`,
      params
    );
    results.push({ table: tableName, affected_rows: Number(result.affectedRows || 0) });
  }
  return results;
}

async function processMerge(connection, audit, linkedTables) {
  const branchId = positiveId(audit.branch_id);
  const metadata = audit.metadata || {};
  const targetCustomerId =
    positiveId(audit.entity_id) ||
    positiveId(metadata.target_customer_after?.id) ||
    positiveId(metadata.target_customer_before?.id);
  const sourceProfiles = Array.isArray(metadata.source_customers)
    ? metadata.source_customers.filter((profile) => positiveId(profile?.id))
    : [];

  if (!branchId || !targetCustomerId || !sourceProfiles.length) {
    return {
      activity_id: Number(audit.id),
      branch_id: branchId,
      status: "unresolved_missing_audit_metadata",
      target_customer_id: targetCustomerId,
      restored_sources: [],
      reassigned_sales: 0,
      unresolved_sales: 0,
    };
  }

  if (await wasAlreadyReversed(connection, branchId, audit.id)) {
    return {
      activity_id: Number(audit.id),
      branch_id: branchId,
      status: "already_reversed",
      target_customer_id: targetCustomerId,
      restored_sources: [],
      reassigned_sales: 0,
      unresolved_sales: 0,
    };
  }

  const targetBefore = metadata.target_customer_before || {};
  const restoredSources = new Map();
  for (const profile of sourceProfiles) {
    restoredSources.set(Number(profile.id), await restoreCustomer(connection, branchId, profile));
  }

  const sales = await loadTargetSales(connection, branchId, targetCustomerId);
  const assignments = new Map();
  const unresolved = [];

  for (const sale of sales) {
    const snapshotName = sale.sale_customer_name || sale.debt_customer_name || "";
    const snapshotPhone = sale.sale_customer_phone || sale.debt_customer_phone || "";
    const sourceProfile = selectSourceProfile(
      snapshotName,
      snapshotPhone,
      sourceProfiles,
      targetBefore
    );
    if (!sourceProfile) {
      unresolved.push({
        sale_id: Number(sale.sale_id),
        receipt_number: sale.receipt_number,
        snapshot_name: snapshotName,
        snapshot_phone: snapshotPhone,
      });
      continue;
    }
    const sourceId = Number(sourceProfile.id);
    if (!assignments.has(sourceId)) assignments.set(sourceId, []);
    assignments.get(sourceId).push(Number(sale.sale_id));
  }

  const assignmentResults = [];
  for (const [sourceOriginalId, saleIds] of assignments.entries()) {
    const restored = restoredSources.get(sourceOriginalId);
    const placeholders = saleIds.map(() => "?").join(",");
    const [saleUpdate] = await connection.query(
      `UPDATE sales
       SET customer_id = ?
       WHERE branch_id = ?
         AND customer_id = ?
         AND id IN (${placeholders})`,
      [restored.customerId, branchId, targetCustomerId, ...saleIds]
    );
    const [debtUpdate] = await connection.query(
      `UPDATE debts
       SET customer_id = ?
       WHERE branch_id = ?
         AND sale_id IN (${placeholders})`,
      [restored.customerId, branchId, ...saleIds]
    );
    const linkedUpdates = await updateLinkedTables(
      connection,
      linkedTables,
      branchId,
      saleIds,
      restored.customerId
    );
    assignmentResults.push({
      original_source_customer_id: sourceOriginalId,
      restored_customer_id: restored.customerId,
      original_id_preserved: restored.originalIdPreserved,
      sale_ids: saleIds,
      sales_reassigned: Number(saleUpdate.affectedRows || 0),
      debts_reassigned: Number(debtUpdate.affectedRows || 0),
      linked_updates: linkedUpdates,
    });
  }

  if (cleanText(targetBefore.name, 150)) {
    await connection.query(
      `UPDATE customers
       SET name = ?, phone = ?, location = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND branch_id = ?`,
      [
        cleanText(targetBefore.name, 150),
        cleanText(targetBefore.phone, 30) || null,
        cleanText(targetBefore.location, 150) || null,
        targetCustomerId,
        branchId,
      ]
    );
  }

  const marker = `[MergeUndo:${audit.id}]`;
  const details = `${marker} Automatically reversed all identifiable receipt ownership from the customer merge recorded on ${RECOVERY_DATE}.`;
  const auditMetadata = {
    recovery_record: RECOVERY_RECORD,
    automatic: true,
    original_merge_activity_id: Number(audit.id),
    original_merge_created_at: audit.created_at,
    target_customer_id: targetCustomerId,
    target_profile_restored: targetBefore,
    restored_source_customers: [...restoredSources.entries()].map(([originalId, restored]) => ({
      original_id: originalId,
      ...restored,
    })),
    assignments: assignmentResults,
    unresolved_receipts_left_with_target: unresolved,
    monetary_fields_changed: false,
    payments_deleted: false,
  };
  await connection.query(
    `INSERT INTO activity_log (
       branch_id, user_id, action, details, workspace_code, entity_type,
       entity_id, action_type, outcome, severity, metadata_json
     ) VALUES (?, NULL, ?, ?, 'spare_parts', 'customer_merge_recovery', ?, ?, 'success', 'critical', ?)`,
    [branchId, UNDO_ACTION, details, String(audit.id), UNDO_ACTION, JSON.stringify(auditMetadata)]
  );

  return {
    activity_id: Number(audit.id),
    branch_id: branchId,
    status: "reversed",
    target_customer_id: targetCustomerId,
    restored_sources: auditMetadata.restored_source_customers,
    assignment_results: assignmentResults,
    reassigned_sales: assignmentResults.reduce((sum, item) => sum + item.sales_reassigned, 0),
    reassigned_debts: assignmentResults.reduce((sum, item) => sum + item.debts_reassigned, 0),
    unresolved_sales: unresolved.length,
    unresolved,
  };
}

async function repairOwnershipConsistency(connection) {
  const [debtRepair] = await connection.query(
    `UPDATE debts d
     INNER JOIN sales s
       ON s.id = d.sale_id
      AND s.branch_id = d.branch_id
     SET d.customer_id = s.customer_id
     WHERE s.customer_id IS NOT NULL
       AND (d.customer_id IS NULL OR d.customer_id <> s.customer_id)`
  );

  let installmentRepairCount = 0;
  if (await tableHasColumns(connection, "installment_agreements", ["branch_id", "sale_id", "customer_id"])) {
    const [installmentRepair] = await connection.query(
      `UPDATE installment_agreements ia
       INNER JOIN sales s
         ON s.id = ia.sale_id
        AND s.branch_id = ia.branch_id
       SET ia.customer_id = s.customer_id
       WHERE s.customer_id IS NOT NULL
         AND (ia.customer_id IS NULL OR ia.customer_id <> s.customer_id)`
    );
    installmentRepairCount = Number(installmentRepair.affectedRows || 0);
  }

  const [[mismatch]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM debts d
     INNER JOIN sales s
       ON s.id = d.sale_id
      AND s.branch_id = d.branch_id
     WHERE s.customer_id IS NOT NULL
       AND (d.customer_id IS NULL OR d.customer_id <> s.customer_id)`
  );
  const [[orphans]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM debts d
     LEFT JOIN sales s
       ON s.id = d.sale_id
      AND s.branch_id = d.branch_id
     WHERE s.id IS NULL`
  );
  const [[moneyAnomalies]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM debts
     WHERE amount_owed < 0
        OR amount_paid < 0
        OR balance < 0
        OR ABS((amount_paid + balance) - amount_owed) > 0.01`
  );

  return {
    debt_customer_links_repaired: Number(debtRepair.affectedRows || 0),
    installment_customer_links_repaired: installmentRepairCount,
    remaining_sale_debt_customer_mismatches: Number(mismatch?.total || 0),
    orphan_debts: Number(orphans?.total || 0),
    monetary_anomalies_reported_not_changed: Number(moneyAnomalies?.total || 0),
  };
}

async function runAutomaticCustomerMergeRollback20260805() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    console.log(`${RECOVERY_RECORD} skipped outside production.`);
    return { skipped: true, reason: "non-production" };
  }

  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  let transactionStarted = false;

  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 60) AS acquired", [RECOVERY_LOCK]);
    lockAcquired = Number(lock?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the customer rollback lock.");

    if (await recoveryRecordExists(connection)) {
      console.log(`${RECOVERY_RECORD} was already applied on ${databaseName}.`);
      return { applied: false, already_applied: true, database_name: databaseName };
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const audits = await loadMergeAudits(connection);
    const linkedTables = await linkedSaleCustomerTables(connection);
    const mergeResults = [];
    for (const audit of audits) {
      mergeResults.push(await processMerge(connection, audit, linkedTables));
    }

    const integrity = await repairOwnershipConsistency(connection);
    const summary = {
      recovery_date: RECOVERY_DATE,
      merge_audits_found: audits.length,
      merges_reversed: mergeResults.filter((item) => item.status === "reversed").length,
      merges_already_reversed: mergeResults.filter((item) => item.status === "already_reversed").length,
      merges_missing_metadata: mergeResults.filter((item) => item.status === "unresolved_missing_audit_metadata").length,
      sales_reassigned: mergeResults.reduce((sum, item) => sum + Number(item.reassigned_sales || 0), 0),
      debts_reassigned: mergeResults.reduce((sum, item) => sum + Number(item.reassigned_debts || 0), 0),
      unresolved_receipts: mergeResults.reduce((sum, item) => sum + Number(item.unresolved_sales || 0), 0),
      integrity,
      monetary_fields_changed: false,
      debt_payments_deleted: false,
      sales_deleted: false,
      debts_deleted: false,
    };

    await connection.query(
      `INSERT INTO activity_log (
         branch_id, user_id, action, details, workspace_code, entity_type,
         entity_id, action_type, outcome, severity, metadata_json
       ) VALUES (NULL, NULL, 'AUTOMATIC_CUSTOMER_MERGE_ROLLBACK_20260805', ?, 'spare_parts',
         'customer_merge_recovery_batch', ?, 'AUTOMATIC_CUSTOMER_MERGE_ROLLBACK_20260805',
         'success', 'critical', ?)`,
      [
        `Automatically processed every customer merge recorded on ${RECOVERY_DATE}; restored identifiable receipt and debt ownership without changing money or payments.`,
        RECOVERY_RECORD,
        JSON.stringify({ summary, merge_results: mergeResults }),
      ]
    );
    await connection.query(
      `INSERT INTO schema_migrations (migration_name, description)
       VALUES (?, ?)`,
      [RECOVERY_RECORD, JSON.stringify(summary)]
    );

    await connection.commit();
    transactionStarted = false;

    console.log(`Applied ${RECOVERY_RECORD} on ${databaseName}.`);
    console.log(JSON.stringify(summary));
    return { applied: true, database_name: databaseName, summary, merge_results: mergeResults };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {}
    }
    throw error;
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [RECOVERY_LOCK]);
      } catch {}
    }
    await connection.end();
  }
}

if (require.main === module) {
  runAutomaticCustomerMergeRollback20260805().catch((error) => {
    console.error("Automatic customer merge rollback failed safely. No partial correction was saved.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  MERGE_ACTION,
  RECOVERY_DATE,
  RECOVERY_LOCK,
  RECOVERY_RECORD,
  UNDO_ACTION,
  identityScore,
  normalizeName,
  normalizePhone,
  selectSourceProfile,
  runAutomaticCustomerMergeRollback20260805,
};
