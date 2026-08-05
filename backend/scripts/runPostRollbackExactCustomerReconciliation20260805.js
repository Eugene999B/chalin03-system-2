const mysql = require("mysql2/promise");
require("dotenv").config();

const RECOVERY_DATE = "2026-08-05";
const RECONCILIATION_RECORD = "20260805_post_rollback_exact_customer_reconciliation";
const RECONCILIATION_LOCK = "chalin03:customer-reconcile:20260805";
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

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("0")) digits = `233${digits.slice(1)}`;
  else if (digits.length === 9) digits = `233${digits}`;
  return digits.length >= 9 ? digits.slice(-12) : digits;
}

function levenshtein(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = old;
    }
  }
  return previous[b.length];
}

function nameSimilarity(left, right) {
  const a = normalizeName(left).replace(/\s+/g, "");
  const b = normalizeName(right).replace(/\s+/g, "");
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function profilesAreSafeMatch(left, right) {
  const leftPhone = normalizePhone(left.phone);
  const rightPhone = normalizePhone(right.phone);
  if (leftPhone && rightPhone) return leftPhone === rightPhone;
  const similarity = nameSimilarity(left.name, right.name);
  return similarity >= 0.88;
}

function safeIdentifier(value) {
  const identifier = String(value || "");
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) throw new Error("Unsafe database identifier.");
  return `\`${identifier}\``;
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

async function recordExists(connection) {
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [RECONCILIATION_RECORD]
  );
  return Number(row?.applied || 0) === 1;
}

async function loadAffectedLineages(connection) {
  const [rows] = await connection.query(
    `SELECT id, branch_id, entity_id, metadata_json, created_at
     FROM activity_log
     WHERE DATE(created_at) = ?
       AND (action = ? OR action_type = ?)
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [RECOVERY_DATE, MERGE_ACTION, MERGE_ACTION]
  );

  return rows.map((row) => {
    const metadata = parseMetadata(row.metadata_json);
    const targetId =
      positiveId(row.entity_id) ||
      positiveId(metadata.target_customer_after?.id) ||
      positiveId(metadata.target_customer_before?.id);
    const sourceIds = Array.isArray(metadata.source_customers)
      ? metadata.source_customers.map((profile) => positiveId(profile?.id)).filter(Boolean)
      : [];
    return {
      activityId: Number(row.id),
      branchId: positiveId(row.branch_id),
      targetId,
      customerIds: [...new Set([targetId, ...sourceIds].filter(Boolean))],
    };
  }).filter((row) => row.branchId && row.targetId && row.customerIds.length > 1);
}

async function loadCustomers(connection, branchId, customerIds) {
  const placeholders = customerIds.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT
       c.id,
       c.branch_id,
       c.name,
       c.phone,
       c.location,
       c.created_at,
       c.updated_at,
       COALESCE(s.sale_count, 0) AS sale_count,
       COALESCE(d.debt_count, 0) AS debt_count,
       COALESCE(d.active_debt_count, 0) AS active_debt_count
     FROM customers c
     LEFT JOIN (
       SELECT branch_id, customer_id, COUNT(*) AS sale_count
       FROM sales
       WHERE customer_id IS NOT NULL
       GROUP BY branch_id, customer_id
     ) s ON s.branch_id = c.branch_id AND s.customer_id = c.id
     LEFT JOIN (
       SELECT branch_id, customer_id, COUNT(*) AS debt_count,
              SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END) AS active_debt_count
       FROM debts
       WHERE customer_id IS NOT NULL
       GROUP BY branch_id, customer_id
     ) d ON d.branch_id = c.branch_id AND d.customer_id = c.id
     WHERE c.branch_id = ? AND c.id IN (${placeholders})
     ORDER BY c.id
     FOR UPDATE`,
    [branchId, ...customerIds]
  );
  return rows;
}

async function discoverReferences(connection) {
  const [rows] = await connection.query(
    `SELECT DISTINCT
       kcu.TABLE_NAME AS table_name,
       kcu.COLUMN_NAME AS column_name,
       CASE WHEN branch_column.COLUMN_NAME IS NULL THEN NULL ELSE 'branch_id' END AS branch_column
     FROM information_schema.KEY_COLUMN_USAGE kcu
     LEFT JOIN information_schema.COLUMNS branch_column
       ON branch_column.TABLE_SCHEMA = kcu.TABLE_SCHEMA
      AND branch_column.TABLE_NAME = kcu.TABLE_NAME
      AND branch_column.COLUMN_NAME = 'branch_id'
     WHERE kcu.TABLE_SCHEMA = DATABASE()
       AND kcu.REFERENCED_TABLE_SCHEMA = DATABASE()
       AND kcu.REFERENCED_TABLE_NAME = 'customers'
       AND kcu.REFERENCED_COLUMN_NAME = 'id'
       AND kcu.TABLE_NAME <> 'customers'`
  );
  return rows.map((row) => ({
    table: row.table_name,
    column: row.column_name,
    branchColumn: row.branch_column || null,
  }));
}

async function updateReference(connection, spec, branchId, targetId, sourceIds) {
  const placeholders = sourceIds.map(() => "?").join(",");
  const table = safeIdentifier(spec.table);
  const column = safeIdentifier(spec.column);
  const params = [targetId];
  let where = `${column} IN (${placeholders})`;
  if (spec.branchColumn) {
    where = `${safeIdentifier(spec.branchColumn)} = ? AND ${where}`;
    params.push(branchId);
  }
  params.push(...sourceIds);
  const [result] = await connection.query(
    `UPDATE ${table} SET ${column} = ? WHERE ${where}`,
    params
  );
  return Number(result.affectedRows || 0);
}

function chooseCanonical(customers, preferredTargetId) {
  return [...customers].sort((left, right) => {
    const leftPreferred = Number(left.id) === Number(preferredTargetId) ? 1 : 0;
    const rightPreferred = Number(right.id) === Number(preferredTargetId) ? 1 : 0;
    if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
    const leftActivity = Number(left.sale_count || 0) + Number(left.debt_count || 0);
    const rightActivity = Number(right.sale_count || 0) + Number(right.debt_count || 0);
    if (leftActivity !== rightActivity) return rightActivity - leftActivity;
    return Number(left.id) - Number(right.id);
  })[0];
}

function compatibleCluster(customers, targetId) {
  const target = customers.find((customer) => Number(customer.id) === Number(targetId));
  if (!target) return [];
  return customers.filter((customer) => {
    if (Number(customer.id) === Number(target.id)) return true;
    return profilesAreSafeMatch(target, customer);
  });
}

async function reconcileLineage(connection, references, lineage) {
  const customers = await loadCustomers(connection, lineage.branchId, lineage.customerIds);
  const cluster = compatibleCluster(customers, lineage.targetId);
  if (cluster.length < 2) {
    return {
      merge_activity_id: lineage.activityId,
      branch_id: lineage.branchId,
      status: "no_safe_duplicate_cluster",
      inspected_customer_ids: customers.map((customer) => Number(customer.id)),
    };
  }

  const canonical = chooseCanonical(cluster, lineage.targetId);
  const sourceIds = cluster
    .map((customer) => Number(customer.id))
    .filter((id) => id !== Number(canonical.id));
  const before = {
    sale_count: cluster.reduce((sum, row) => sum + Number(row.sale_count || 0), 0),
    debt_count: cluster.reduce((sum, row) => sum + Number(row.debt_count || 0), 0),
    active_debt_count: cluster.reduce((sum, row) => sum + Number(row.active_debt_count || 0), 0),
  };

  const referenceUpdates = [];
  for (const reference of references) {
    const affectedRows = await updateReference(
      connection,
      reference,
      lineage.branchId,
      Number(canonical.id),
      sourceIds
    );
    referenceUpdates.push({ ...reference, affected_rows: affectedRows });
  }

  const placeholders = sourceIds.map(() => "?").join(",");
  const [deleteResult] = await connection.query(
    `DELETE FROM customers WHERE branch_id = ? AND id IN (${placeholders})`,
    [lineage.branchId, ...sourceIds]
  );

  const [[after]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM sales WHERE branch_id = ? AND customer_id = ?) AS sale_count,
       (SELECT COUNT(*) FROM debts WHERE branch_id = ? AND customer_id = ?) AS debt_count,
       (SELECT COUNT(*) FROM debts WHERE branch_id = ? AND customer_id = ? AND balance > 0) AS active_debt_count`,
    [
      lineage.branchId,
      canonical.id,
      lineage.branchId,
      canonical.id,
      lineage.branchId,
      canonical.id,
    ]
  );

  if (
    Number(after.sale_count || 0) < before.sale_count ||
    Number(after.debt_count || 0) < before.debt_count ||
    Number(after.active_debt_count || 0) < before.active_debt_count
  ) {
    throw new Error(`Customer reconciliation verification failed for merge audit ${lineage.activityId}.`);
  }

  return {
    merge_activity_id: lineage.activityId,
    branch_id: lineage.branchId,
    status: "reconciled",
    canonical_customer_id: Number(canonical.id),
    canonical_customer_name: canonical.name,
    canonical_customer_phone: canonical.phone,
    source_customer_ids: sourceIds,
    source_customers_deleted: Number(deleteResult.affectedRows || 0),
    before,
    after: {
      sale_count: Number(after.sale_count || 0),
      debt_count: Number(after.debt_count || 0),
      active_debt_count: Number(after.active_debt_count || 0),
    },
    reference_updates: referenceUpdates,
  };
}

async function verifyDebtOwnership(connection) {
  const [repair] = await connection.query(
    `UPDATE debts d
     INNER JOIN sales s ON s.id = d.sale_id AND s.branch_id = d.branch_id
     SET d.customer_id = s.customer_id
     WHERE s.customer_id IS NOT NULL
       AND (d.customer_id IS NULL OR d.customer_id <> s.customer_id)`
  );
  const [[remaining]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM debts d
     INNER JOIN sales s ON s.id = d.sale_id AND s.branch_id = d.branch_id
     WHERE s.customer_id IS NOT NULL
       AND (d.customer_id IS NULL OR d.customer_id <> s.customer_id)`
  );
  return {
    repaired: Number(repair.affectedRows || 0),
    remaining: Number(remaining.total || 0),
  };
}

async function runPostRollbackExactCustomerReconciliation20260805() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    console.log(`${RECONCILIATION_RECORD} skipped outside production.`);
    return { skipped: true, reason: "non-production" };
  }

  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  let transactionStarted = false;
  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 60) AS acquired", [
      RECONCILIATION_LOCK,
    ]);
    lockAcquired = Number(lock?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire customer reconciliation lock.");

    if (await recordExists(connection)) {
      console.log(`${RECONCILIATION_RECORD} was already applied on ${databaseName}.`);
      return { applied: false, already_applied: true, database_name: databaseName };
    }

    await connection.beginTransaction();
    transactionStarted = true;
    const lineages = await loadAffectedLineages(connection);
    const references = await discoverReferences(connection);
    const results = [];
    for (const lineage of lineages) {
      results.push(await reconcileLineage(connection, references, lineage));
    }
    const debtOwnership = await verifyDebtOwnership(connection);
    const summary = {
      recovery_date: RECOVERY_DATE,
      lineages_inspected: lineages.length,
      duplicate_clusters_reconciled: results.filter((row) => row.status === "reconciled").length,
      lineages_left_unchanged: results.filter((row) => row.status !== "reconciled").length,
      sales_now_under_reconciled_accounts: results.reduce(
        (sum, row) => sum + Number(row.after?.sale_count || 0),
        0
      ),
      debts_now_under_reconciled_accounts: results.reduce(
        (sum, row) => sum + Number(row.after?.debt_count || 0),
        0
      ),
      active_debts_now_under_reconciled_accounts: results.reduce(
        (sum, row) => sum + Number(row.after?.active_debt_count || 0),
        0
      ),
      debt_ownership: debtOwnership,
      sale_amounts_changed: false,
      debt_amounts_changed: false,
      debt_payments_changed: false,
    };

    await connection.query(
      `INSERT INTO activity_log (
         branch_id, user_id, action, details, workspace_code, entity_type,
         entity_id, action_type, outcome, severity, metadata_json
       ) VALUES (NULL, NULL, 'POST_ROLLBACK_CUSTOMER_RECONCILIATION_20260805', ?, 'spare_parts',
         'customer_identity_reconciliation', ?, 'POST_ROLLBACK_CUSTOMER_RECONCILIATION_20260805',
         'success', 'critical', ?)`,
      [
        "Reunited only strong duplicate customer identities split by the August 5 rollback; all monetary and payment values were preserved.",
        RECONCILIATION_RECORD,
        JSON.stringify({ summary, results }),
      ]
    );
    await connection.query(
      `INSERT INTO schema_migrations (migration_name, description) VALUES (?, ?)`,
      [RECONCILIATION_RECORD, JSON.stringify(summary)]
    );
    await connection.commit();
    transactionStarted = false;

    console.log(`Applied ${RECONCILIATION_RECORD} on ${databaseName}.`);
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
        await connection.query("SELECT RELEASE_LOCK(?)", [RECONCILIATION_LOCK]);
      } catch {}
    }
    await connection.end();
  }
}

if (require.main === module) {
  runPostRollbackExactCustomerReconciliation20260805().catch((error) => {
    console.error("Post-rollback customer reconciliation failed safely. No partial correction was saved.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  RECONCILIATION_LOCK,
  RECONCILIATION_RECORD,
  nameSimilarity,
  normalizeName,
  normalizePhone,
  profilesAreSafeMatch,
  runPostRollbackExactCustomerReconciliation20260805,
};
