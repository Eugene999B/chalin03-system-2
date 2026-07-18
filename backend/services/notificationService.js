const { pool } = require("../config/db");
const { hasPermission, normalizeCode, normalizeRole } = require("../security/permissionCatalog");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");

const WORKSPACES = new Set(["group", "spare_parts", "mining", "equipment_hire"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function wholeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function workspaceCode(req) {
  const code = normalizeCode(
    req.user?.workspace_code ||
      req.user?.active_workspace?.code ||
      req.headers["x-chalin03-workspace"] ||
      "spare_parts"
  );
  return WORKSPACES.has(code) ? code : "spare_parts";
}

function selectedContextId(req) {
  return positiveId(
    req.headers["x-chalin03-context-id"] ||
      req.query?.context_id ||
      req.body?.context_id
  );
}

function branchId(req) {
  return positiveId(
    req.user?.branch_id ||
      req.user?.default_branch_id ||
      req.headers["x-chalin03-branch-id"]
  );
}

function roleCodes(req) {
  return [
    normalizeRole(req.user?.workspace_role || req.user?.access_role),
    normalizeRole(req.user?.role),
  ].filter(Boolean);
}

function isAdmin(req) {
  return normalizeRole(req.user?.role) === "admin";
}

function severityRank(value) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[cleanText(value, 20).toLowerCase()] ?? 9;
}

async function tableExists(tableName, connection = pool) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function getRuleMap(connection = pool) {
  const [rows] = await connection.query(
    `SELECT * FROM notification_rules WHERE is_enabled = TRUE`
  );
  return Object.fromEntries(rows.map((row) => [row.rule_code, row]));
}

async function upsertNotification(item, rule, connection = pool) {
  const workspace = WORKSPACES.has(item.workspace_code)
    ? item.workspace_code
    : rule?.workspace_code || "group";
  const severity = SEVERITIES.has(item.severity)
    ? item.severity
    : rule?.default_severity || "medium";
  const metadata = item.metadata ? JSON.stringify(item.metadata) : null;

  const [result] = await connection.query(
    `INSERT INTO notifications (
       notification_key, rule_id, rule_code, workspace_code,
       branch_id, mining_site_id, hire_location_id,
       target_user_id, target_role, target_permission,
       category, notification_type, severity, title, message,
       action_path, source_type, source_id, source_reference,
       status, auto_generated, occurred_at, due_at,
       metadata_json, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', TRUE, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       rule_id = VALUES(rule_id),
       workspace_code = VALUES(workspace_code),
       branch_id = VALUES(branch_id),
       mining_site_id = VALUES(mining_site_id),
       hire_location_id = VALUES(hire_location_id),
       target_user_id = VALUES(target_user_id),
       target_role = VALUES(target_role),
       target_permission = VALUES(target_permission),
       category = VALUES(category),
       notification_type = VALUES(notification_type),
       severity = VALUES(severity),
       title = VALUES(title),
       message = VALUES(message),
       action_path = VALUES(action_path),
       source_type = VALUES(source_type),
       source_id = VALUES(source_id),
       source_reference = VALUES(source_reference),
       status = 'active',
       due_at = VALUES(due_at),
       resolved_at = NULL,
       resolved_by = NULL,
       resolution_note = NULL,
       metadata_json = VALUES(metadata_json),
       last_detected_at = NOW(),
       updated_at = NOW()`,
    [
      cleanText(item.notification_key, 191),
      rule?.id || null,
      cleanText(rule?.rule_code || item.rule_code, 120) || null,
      workspace,
      positiveId(item.branch_id),
      positiveId(item.mining_site_id),
      positiveId(item.hire_location_id),
      positiveId(item.target_user_id),
      cleanText(item.target_role || rule?.target_role, 60) || null,
      cleanText(item.target_permission || rule?.target_permission, 120) || null,
      cleanText(item.category || rule?.category || "operations", 60),
      cleanText(item.notification_type || "alert", 60),
      severity,
      cleanText(item.title, 220),
      cleanText(item.message, 1200),
      cleanText(item.action_path, 500) || null,
      cleanText(item.source_type, 80) || null,
      positiveId(item.source_id),
      cleanText(item.source_reference, 180) || null,
      item.occurred_at || new Date(),
      item.due_at || null,
      metadata,
      positiveId(item.created_by),
    ]
  );

  return Number(result.affectedRows || 0) > 0;
}

async function syncRule(ruleCode, rows, mapper, rules, connection) {
  const rule = rules[ruleCode];
  if (!rule) return { generated: 0, resolved: 0, skipped: true };

  const currentKeys = new Set();
  let generated = 0;

  for (const row of rows) {
    const item = mapper(row);
    if (!item?.notification_key || !item?.title || !item?.message) continue;

    const notificationKey = cleanText(item.notification_key, 191);
    currentKeys.add(notificationKey);
    await upsertNotification({ ...item, notification_key: notificationKey }, rule, connection);
    generated += 1;
  }

  const [activeRows] = await connection.query(
    `SELECT id, notification_key
     FROM notifications
     WHERE rule_code = ?
       AND auto_generated = TRUE
       AND status = 'active'`,
    [ruleCode]
  );

  const staleIds = activeRows
    .filter((row) => !currentKeys.has(row.notification_key))
    .map((row) => positiveId(row.id))
    .filter(Boolean);

  let resolved = 0;
  for (let index = 0; index < staleIds.length; index += 200) {
    const ids = staleIds.slice(index, index + 200);
    const placeholders = ids.map(() => "?").join(", ");
    const [result] = await connection.query(
      `UPDATE notifications
       SET status = 'resolved',
           resolved_at = NOW(),
           resolved_by = NULL,
           resolution_note = 'Condition cleared by notification sync.',
           updated_at = NOW()
       WHERE id IN (${placeholders})
         AND status = 'active'`,
      ids
    );
    resolved += Number(result.affectedRows || 0);
  }

  return { generated, resolved, skipped: false };
}

async function syncSpareParts(rules, connection) {
  const results = [];

  if (await tableExists("products", connection)) {
    const [rows] = await connection.query(
      `SELECT id, branch_id, name AS product_name, quantity, low_stock_threshold AS low_stock_level
       FROM products
       WHERE is_active = TRUE
         AND low_stock_threshold IS NOT NULL
         AND quantity <= low_stock_threshold`
    );
    results.push(
      await syncRule(
        "spare_parts.low_stock",
        rows,
        (row) => ({
          notification_key: `spare_parts.low_stock.${row.id}`,
          workspace_code: "spare_parts",
          branch_id: row.branch_id,
          severity: numeric(row.quantity) <= 0 ? "critical" : "medium",
          title: `Low stock: ${row.product_name}`,
          message: `Quantity ${numeric(row.quantity)} is at or below the restock level ${numeric(row.low_stock_level)}.`,
          action_path: "/low-stock",
          source_type: "product",
          source_id: row.id,
          source_reference: row.product_name,
          metadata: { quantity: numeric(row.quantity), low_stock_level: numeric(row.low_stock_level) },
        }),
        rules,
        connection
      )
    );
  }

  if (await tableExists("debts", connection)) {
    const [rows] = await connection.query(
      `SELECT d.id, d.branch_id, d.customer_id, d.balance, d.due_date, d.customer_name
       FROM debts d
       WHERE d.balance > 0
         AND d.due_date IS NOT NULL
         AND d.due_date < CURDATE()
         AND LOWER(COALESCE(d.status, 'active')) NOT IN ('paid', 'void', 'cancelled')`
    );
    results.push(
      await syncRule(
        "spare_parts.overdue_debt",
        rows,
        (row) => ({
          notification_key: `spare_parts.overdue_debt.${row.id}`,
          workspace_code: "spare_parts",
          branch_id: row.branch_id,
          severity: "high",
          title: `Overdue debt: ${row.customer_name}`,
          message: `Outstanding balance GHS ${numeric(row.balance).toFixed(2)} was due on ${String(row.due_date).slice(0, 10)}.`,
          action_path: "/debts",
          source_type: "debt",
          source_id: row.id,
          source_reference: row.customer_name,
          due_at: row.due_date,
        }),
        rules,
        connection
      )
    );
  }

  return results;
}

async function syncMining(rules, connection) {
  const results = [];

  if (await tableExists("mining_stockpiles", connection)) {
    const [rows] = await connection.query(
      `SELECT id, site_id, stockpile_code, stockpile_name, unit,
              current_quantity, minimum_quantity
       FROM mining_stockpiles
       WHERE status = 'active'
         AND minimum_quantity > 0
         AND current_quantity <= minimum_quantity`
    );
    results.push(await syncRule("mining.stockpile_low", rows, (row) => ({
      notification_key: `mining.stockpile_low.${row.id}`,
      workspace_code: "mining",
      mining_site_id: row.site_id,
      severity: numeric(row.current_quantity) <= 0 ? "critical" : "high",
      title: `Low stockpile: ${row.stockpile_name}`,
      message: `${numeric(row.current_quantity).toFixed(3)} ${row.unit} remains; minimum level is ${numeric(row.minimum_quantity).toFixed(3)} ${row.unit}.`,
      action_path: "/mining/control-centre?tab=stockpiles",
      source_type: "mining_stockpile",
      source_id: row.id,
      source_reference: row.stockpile_code,
    }), rules, connection));
  }

  if (await tableExists("mining_fuel_tanks", connection)) {
    const [rows] = await connection.query(
      `SELECT id, site_id, tank_code, tank_name, current_balance_litres, minimum_level_litres
       FROM mining_fuel_tanks
       WHERE status = 'active'
         AND minimum_level_litres > 0
         AND current_balance_litres <= minimum_level_litres`
    );
    results.push(await syncRule("mining.fuel_tank_low", rows, (row) => ({
      notification_key: `mining.fuel_tank_low.${row.id}`,
      workspace_code: "mining",
      mining_site_id: row.site_id,
      severity: numeric(row.current_balance_litres) <= 0 ? "critical" : "high",
      title: `Low fuel tank: ${row.tank_name}`,
      message: `${numeric(row.current_balance_litres).toFixed(2)} litres remains; minimum level is ${numeric(row.minimum_level_litres).toFixed(2)} litres.`,
      action_path: "/mining/control-centre?tab=fuel",
      source_type: "mining_fuel_tank",
      source_id: row.id,
      source_reference: row.tank_code,
    }), rules, connection));
  }

  if (await tableExists("mining_dispatches", connection)) {
    const [rows] = await connection.query(
      `SELECT id, site_id, dispatch_number, quantity, unit, destination, created_at
       FROM mining_dispatches
       WHERE status = 'submitted'`
    );
    results.push(await syncRule("mining.dispatch_pending", rows, (row) => ({
      notification_key: `mining.dispatch_pending.${row.id}`,
      workspace_code: "mining",
      mining_site_id: row.site_id,
      title: `Dispatch approval: ${row.dispatch_number}`,
      message: `${numeric(row.quantity).toFixed(3)} ${row.unit} to ${row.destination} is awaiting independent approval.`,
      action_path: "/mining/control-centre?tab=dispatch",
      source_type: "mining_dispatch",
      source_id: row.id,
      source_reference: row.dispatch_number,
      occurred_at: row.created_at,
    }), rules, connection));
  }

  if (await tableExists("mining_fuel_reconciliations", connection)) {
    const [rows] = await connection.query(
      `SELECT id, site_id, reconciliation_number, variance_litres, variance_percent,
              reconciliation_datetime, status
       FROM mining_fuel_reconciliations
       WHERE status = 'submitted' OR ABS(variance_percent) >= 2`
    );
    results.push(await syncRule("mining.fuel_variance", rows, (row) => {
      const percent = Math.abs(numeric(row.variance_percent));
      return {
        notification_key: `mining.fuel_variance.${row.id}`,
        workspace_code: "mining",
        mining_site_id: row.site_id,
        severity: percent >= 5 ? "critical" : percent >= 2 ? "high" : "medium",
        title: `Fuel reconciliation: ${row.reconciliation_number}`,
        message: `Variance ${numeric(row.variance_litres).toFixed(2)} litres (${numeric(row.variance_percent).toFixed(2)}%). Status: ${row.status}.`,
        action_path: "/mining/control-centre?tab=fuel",
        source_type: "mining_fuel_reconciliation",
        source_id: row.id,
        source_reference: row.reconciliation_number,
        occurred_at: row.reconciliation_datetime,
      };
    }, rules, connection));
  }

  if (await tableExists("mining_site_closings", connection)) {
    const [rows] = await connection.query(
      `SELECT id, site_id, closing_number, period_start, period_end, status, created_at
       FROM mining_site_closings
       WHERE status = 'submitted'`
    );
    results.push(await syncRule("mining.closing_pending", rows, (row) => ({
      notification_key: `mining.closing_pending.${row.id}`,
      workspace_code: "mining",
      mining_site_id: row.site_id,
      title: `Site closing approval: ${row.closing_number}`,
      message: `Mining site closing for ${String(row.period_start).slice(0, 10)} to ${String(row.period_end).slice(0, 10)} is awaiting independent approval.`,
      action_path: "/mining/control-centre?tab=closing",
      source_type: "mining_site_closing",
      source_id: row.id,
      source_reference: row.closing_number,
      occurred_at: row.created_at,
    }), rules, connection));
  }

  if (await tableExists("mining_incidents", connection)) {
    const [rows] = await connection.query(
      `SELECT id, site_id, incident_type, severity, description, status, incident_datetime
       FROM mining_incidents
       WHERE status IN ('open', 'investigating')
         AND LOWER(severity) IN ('critical', 'serious', 'high')`
    );
    results.push(await syncRule("mining.incident_open", rows, (row) => ({
      notification_key: `mining.incident_open.${row.id}`,
      workspace_code: "mining",
      mining_site_id: row.site_id,
      severity: ["critical", "serious"].includes(String(row.severity).toLowerCase()) ? "critical" : "high",
      title: `Open Mining incident: ${row.incident_type}`,
      message: `${cleanText(row.description, 800)} Status: ${row.status}.`,
      action_path: "/mining/incidents",
      source_type: "mining_incident",
      source_id: row.id,
      source_reference: row.incident_type,
      occurred_at: row.incident_datetime,
    }), rules, connection));
  }

  return results;
}

async function syncHire(rules, connection) {
  const results = [];

  if (await tableExists("hire_invoices", connection)) {
    const [rows] = await connection.query(
      `SELECT hi.id, hi.hire_location_id, hi.invoice_number, hi.balance, hi.due_date,
              hc.contract_number, hcu.customer_name
       FROM hire_invoices hi
       INNER JOIN hire_contracts hc ON hc.id = hi.contract_id
       INNER JOIN hire_customers hcu ON hcu.id = hi.customer_id
       WHERE hi.status <> 'void'
         AND hi.balance > 0
         AND hi.due_date IS NOT NULL
         AND hi.due_date < CURDATE()`
    );
    results.push(await syncRule("hire.invoice_overdue", rows, (row) => ({
      notification_key: `hire.invoice_overdue.${row.id}`,
      workspace_code: "equipment_hire",
      hire_location_id: row.hire_location_id,
      severity: "high",
      title: `Overdue invoice: ${row.invoice_number}`,
      message: `${row.customer_name} owes GHS ${numeric(row.balance).toFixed(2)} on contract ${row.contract_number}; due ${String(row.due_date).slice(0, 10)}.`,
      action_path: "/equipment-hire-operations/finance",
      source_type: "hire_invoice",
      source_id: row.id,
      source_reference: row.invoice_number,
      due_at: row.due_date,
    }), rules, connection));
  }

  if (await tableExists("hire_contracts", connection)) {
    const [rows] = await connection.query(
      `SELECT hc.id, hc.hire_location_id, hc.contract_number, hc.expected_end_date,
              hc.status, hcu.customer_name
       FROM hire_contracts hc
       INNER JOIN hire_customers hcu ON hcu.id = hc.customer_id
       WHERE hc.status IN ('confirmed', 'mobilizing', 'active', 'suspended')
         AND hc.expected_end_date IS NOT NULL
         AND hc.expected_end_date < CURDATE()`
    );
    results.push(await syncRule("hire.contract_overdue", rows, (row) => ({
      notification_key: `hire.contract_overdue.${row.id}`,
      workspace_code: "equipment_hire",
      hire_location_id: row.hire_location_id,
      severity: "high",
      title: `Contract overdue: ${row.contract_number}`,
      message: `${row.customer_name} contract passed its expected end date ${String(row.expected_end_date).slice(0, 10)} and remains ${row.status}.`,
      action_path: "/equipment-hire-operations/contracts",
      source_type: "hire_contract",
      source_id: row.id,
      source_reference: row.contract_number,
      due_at: row.expected_end_date,
    }), rules, connection));
  }

  if (await tableExists("hire_commercial_approvals", connection)) {
    const [rows] = await connection.query(
      `SELECT id, hire_location_id, approval_number, approval_type, entity_type,
              requested_amount, reason, created_at
       FROM hire_commercial_approvals
       WHERE status = 'pending'`
    );
    results.push(await syncRule("hire.approval_pending", rows, (row) => ({
      notification_key: `hire.approval_pending.${row.id}`,
      workspace_code: "equipment_hire",
      hire_location_id: row.hire_location_id,
      title: `Commercial approval: ${row.approval_number}`,
      message: `${row.approval_type} for ${row.entity_type} is pending. Amount GHS ${numeric(row.requested_amount).toFixed(2)}. ${cleanText(row.reason, 500)}`,
      action_path: "/equipment-hire-operations/commercial-control?tab=approvals",
      source_type: "hire_commercial_approval",
      source_id: row.id,
      source_reference: row.approval_number,
      occurred_at: row.created_at,
    }), rules, connection));
  }

  if (await tableExists("hire_deposit_transactions", connection)) {
    const [rows] = await connection.query(
      `SELECT id, hire_location_id, transaction_number, transaction_type,
              amount, reason, created_at
       FROM hire_deposit_transactions
       WHERE status = 'pending_approval'`
    );
    results.push(await syncRule("hire.deposit_pending", rows, (row) => ({
      notification_key: `hire.deposit_pending.${row.id}`,
      workspace_code: "equipment_hire",
      hire_location_id: row.hire_location_id,
      title: `Deposit ${row.transaction_type}: ${row.transaction_number}`,
      message: `GHS ${numeric(row.amount).toFixed(2)} is awaiting independent approval. ${cleanText(row.reason, 500)}`,
      action_path: "/equipment-hire-operations/commercial-control?tab=deposits",
      source_type: "hire_deposit_transaction",
      source_id: row.id,
      source_reference: row.transaction_number,
      occurred_at: row.created_at,
    }), rules, connection));
  }

  if (await tableExists("hire_damage_assessments", connection)) {
    const [rows] = await connection.query(
      `SELECT id, hire_location_id, assessment_number, customer_liability_amount,
              settled_amount, damage_summary, status, created_at
       FROM hire_damage_assessments
       WHERE status <> 'settled'`
    );
    results.push(await syncRule("hire.damage_open", rows, (row) => ({
      notification_key: `hire.damage_open.${row.id}`,
      workspace_code: "equipment_hire",
      hire_location_id: row.hire_location_id,
      severity: numeric(row.customer_liability_amount) - numeric(row.settled_amount) > 0 ? "high" : "medium",
      title: `Open damage case: ${row.assessment_number}`,
      message: `${cleanText(row.damage_summary, 700)} Outstanding settlement GHS ${Math.max(0, numeric(row.customer_liability_amount) - numeric(row.settled_amount)).toFixed(2)}.`,
      action_path: "/equipment-hire-operations/commercial-control?tab=damage",
      source_type: "hire_damage_assessment",
      source_id: row.id,
      source_reference: row.assessment_number,
      occurred_at: row.created_at,
    }), rules, connection));
  }

  if (await tableExists("hire_work_logs", connection)) {
    const [rows] = await connection.query(
      `SELECT hwl.id, hwl.hire_location_id, hwl.work_date, hwl.billable_hours,
              hc.contract_number, fa.asset_code
       FROM hire_work_logs hwl
       INNER JOIN hire_contracts hc ON hc.id = hwl.contract_id
       INNER JOIN fleet_assets fa ON fa.id = hwl.asset_id
       WHERE hwl.status = 'draft'
         AND hwl.work_date < CURDATE()`
    );
    results.push(await syncRule("hire.work_log_pending", rows, (row) => ({
      notification_key: `hire.work_log_pending.${row.id}`,
      workspace_code: "equipment_hire",
      hire_location_id: row.hire_location_id,
      title: `Work log pending: ${row.contract_number}`,
      message: `${row.asset_code} work log for ${String(row.work_date).slice(0, 10)} (${numeric(row.billable_hours).toFixed(2)} billable hours) remains draft.`,
      action_path: "/equipment-hire-operations/operations",
      source_type: "hire_work_log",
      source_id: row.id,
      source_reference: `${row.contract_number}/${row.asset_code}`,
      due_at: row.work_date,
    }), rules, connection));
  }

  return results;
}

async function runNotificationSync({ workspace = "group", userId = null } = {}) {
  const requested = WORKSPACES.has(workspace) ? workspace : "group";
  const connection = await pool.getConnection();
  let lockAcquired = false;
  let transactionStarted = false;
  let syncId = null;

  try {
    const [lockRows] = await connection.query(
      "SELECT GET_LOCK('chalin03_notification_sync', 5) AS acquired"
    );
    lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;
    if (!lockAcquired) {
      const error = new Error("Notification synchronization is already running.");
      error.statusCode = 409;
      throw error;
    }

    const [syncResult] = await connection.query(
      `INSERT INTO notification_sync_runs (workspace_code, status, started_by)
       VALUES (?, 'running', ?)`,
      [requested, positiveId(userId)]
    );
    syncId = syncResult.insertId;

    await connection.beginTransaction();
    transactionStarted = true;

    const rules = await getRuleMap(connection);
    const allResults = [];

    if (["group", "spare_parts"].includes(requested)) {
      allResults.push(...(await syncSpareParts(rules, connection)));
    }
    if (["group", "mining"].includes(requested)) {
      allResults.push(...(await syncMining(rules, connection)));
    }
    if (["group", "equipment_hire"].includes(requested)) {
      allResults.push(...(await syncHire(rules, connection)));
    }

    const generated = allResults.reduce((sum, row) => sum + wholeNumber(row.generated), 0);
    const resolved = allResults.reduce((sum, row) => sum + wholeNumber(row.resolved), 0);

    await connection.query(
      `UPDATE notification_sync_runs
       SET status = 'completed', generated_count = ?, resolved_count = ?,
           details_json = ?, completed_at = NOW()
       WHERE id = ?`,
      [generated, resolved, JSON.stringify(allResults), syncId]
    );

    await connection.commit();
    transactionStarted = false;

    return { sync_id: syncId, workspace_code: requested, generated_count: generated, resolved_count: resolved, details: allResults };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original synchronization error.
      }
      transactionStarted = false;
    }

    if (syncId) {
      try {
        await connection.query(
          `UPDATE notification_sync_runs
           SET status = 'failed', error_count = 1, details_json = ?, completed_at = NOW()
           WHERE id = ?`,
          [JSON.stringify({ error: cleanText(error.message, 500) }), syncId]
        );
      } catch {
        // Preserve the original sync error.
      }
    }
    throw error;
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK('chalin03_notification_sync')");
      } catch {
        // Lock release failure is non-fatal after the connection closes.
      }
    }
    connection.release();
  }
}

function buildVisibilitySql(
  req,
  { archived = false, status = "active", search = "", severity = "", category = "", id = null } = {}
) {
  const workspace = workspaceCode(req);
  const contextId = selectedContextId(req);
  const currentBranchId = branchId(req);
  const roles = roleCodes(req);
  const clauses = [
    "(n.target_user_id IS NULL OR n.target_user_id = ?)",
    "(n.target_role IS NULL OR n.target_role = '' OR n.target_role IN (?, ?) OR n.target_permission IS NOT NULL)",
  ];
  const params = [req.user.id, roles[0] || "", roles[1] || ""];

  const groupScopeRequested =
    isOriginalSystemAdministrator(req.user) &&
    cleanText(req.query?.workspace_scope, 20).toLowerCase() === "group";

  if (!groupScopeRequested) {
    clauses.push("(n.workspace_code = 'group' OR n.workspace_code = ?)");
    params.push(workspace);
  }

  if (!groupScopeRequested && workspace === "spare_parts" && currentBranchId) {
    clauses.push("(n.branch_id IS NULL OR n.branch_id = ?)");
    params.push(currentBranchId);
  }

  if (!groupScopeRequested && workspace === "mining") {
    if (contextId) {
      clauses.push("(n.mining_site_id IS NULL OR n.mining_site_id = ?)");
      params.push(contextId);
    } else if (!isAdmin(req)) {
      clauses.push(
        `(n.mining_site_id IS NULL OR EXISTS (
           SELECT 1 FROM user_mining_site_access uma
           WHERE uma.user_id = ? AND uma.site_id = n.mining_site_id AND uma.can_access = TRUE
         ))`
      );
      params.push(req.user.id);
    }
  }

  if (!groupScopeRequested && workspace === "equipment_hire") {
    if (contextId) {
      clauses.push("(n.hire_location_id IS NULL OR n.hire_location_id = ?)");
      params.push(contextId);
    } else if (!isAdmin(req)) {
      clauses.push(
        `(n.hire_location_id IS NULL OR EXISTS (
           SELECT 1 FROM user_hire_location_access uha
           WHERE uha.user_id = ? AND uha.location_id = n.hire_location_id AND uha.can_access = TRUE
         ))`
      );
      params.push(req.user.id);
    }
  }

  if (archived !== null && archived !== "all") {
    clauses.push("COALESCE(nus.is_archived, FALSE) = ?");
    params.push(Boolean(archived));
  }

  const notificationId = positiveId(id);
  if (notificationId) {
    clauses.push("n.id = ?");
    params.push(notificationId);
  }

  if (status && status !== "all") {
    clauses.push("n.status = ?");
    params.push(status);
  }
  if (severity && SEVERITIES.has(severity)) {
    clauses.push("n.severity = ?");
    params.push(severity);
  }
  if (category) {
    clauses.push("n.category = ?");
    params.push(category);
  }
  if (search) {
    clauses.push("(n.title LIKE ? OR n.message LIKE ? OR n.source_reference LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  return { where: clauses.join(" AND "), params };
}

async function visibleNotifications(req, options = {}) {
  const limit = Math.min(250, Math.max(1, wholeNumber(options.limit, 80)));
  const offset = Math.max(0, wholeNumber(options.offset, 0));
  const visibility = buildVisibilitySql(req, options);
  const [rows] = await pool.query(
    `SELECT n.*,
            COALESCE(nus.is_read, FALSE) AS is_read,
            nus.read_at,
            COALESCE(nus.is_archived, FALSE) AS is_archived,
            nus.archived_at,
            nr.sms_allowed,
            nr.escalation_minutes,
            ms.site_code,
            ms.site_name,
            bl.code AS hire_location_code,
            bl.name AS hire_location_name,
            b.branch_code,
            b.name AS branch_name
     FROM notifications n
     LEFT JOIN notification_user_states nus
       ON nus.notification_id = n.id AND nus.user_id = ?
     LEFT JOIN notification_rules nr ON nr.id = n.rule_id
     LEFT JOIN mining_sites ms ON ms.id = n.mining_site_id
     LEFT JOIN business_locations bl ON bl.id = n.hire_location_id
     LEFT JOIN branches b ON b.id = n.branch_id
     WHERE ${visibility.where}
     ORDER BY FIELD(n.severity, 'critical', 'high', 'medium', 'low'),
              COALESCE(n.due_at, n.last_detected_at) ASC,
              n.last_detected_at DESC
     LIMIT ? OFFSET ?`,
    [req.user.id, ...visibility.params, limit, offset]
  );

  return rows.filter((row) => !row.target_permission || hasPermission(req.user, row.target_permission));
}

async function notificationSummary(req) {
  const rows = await visibleNotifications(req, { status: "active", archived: false, limit: 250 });
  const counts = {
    total: rows.length,
    unread: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    by_workspace: {},
    by_category: {},
  };

  for (const row of rows) {
    if (!Boolean(Number(row.is_read))) counts.unread += 1;
    const severity = cleanText(row.severity, 20).toLowerCase();
    if (Object.hasOwn(counts, severity)) counts[severity] += 1;
    counts.by_workspace[row.workspace_code] = wholeNumber(counts.by_workspace[row.workspace_code]) + 1;
    counts.by_category[row.category] = wholeNumber(counts.by_category[row.category]) + 1;
  }

  return {
    counts,
    urgent: rows
      .filter((row) => severityRank(row.severity) <= severityRank("high"))
      .slice(0, 10),
  };
}

module.exports = {
  WORKSPACES,
  SEVERITIES,
  cleanText,
  positiveId,
  workspaceCode,
  selectedContextId,
  branchId,
  isAdmin,
  tableExists,
  runNotificationSync,
  visibleNotifications,
  notificationSummary,
};
