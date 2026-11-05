const mysql = require("mysql2/promise");
require("dotenv").config();

const RECOVERY_DATE = "2026-08-05";
const RECOVERY_RECORD = "20260805_exact_name_receipt_owner_recovery";
const RECOVERY_LOCK = "chalin03:exact-name-receipt-recovery:20260805";
const MERGE_ACTION = "MERGE_CUSTOMER_IDENTITIES";
const UNDO_ACTION = "UNDO_CUSTOMER_IDENTITY_MERGE";
const REQUIRED_ROLLBACK_RECORD = "20260805_automatic_customer_merge_rollback";

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

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
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

function chooseExactNameOwner({ snapshotName, profiles, targetCustomerId, previousCustomerId }) {
  const targetId = positiveId(targetCustomerId);
  const previousId = positiveId(previousCustomerId);
  const available = (Array.isArray(profiles) ? profiles : []).filter((profile) =>
    positiveId(profile?.customer_id)
  );
  const normalizedSnapshot = normalizeName(snapshotName);

  if (normalizedSnapshot) {
    const exact = available.filter(
      (profile) => normalizeName(profile.name) === normalizedSnapshot
    );
    const exactTarget = exact.find(
      (profile) => Number(profile.customer_id) === Number(targetId)
    );
    if (exactTarget) {
      return {
        customer_id: Number(exactTarget.customer_id),
        reason: "exact_name_original_target",
      };
    }
    if (exact.length === 1) {
      return {
        customer_id: Number(exact[0].customer_id),
        reason: "exact_name_unique_source",
      };
    }
    const exactPrevious = exact.find(
      (profile) => Number(profile.customer_id) === Number(previousId)
    );
    if (exactPrevious) {
      return {
        customer_id: Number(exactPrevious.customer_id),
        reason: "exact_name_previous_rollback_assignment",
      };
    }
  }

  if (previousId && available.some((profile) => Number(profile.customer_id) === previousId)) {
    return {
      customer_id: previousId,
      reason: "previous_rollback_assignment",
    };
  }

  if (targetId && available.some((profile) => Number(profile.customer_id) === targetId)) {
    return {
      customer_id: targetId,
      reason: normalizedSnapshot ? "unmatched_name_original_target" : "blank_name_original_target",
    };
  }

  return { customer_id: null, reason: "unresolved_missing_customer" };
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

async function migrationRecordExists(connection, migrationName) {
  const [[table]] = await connection.query(
    "SELECT COUNT(*) AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'"
  );
  if (Number(table?.present || 0) !== 1) {
    throw new Error("The required schema_migrations table is missing.");
  }
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [migrationName]
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

async function databaseFinancialSnapshot(connection) {
  const [[row]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM sales) AS sale_count,
       (SELECT COALESCE(SUM(total), 0) FROM sales) AS sale_total,
       (SELECT COALESCE(SUM(amount_paid), 0) FROM sales) AS sale_amount_paid,
       (SELECT COALESCE(SUM(balance), 0) FROM sales) AS sale_balance,
       (SELECT COUNT(*) FROM debts) AS debt_count,
       (SELECT COALESCE(SUM(amount_owed), 0) FROM debts) AS debt_amount_owed,
       (SELECT COALESCE(SUM(amount_paid), 0) FROM debts) AS debt_amount_paid,
       (SELECT COALESCE(SUM(balance), 0) FROM debts) AS debt_balance,
       (SELECT COUNT(*) FROM debt_payments) AS payment_count,
       (SELECT COALESCE(SUM(amount), 0) FROM debt_payments) AS payment_total`
  );
  return {
    sale_count: Number(row.sale_count || 0),
    sale_total: Number(row.sale_total || 0),
    sale_amount_paid: Number(row.sale_amount_paid || 0),
    sale_balance: Number(row.sale_balance || 0),
    debt_count: Number(row.debt_count || 0),
    debt_amount_owed: Number(row.debt_amount_owed || 0),
    debt_amount_paid: Number(row.debt_amount_paid || 0),
    debt_balance: Number(row.debt_balance || 0),
    payment_count: Number(row.payment_count || 0),
    payment_total: Number(row.payment_total || 0),
  };
}

function assertFinancialSnapshotPreserved(before, after) {
  for (const field of ["sale_count", "debt_count", "payment_count"]) {
    if (Number(before[field]) !== Number(after[field])) {
      throw new Error(`Financial record count changed for ${field}.`);
    }
  }
  for (const field of [
    "sale_total",
    "sale_amount_paid",
    "sale_balance",
    "debt_amount_owed",
    "debt_amount_paid",
    "debt_balance",
    "payment_total",
  ]) {
    if (Math.abs(Number(before[field]) - Number(after[field])) > 0.01) {
      throw new Error(`Financial total changed for ${field}.`);
    }
  }
}

async function loadUndoMetadataByMerge(connection) {
  const [rows] = await connection.query(
    `SELECT metadata_json
     FROM activity_log
     WHERE DATE(created_at) = ?
       AND (action = ? OR action_type = ?)
     ORDER BY created_at DESC, id DESC
     FOR UPDATE`,
    [RECOVERY_DATE, UNDO_ACTION, UNDO_ACTION]
  );
  const result = new Map();
  for (const row of rows) {
    const metadata = parseMetadata(row.metadata_json);
    const mergeActivityId = positiveId(metadata.original_merge_activity_id);
    if (mergeActivityId && !result.has(mergeActivityId)) {
      result.set(mergeActivityId, metadata);
    }
  }
  return result;
}

async function loadMergeAudits(connection) {
  const [rows] = await connection.query(
    `SELECT id, branch_id, entity_id, metadata_json, created_at
     FROM activity_log
     WHERE DATE(created_at) = ?
       AND (action = ? OR action_type = ?)
     ORDER BY created_at DESC, id DESC
     FOR UPDATE`,
    [RECOVERY_DATE, MERGE_ACTION, MERGE_ACTION]
  );
  return rows.map((row) => ({ ...row, metadata: parseMetadata(row.metadata_json) }));
}

function buildLineage(mergeAudit, undoMetadata) {
  const metadata = mergeAudit.metadata || {};
  const targetProfile = metadata.target_customer_before || metadata.target_customer_after || {};
  const targetCustomerId =
    positiveId(mergeAudit.entity_id) ||
    positiveId(metadata.target_customer_after?.id) ||
    positiveId(metadata.target_customer_before?.id);
  const restoredByOriginalId = new Map();
  for (const restored of Array.isArray(undoMetadata?.restored_source_customers)
    ? undoMetadata.restored_source_customers
    : []) {
    const originalId = positiveId(restored.original_id || restored.originalId);
    const actualId = positiveId(
      restored.customerId || restored.customer_id || restored.restored_customer_id
    );
    if (originalId && actualId) restoredByOriginalId.set(originalId, actualId);
  }

  const sourceProfiles = (Array.isArray(metadata.source_customers)
    ? metadata.source_customers
    : []
  )
    .map((profile) => {
      const originalId = positiveId(profile?.id);
      if (!originalId) return null;
      return {
        original_customer_id: originalId,
        customer_id: restoredByOriginalId.get(originalId) || originalId,
        name: cleanText(profile?.name, 150),
        profile_type: "source",
      };
    })
    .filter(Boolean);

  const profiles = [
    {
      original_customer_id: targetCustomerId,
      customer_id: targetCustomerId,
      name: cleanText(targetProfile?.name, 150),
      profile_type: "target",
    },
    ...sourceProfiles,
  ].filter((profile) => positiveId(profile.customer_id));

  const previousAssignments = new Map();
  for (const assignment of Array.isArray(undoMetadata?.assignments)
    ? undoMetadata.assignments
    : []) {
    const actualCustomerId = positiveId(
      assignment.restored_customer_id ||
        restoredByOriginalId.get(positiveId(assignment.original_source_customer_id))
    );
    if (!actualCustomerId) continue;
    for (const saleId of Array.isArray(assignment.sale_ids) ? assignment.sale_ids : []) {
      const normalizedSaleId = positiveId(saleId);
      if (normalizedSaleId) previousAssignments.set(normalizedSaleId, actualCustomerId);
    }
  }

  return {
    merge_activity_id: Number(mergeAudit.id),
    branch_id: positiveId(mergeAudit.branch_id),
    target_customer_id: targetCustomerId,
    profiles,
    participant_customer_ids: [...new Set(profiles.map((profile) => Number(profile.customer_id)))],
    previous_assignments: previousAssignments,
  };
}

async function filterExistingProfiles(connection, branchId, profiles) {
  const ids = [...new Set(profiles.map((profile) => positiveId(profile.customer_id)).filter(Boolean))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT id FROM customers WHERE branch_id = ? AND id IN (${placeholders}) FOR UPDATE`,
    [branchId, ...ids]
  );
  const existing = new Set(rows.map((row) => Number(row.id)));
  return profiles.filter((profile) => existing.has(Number(profile.customer_id)));
}

async function loadLineageSales(connection, branchId, customerIds) {
  if (!customerIds.length) return [];
  const placeholders = customerIds.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT
       s.id AS sale_id,
       s.customer_id AS current_customer_id,
       s.receipt_number,
       COALESCE(NULLIF(TRIM(s.customer_name), ''), NULLIF(TRIM(d.customer_name), '')) AS snapshot_name,
       s.created_at AS sale_date,
       d.id AS debt_id,
       d.customer_id AS debt_customer_id,
       d.balance AS debt_balance
     FROM sales s
     LEFT JOIN debts d
       ON d.branch_id = s.branch_id
      AND d.sale_id = s.id
     WHERE s.branch_id = ?
       AND s.customer_id IN (${placeholders})
     ORDER BY s.id
     FOR UPDATE`,
    [branchId, ...customerIds]
  );
  return rows;
}

async function updateInstallmentOwner(connection, branchId, saleId, customerId) {
  if (
    !(await tableHasColumns(connection, "installment_agreements", [
      "branch_id",
      "sale_id",
      "customer_id",
    ]))
  ) {
    return 0;
  }
  const [result] = await connection.query(
    `UPDATE installment_agreements
     SET customer_id = ?
     WHERE branch_id = ? AND sale_id = ?
       AND (customer_id IS NULL OR customer_id <> ?)`,
    [customerId, branchId, saleId, customerId]
  );
  return Number(result.affectedRows || 0);
}

async function processLineage(connection, lineage) {
  if (!lineage.branch_id || !lineage.target_customer_id || lineage.profiles.length < 2) {
    return {
      merge_activity_id: lineage.merge_activity_id,
      status: "skipped_incomplete_lineage",
      receipt_results: [],
    };
  }

  const profiles = await filterExistingProfiles(
    connection,
    lineage.branch_id,
    lineage.profiles
  );
  if (!profiles.some((profile) => Number(profile.customer_id) === lineage.target_customer_id)) {
    throw new Error(`Original target customer is missing for merge ${lineage.merge_activity_id}.`);
  }

  const participantIds = [...new Set(profiles.map((profile) => Number(profile.customer_id)))];
  const sales = await loadLineageSales(connection, lineage.branch_id, participantIds);
  const receiptResults = [];

  for (const sale of sales) {
    const previousCustomerId = lineage.previous_assignments.get(Number(sale.sale_id)) || null;
    const choice = chooseExactNameOwner({
      snapshotName: sale.snapshot_name,
      profiles,
      targetCustomerId: lineage.target_customer_id,
      previousCustomerId,
    });
    if (!choice.customer_id) {
      throw new Error(`Could not resolve receipt ${sale.receipt_number || sale.sale_id}.`);
    }

    let saleUpdated = 0;
    let debtUpdated = 0;
    if (Number(sale.current_customer_id) !== Number(choice.customer_id)) {
      const [saleResult] = await connection.query(
        `UPDATE sales SET customer_id = ? WHERE branch_id = ? AND id = ?`,
        [choice.customer_id, lineage.branch_id, sale.sale_id]
      );
      saleUpdated = Number(saleResult.affectedRows || 0);
    }
    if (sale.debt_id && Number(sale.debt_customer_id) !== Number(choice.customer_id)) {
      const [debtResult] = await connection.query(
        `UPDATE debts SET customer_id = ? WHERE branch_id = ? AND sale_id = ?`,
        [choice.customer_id, lineage.branch_id, sale.sale_id]
      );
      debtUpdated = Number(debtResult.affectedRows || 0);
    }
    const installmentUpdated = await updateInstallmentOwner(
      connection,
      lineage.branch_id,
      sale.sale_id,
      choice.customer_id
    );

    receiptResults.push({
      sale_id: Number(sale.sale_id),
      receipt_number: sale.receipt_number,
      sale_date: sale.sale_date,
      snapshot_name: sale.snapshot_name,
      previous_customer_id: Number(sale.current_customer_id),
      assigned_customer_id: Number(choice.customer_id),
      assignment_reason: choice.reason,
      debt_id: positiveId(sale.debt_id),
      debt_balance: Number(sale.debt_balance || 0),
      sale_updated: saleUpdated,
      debt_updated: debtUpdated,
      installment_updated: installmentUpdated,
    });
  }

  return {
    merge_activity_id: lineage.merge_activity_id,
    branch_id: lineage.branch_id,
    target_customer_id: lineage.target_customer_id,
    status: "processed",
    profiles,
    receipt_results: receiptResults,
  };
}

async function synchronizeDebtOwnership(connection) {
  const [repair] = await connection.query(
    `UPDATE debts d
     INNER JOIN sales s
       ON s.id = d.sale_id
      AND s.branch_id = d.branch_id
     SET d.customer_id = s.customer_id
     WHERE s.customer_id IS NOT NULL
       AND (d.customer_id IS NULL OR d.customer_id <> s.customer_id)`
  );
  const [[remaining]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM debts d
     INNER JOIN sales s
       ON s.id = d.sale_id
      AND s.branch_id = d.branch_id
     WHERE s.customer_id IS NOT NULL
       AND (d.customer_id IS NULL OR d.customer_id <> s.customer_id)`
  );
  if (Number(remaining.total || 0) !== 0) {
    throw new Error("Sale and debt customer ownership still disagree after correction.");
  }
  return Number(repair.affectedRows || 0);
}

async function runExactNameReceiptOwnerRecovery20260805() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    console.log(`${RECOVERY_RECORD} skipped outside production.`);
    return { skipped: true, reason: "non-production" };
  }

  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  let transactionStarted = false;

  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 60) AS acquired", [
      RECOVERY_LOCK,
    ]);
    lockAcquired = Number(lock?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the exact-name receipt recovery lock.");

    if (await migrationRecordExists(connection, RECOVERY_RECORD)) {
      console.log(`${RECOVERY_RECORD} was already applied on ${databaseName}.`);
      return { applied: false, already_applied: true, database_name: databaseName };
    }
    if (!(await migrationRecordExists(connection, REQUIRED_ROLLBACK_RECORD))) {
      throw new Error("The required customer rollback record is missing.");
    }

    await connection.beginTransaction();
    transactionStarted = true;
    const financialBefore = await databaseFinancialSnapshot(connection);
    const undoByMerge = await loadUndoMetadataByMerge(connection);
    const mergeAudits = await loadMergeAudits(connection);
    const results = [];

    for (const mergeAudit of mergeAudits) {
      const lineage = buildLineage(mergeAudit, undoByMerge.get(Number(mergeAudit.id)) || {});
      results.push(await processLineage(connection, lineage));
    }

    const debtLinksRepaired = await synchronizeDebtOwnership(connection);
    const financialAfter = await databaseFinancialSnapshot(connection);
    assertFinancialSnapshotPreserved(financialBefore, financialAfter);

    const allReceipts = results.flatMap((result) => result.receipt_results || []);
    const summary = {
      recovery_date: RECOVERY_DATE,
      merge_audits_processed: mergeAudits.length,
      receipt_assignments_reviewed: allReceipts.length,
      sales_reassigned: allReceipts.reduce(
        (sum, receipt) => sum + Number(receipt.sale_updated || 0),
        0
      ),
      debts_reassigned: allReceipts.reduce(
        (sum, receipt) => sum + Number(receipt.debt_updated || 0),
        0
      ),
      installment_links_reassigned: allReceipts.reduce(
        (sum, receipt) => sum + Number(receipt.installment_updated || 0),
        0
      ),
      debt_links_synchronized: debtLinksRepaired,
      exact_name_target_assignments: allReceipts.filter(
        (receipt) => receipt.assignment_reason === "exact_name_original_target"
      ).length,
      exact_name_source_assignments: allReceipts.filter(
        (receipt) => receipt.assignment_reason === "exact_name_unique_source"
      ).length,
      previous_rollback_assignments: allReceipts.filter((receipt) =>
        String(receipt.assignment_reason).includes("previous_rollback")
      ).length,
      financial_snapshot_preserved: true,
      customer_profiles_deleted: 0,
      sale_amounts_changed: false,
      debt_amounts_changed: false,
      debt_payments_changed: false,
      phone_numbers_used_for_matching: false,
      fuzzy_name_matching_used: false,
    };

    await connection.query(
      `INSERT INTO activity_log (
         branch_id, user_id, action, details, workspace_code, entity_type,
         entity_id, action_type, outcome, severity, metadata_json
       ) VALUES (NULL, NULL, 'EXACT_NAME_RECEIPT_OWNER_RECOVERY_20260805', ?, 'spare_parts',
         'customer_debt_receipt_recovery', ?, 'EXACT_NAME_RECEIPT_OWNER_RECOVERY_20260805',
         'success', 'critical', ?)`,
      [
        "Reassigned every August 5 merge-affected receipt using its preserved exact customer name and original rollback assignment, without phone matching, fuzzy matching, money changes, payment changes, or customer deletion.",
        RECOVERY_RECORD,
        JSON.stringify({ summary, results, financial_before: financialBefore, financial_after: financialAfter }),
      ]
    );
    await connection.query(
      `INSERT INTO schema_migrations (migration_name, description) VALUES (?, ?)`,
      [RECOVERY_RECORD, JSON.stringify(summary)]
    );

    await connection.commit();
    transactionStarted = false;

    console.log(`Applied ${RECOVERY_RECORD} on ${databaseName}.`);
    console.log(JSON.stringify(summary));
    return { applied: true, database_name: databaseName, summary, results };
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
  runExactNameReceiptOwnerRecovery20260805().catch((error) => {
    console.error("Exact-name receipt owner recovery failed safely. No partial correction was saved.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  RECOVERY_DATE,
  RECOVERY_LOCK,
  RECOVERY_RECORD,
  chooseExactNameOwner,
  normalizeName,
  runExactNameReceiptOwnerRecovery20260805,
};
