const mysql = require("mysql2/promise");
require("dotenv").config();

const RECOVERY_DATE = "2026-08-05";
const RECONCILIATION_RECORD = "20260805_post_rollback_debt_account_reconciliation";
const RECONCILIATION_LOCK = "chalin03:debt-account-reconcile:20260805";
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
  return nameSimilarity(left.name, right.name) >= 0.88;
}

class UnionFind {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]));
  }
  find(id) {
    const parent = this.parent.get(id);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }
  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent.set(rightRoot, leftRoot);
  }
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
  const [[table]] = await connection.query(
    "SELECT COUNT(*) AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'"
  );
  if (Number(table?.present || 0) !== 1) throw new Error("The required schema_migrations table is missing.");
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [RECONCILIATION_RECORD]
  );
  return Number(row?.applied || 0) === 1;
}

async function tableHasColumns(connection, tableName, columns) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));
  return columns.every((column) => existing.has(column));
}

async function loadLineages(connection) {
  const [mergeRows] = await connection.query(
    `SELECT id, branch_id, entity_id, metadata_json, created_at
     FROM activity_log
     WHERE DATE(created_at) = ?
       AND (action = ? OR action_type = ?)
     ORDER BY created_at DESC, id DESC
     FOR UPDATE`,
    [RECOVERY_DATE, MERGE_ACTION, MERGE_ACTION]
  );
  const [undoRows] = await connection.query(
    `SELECT branch_id, metadata_json, created_at
     FROM activity_log
     WHERE DATE(created_at) = ?
       AND (action = ? OR action_type = ?)
     ORDER BY created_at DESC, id DESC
     FOR UPDATE`,
    [RECOVERY_DATE, UNDO_ACTION, UNDO_ACTION]
  );

  const actualRestored = new Map();
  for (const row of undoRows) {
    const metadata = parseMetadata(row.metadata_json);
    const mergeId = positiveId(metadata.original_merge_activity_id);
    if (!mergeId) continue;
    const restoredIds = Array.isArray(metadata.restored_source_customers)
      ? metadata.restored_source_customers
          .map((item) => positiveId(item.customerId || item.customer_id || item.restored_customer_id))
          .filter(Boolean)
      : [];
    actualRestored.set(mergeId, restoredIds);
  }

  return mergeRows
    .map((row) => {
      const metadata = parseMetadata(row.metadata_json);
      const targetId =
        positiveId(row.entity_id) ||
        positiveId(metadata.target_customer_after?.id) ||
        positiveId(metadata.target_customer_before?.id);
      const originalSources = Array.isArray(metadata.source_customers)
        ? metadata.source_customers.map((profile) => positiveId(profile?.id)).filter(Boolean)
        : [];
      const sourceIds = actualRestored.get(Number(row.id)) || originalSources;
      return {
        mergeActivityId: Number(row.id),
        branchId: positiveId(row.branch_id),
        targetId,
        customerIds: [...new Set([targetId, ...sourceIds].filter(Boolean))],
        createdAt: row.created_at,
      };
    })
    .filter((row) => row.branchId && row.targetId && row.customerIds.length > 1);
}

async function loadCustomers(connection, branchId, ids) {
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT
       c.id, c.branch_id, c.name, c.phone, c.location,
       COALESCE(s.sale_count, 0) AS sale_count,
       COALESCE(d.debt_count, 0) AS debt_count,
       COALESCE(d.active_debt_count, 0) AS active_debt_count
     FROM customers c
     LEFT JOIN (
       SELECT branch_id, customer_id, COUNT(*) AS sale_count
       FROM sales WHERE customer_id IS NOT NULL GROUP BY branch_id, customer_id
     ) s ON s.branch_id = c.branch_id AND s.customer_id = c.id
     LEFT JOIN (
       SELECT branch_id, customer_id, COUNT(*) AS debt_count,
              SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END) AS active_debt_count
       FROM debts WHERE customer_id IS NOT NULL GROUP BY branch_id, customer_id
     ) d ON d.branch_id = c.branch_id AND d.customer_id = c.id
     WHERE c.branch_id = ? AND c.id IN (${placeholders})
     ORDER BY c.id
     FOR UPDATE`,
    [branchId, ...ids]
  );
  return rows;
}

function chooseCanonical(group, lineages) {
  const groupIds = new Set(group.map((row) => Number(row.id)));
  const preferred = lineages.find((lineage) => groupIds.has(Number(lineage.targetId)));
  if (preferred) return group.find((row) => Number(row.id) === Number(preferred.targetId));
  return [...group].sort((left, right) => {
    const leftActivity = Number(left.sale_count || 0) + Number(left.debt_count || 0);
    const rightActivity = Number(right.sale_count || 0) + Number(right.debt_count || 0);
    if (leftActivity !== rightActivity) return rightActivity - leftActivity;
    return Number(left.id) - Number(right.id);
  })[0];
}

async function reconcileBranch(connection, branchId, lineages) {
  const affectedIds = [...new Set(lineages.flatMap((lineage) => lineage.customerIds))];
  const customers = await loadCustomers(connection, branchId, affectedIds);
  const byId = new Map(customers.map((row) => [Number(row.id), row]));
  const union = new UnionFind(customers.map((row) => Number(row.id)));

  for (const lineage of lineages) {
    const members = lineage.customerIds.map((id) => byId.get(Number(id))).filter(Boolean);
    for (let left = 0; left < members.length; left += 1) {
      for (let right = left + 1; right < members.length; right += 1) {
        if (profilesAreSafeMatch(members[left], members[right])) {
          union.union(Number(members[left].id), Number(members[right].id));
        }
      }
    }
  }

  const grouped = new Map();
  for (const customer of customers) {
    const root = union.find(Number(customer.id));
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(customer);
  }

  const results = [];
  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    const canonical = chooseCanonical(group, lineages);
    const sourceIds = group
      .map((row) => Number(row.id))
      .filter((id) => id !== Number(canonical.id));
    const before = {
      sale_count: group.reduce((sum, row) => sum + Number(row.sale_count || 0), 0),
      debt_count: group.reduce((sum, row) => sum + Number(row.debt_count || 0), 0),
      active_debt_count: group.reduce((sum, row) => sum + Number(row.active_debt_count || 0), 0),
    };
    const placeholders = sourceIds.map(() => "?").join(",");
    const [sales] = await connection.query(
      `UPDATE sales SET customer_id = ? WHERE branch_id = ? AND customer_id IN (${placeholders})`,
      [canonical.id, branchId, ...sourceIds]
    );
    const [debts] = await connection.query(
      `UPDATE debts SET customer_id = ? WHERE branch_id = ? AND customer_id IN (${placeholders})`,
      [canonical.id, branchId, ...sourceIds]
    );
    let installmentsAffected = 0;
    if (
      await tableHasColumns(connection, "installment_agreements", [
        "branch_id",
        "customer_id",
      ])
    ) {
      const [installments] = await connection.query(
        `UPDATE installment_agreements
         SET customer_id = ?
         WHERE branch_id = ? AND customer_id IN (${placeholders})`,
        [canonical.id, branchId, ...sourceIds]
      );
      installmentsAffected = Number(installments.affectedRows || 0);
    }

    const [[after]] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM sales WHERE branch_id = ? AND customer_id = ?) AS sale_count,
         (SELECT COUNT(*) FROM debts WHERE branch_id = ? AND customer_id = ?) AS debt_count,
         (SELECT COUNT(*) FROM debts WHERE branch_id = ? AND customer_id = ? AND balance > 0) AS active_debt_count`,
      [branchId, canonical.id, branchId, canonical.id, branchId, canonical.id]
    );
    if (
      Number(after.sale_count || 0) < before.sale_count ||
      Number(after.debt_count || 0) < before.debt_count ||
      Number(after.active_debt_count || 0) < before.active_debt_count
    ) {
      throw new Error(`Debt-account verification failed for customer ${canonical.id}.`);
    }

    results.push({
      branch_id: branchId,
      canonical_customer_id: Number(canonical.id),
      canonical_customer_name: canonical.name,
      canonical_customer_phone: canonical.phone,
      source_customer_ids: sourceIds,
      sales_reassigned: Number(sales.affectedRows || 0),
      debts_reassigned: Number(debts.affectedRows || 0),
      installments_reassigned: installmentsAffected,
      before,
      after: {
        sale_count: Number(after.sale_count || 0),
        debt_count: Number(after.debt_count || 0),
        active_debt_count: Number(after.active_debt_count || 0),
      },
      source_profiles_preserved: true,
    });
  }
  return results;
}

async function synchronizeDebtOwnership(connection) {
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

async function runPostRollbackDebtAccountReconciliation20260805() {
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
    if (!lockAcquired) throw new Error("Could not acquire debt-account reconciliation lock.");

    if (await recordExists(connection)) {
      console.log(`${RECONCILIATION_RECORD} was already applied on ${databaseName}.`);
      return { applied: false, already_applied: true, database_name: databaseName };
    }

    await connection.beginTransaction();
    transactionStarted = true;
    const lineages = await loadLineages(connection);
    const byBranch = new Map();
    for (const lineage of lineages) {
      if (!byBranch.has(lineage.branchId)) byBranch.set(lineage.branchId, []);
      byBranch.get(lineage.branchId).push(lineage);
    }

    const results = [];
    for (const [branchId, branchLineages] of byBranch.entries()) {
      results.push(...(await reconcileBranch(connection, branchId, branchLineages)));
    }
    const debtOwnership = await synchronizeDebtOwnership(connection);
    const summary = {
      recovery_date: RECOVERY_DATE,
      merge_lineages_inspected: lineages.length,
      customer_groups_reconciled: results.length,
      sales_reassigned: results.reduce((sum, row) => sum + row.sales_reassigned, 0),
      debts_reassigned: results.reduce((sum, row) => sum + row.debts_reassigned, 0),
      active_debts_under_reconciled_accounts: results.reduce(
        (sum, row) => sum + row.after.active_debt_count,
        0
      ),
      debt_ownership: debtOwnership,
      customer_profiles_deleted: 0,
      sale_amounts_changed: false,
      debt_amounts_changed: false,
      debt_payments_changed: false,
    };

    await connection.query(
      `INSERT INTO activity_log (
         branch_id, user_id, action, details, workspace_code, entity_type,
         entity_id, action_type, outcome, severity, metadata_json
       ) VALUES (NULL, NULL, 'POST_ROLLBACK_DEBT_ACCOUNT_RECONCILIATION_20260805', ?, 'spare_parts',
         'customer_debt_account_reconciliation', ?, 'POST_ROLLBACK_DEBT_ACCOUNT_RECONCILIATION_20260805',
         'success', 'critical', ?)`,
      [
        "Reunited strongly matching customer accounts split by the August 5 rollback without deleting profiles or changing money or payments.",
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
  runPostRollbackDebtAccountReconciliation20260805().catch((error) => {
    console.error("Post-rollback debt-account reconciliation failed safely. No partial correction was saved.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  RECONCILIATION_LOCK,
  RECONCILIATION_RECORD,
  UnionFind,
  nameSimilarity,
  normalizeName,
  normalizePhone,
  profilesAreSafeMatch,
  runPostRollbackDebtAccountReconciliation20260805,
};
