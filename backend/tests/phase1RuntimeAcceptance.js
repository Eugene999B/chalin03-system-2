const assert = require("node:assert/strict");
const fs = require("node:fs");
const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const expenseReversalRoutes = require("../routes/expenseReversalRoutes");
const {
  decorateDailyClosingPayload,
  loadDailyClosingExpenseEvidence,
  requireSparePartsBranchContext,
} = require("../middleware/sparePartsBranchContextMiddleware");

const TEST_DATE = "2026-07-25";
const LOCKED_DATE = "2026-07-26";
const CROSS_STORE_DATE = "2026-07-27";
const REQUESTER_PASSWORD = "Requester!123";
const APPROVER_PASSWORD = "Approver!123";

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

async function insertUser(connection, {
  fullName,
  username,
  password,
  role,
  branchId,
}) {
  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await connection.query(
    `INSERT INTO users (
       full_name, username, password_hash, role, default_branch_id,
       can_access_all_branches, is_active, must_change_password
     ) VALUES (?, ?, ?, ?, ?, 0, 1, 0)`,
    [fullName, username, passwordHash, role, branchId]
  );
  return Number(result.insertId);
}

async function insertExpense(connection, {
  branchId,
  amount,
  date,
  recordedBy,
  category = "Runtime acceptance expense",
}) {
  const [result] = await connection.query(
    `INSERT INTO expenses (
       branch_id, category, amount, payment_method, funding_source,
       affects_daily_closing, closing_treatment_note, description,
       expense_date, recorded_by
     ) VALUES (?, ?, ?, 'cash', 'today_sales_receipts', 1, ?, ?, ?, ?)`,
    [
      branchId,
      category,
      amount,
      "Deduct from the selected day's cash evidence.",
      "Disposable GitHub Actions acceptance record.",
      date,
      recordedBy,
    ]
  );
  return Number(result.insertId);
}

async function seedDatabase() {
  const connection = await pool.getConnection();
  try {
    const [branchAResult] = await connection.query(
      `INSERT INTO branches (
         code, branch_code, name, location, is_head_office, is_active
       ) VALUES ('ACCEPT-A', 'ACCEPT-A', 'Acceptance Store A', 'Disposable CI', 1, 1)`
    );
    const branchA = Number(branchAResult.insertId);

    const [branchBResult] = await connection.query(
      `INSERT INTO branches (
         code, branch_code, name, location, is_head_office, is_active
       ) VALUES ('ACCEPT-B', 'ACCEPT-B', 'Acceptance Store B', 'Disposable CI', 0, 1)`
    );
    const branchB = Number(branchBResult.insertId);

    const requesterId = await insertUser(connection, {
      fullName: "Acceptance Requester",
      username: "accept_requester",
      password: REQUESTER_PASSWORD,
      role: "manager",
      branchId: branchA,
    });
    const approverId = await insertUser(connection, {
      fullName: "Acceptance Approver",
      username: "accept_approver",
      password: APPROVER_PASSWORD,
      role: "admin",
      branchId: branchA,
    });

    await connection.query(
      `INSERT INTO user_branch_access (
         user_id, branch_id, access_role, is_primary, can_access
       ) VALUES (?, ?, 'manager', 1, 1), (?, ?, 'admin', 1, 1)`,
      [requesterId, branchA, approverId, branchA]
    );

    await connection.query(
      `INSERT INTO daily_closings (
         branch_id, closing_date, closed_by, cash_counted, total_counted,
         counted_confirmed, verification_status
       ) VALUES (?, ?, ?, 1500.00, 1500.00, 1, 'verified')`,
      [branchA, TEST_DATE, requesterId]
    );

    const expenseId = await insertExpense(connection, {
      branchId: branchA,
      amount: 500,
      date: TEST_DATE,
      recordedBy: requesterId,
    });
    const lockedExpenseId = await insertExpense(connection, {
      branchId: branchA,
      amount: 250,
      date: LOCKED_DATE,
      recordedBy: requesterId,
      category: "Locked-period expense",
    });
    const crossStoreExpenseId = await insertExpense(connection, {
      branchId: branchB,
      amount: 175,
      date: CROSS_STORE_DATE,
      recordedBy: approverId,
      category: "Other-store expense",
    });

    await connection.query(
      `INSERT INTO audit_signoffs (
         branch_id, period_type, period_label, period_start, period_end,
         audit_score, audit_status, period_status, created_by, approved_by,
         approved_by_name, review_date
       ) VALUES (?, 'custom', 'Acceptance locked period', ?, ?, 100,
                 'Approved', 'approved', ?, ?, 'Acceptance Approver', ?)`,
      [branchA, LOCKED_DATE, LOCKED_DATE, requesterId, approverId, LOCKED_DATE]
    );

    return {
      branchA,
      branchB,
      requesterId,
      approverId,
      expenseId,
      lockedExpenseId,
      crossStoreExpenseId,
    };
  } finally {
    connection.release();
  }
}

function buildExpenseApp(identity) {
  const app = express();
  app.use(express.json());
  app.use("/api/expenses", (req, _res, next) => {
    req.user = { ...identity };
    next();
  });
  app.use("/api/expenses", expenseReversalRoutes);
  return app;
}

function buildStoreContextApp(identity) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { ...identity };
    next();
  });
  app.get("/probe", requireSparePartsBranchContext, (req, res) => {
    res.json({
      status: "success",
      branch_id: req.user.branch_id,
      branch_code: req.user.branch_code,
      branch_name: req.user.branch_name,
    });
  });
  return app;
}

async function verifyMigrationShape() {
  const [migrationRows] = await pool.query(
    `SELECT migration_name
     FROM schema_migrations
     WHERE migration_name = '20260725_phase1_financial_control_hardening'`
  );
  assert.equal(migrationRows.length, 1, "Phase 1 migration record is missing");

  const [columns] = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'expenses'
       AND COLUMN_NAME IN (
         'is_voided', 'void_reason', 'void_reference', 'voided_by',
         'voided_at', 'void_approved_by', 'void_approved_at',
         'is_reversal', 'reversal_of_expense_id', 'reversal_reference'
       )`
  );
  assert.equal(columns.length, 10, "Not all Phase 1 expense columns exist");

  const [indexes] = await pool.query(
    `SELECT DISTINCT INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'expenses'
       AND INDEX_NAME IN (
         'idx_expense_void_status', 'uq_expense_void_reference',
         'idx_expense_void_approval', 'uq_expense_reversal_source',
         'uq_expense_reversal_reference'
       )`
  );
  assert.equal(indexes.length, 5, "Not all Phase 1 expense indexes exist");
}

async function run() {
  const evidence = {
    migration: {},
    store_context: {},
    expense_void: {},
    locked_period: {},
    cross_store: {},
    daily_closing: {},
    audit: {},
  };
  let expenseServer;
  let contextServer;

  try {
    await verifyMigrationShape();
    evidence.migration = { status: "passed", columns: 10, indexes: 5 };

    const seeded = await seedDatabase();
    const requesterIdentity = {
      id: seeded.requesterId,
      username: "accept_requester",
      full_name: "Acceptance Requester",
      role: "manager",
      workspace_role: "manager",
      workspace_code: "spare_parts",
      branch_id: seeded.branchA,
    };

    expenseServer = await listen(buildExpenseApp(requesterIdentity));
    const expenseBaseUrl = `http://127.0.0.1:${expenseServer.address().port}`;

    const shortReason = await requestJson(
      expenseBaseUrl,
      `/api/expenses/${seeded.expenseId}`,
      {
        method: "DELETE",
        body: JSON.stringify({
          reason: "short",
          approver_username: "accept_approver",
          approver_password: APPROVER_PASSWORD,
        }),
      }
    );
    assert.equal(shortReason.response.status, 400);
    assert.equal(shortReason.body.code, "EXPENSE_VOID_REASON_REQUIRED");

    const selfApproval = await requestJson(
      expenseBaseUrl,
      `/api/expenses/${seeded.expenseId}`,
      {
        method: "DELETE",
        body: JSON.stringify({
          reason: "Correct an incorrectly entered acceptance expense.",
          approver_username: "accept_requester",
          approver_password: REQUESTER_PASSWORD,
        }),
      }
    );
    assert.equal(selfApproval.response.status, 403);
    assert.equal(selfApproval.body.code, "INDEPENDENT_APPROVER_REQUIRED");

    const wrongPassword = await requestJson(
      expenseBaseUrl,
      `/api/expenses/${seeded.expenseId}`,
      {
        method: "DELETE",
        body: JSON.stringify({
          reason: "Correct an incorrectly entered acceptance expense.",
          approver_username: "accept_approver",
          approver_password: "Wrong!123",
        }),
      }
    );
    assert.equal(wrongPassword.response.status, 403);
    assert.equal(wrongPassword.body.code, "INDEPENDENT_APPROVER_REQUIRED");

    const successfulVoid = await requestJson(
      expenseBaseUrl,
      `/api/expenses/${seeded.expenseId}`,
      {
        method: "DELETE",
        body: JSON.stringify({
          reason: "Correct an incorrectly entered acceptance expense.",
          approver_username: "accept_approver",
          approver_password: APPROVER_PASSWORD,
        }),
      }
    );
    assert.equal(successfulVoid.response.status, 200);
    assert.equal(successfulVoid.body.code, "EXPENSE_VOIDED");
    assert.match(successfulVoid.body.void_reference, /^EXP-VOID-/);

    const [ledgerRows] = await pool.query(
      `SELECT *
       FROM expenses
       WHERE id = ? OR reversal_of_expense_id = ?
       ORDER BY id`,
      [seeded.expenseId, seeded.expenseId]
    );
    assert.equal(ledgerRows.length, 2);
    const original = ledgerRows.find((row) => Number(row.id) === seeded.expenseId);
    const reversal = ledgerRows.find((row) => Number(row.is_reversal) === 1);
    assert.ok(original, "Original expense row was not preserved");
    assert.ok(reversal, "Linked reversal row was not created");
    assert.equal(Number(original.is_voided), 1);
    assert.equal(Number(original.voided_by), seeded.requesterId);
    assert.equal(Number(original.void_approved_by), seeded.approverId);
    assert.equal(Number(reversal.reversal_of_expense_id), seeded.expenseId);
    assert.equal(reversal.reversal_reference, original.void_reference);
    assert.equal(Number(reversal.amount), -500);
    assert.equal(Number(original.amount) + Number(reversal.amount), 0);

    const duplicateVoid = await requestJson(
      expenseBaseUrl,
      `/api/expenses/${seeded.expenseId}`,
      {
        method: "DELETE",
        body: JSON.stringify({
          reason: "Attempt to repeat an already completed correction.",
          approver_username: "accept_approver",
          approver_password: APPROVER_PASSWORD,
        }),
      }
    );
    assert.equal(duplicateVoid.response.status, 409);
    assert.equal(duplicateVoid.body.code, "EXPENSE_ALREADY_VOIDED");

    const locked = await requestJson(
      expenseBaseUrl,
      `/api/expenses/${seeded.lockedExpenseId}`,
      {
        method: "DELETE",
        body: JSON.stringify({
          reason: "Attempt correction inside an approved accounting period.",
          approver_username: "accept_approver",
          approver_password: APPROVER_PASSWORD,
        }),
      }
    );
    assert.equal(locked.response.status, 423);
    assert.equal(locked.body.code, "AUDIT_PERIOD_LOCKED");
    const [[lockedRow]] = await pool.query(
      `SELECT is_voided FROM expenses WHERE id = ?`,
      [seeded.lockedExpenseId]
    );
    const [[lockedReversalCount]] = await pool.query(
      `SELECT COUNT(*) AS count
       FROM expenses
       WHERE reversal_of_expense_id = ?`,
      [seeded.lockedExpenseId]
    );
    assert.equal(Number(lockedRow.is_voided), 0);
    assert.equal(Number(lockedReversalCount.count), 0);

    const crossStore = await requestJson(
      expenseBaseUrl,
      `/api/expenses/${seeded.crossStoreExpenseId}`,
      {
        method: "DELETE",
        body: JSON.stringify({
          reason: "Attempt to alter a record belonging to another store.",
          approver_username: "accept_approver",
          approver_password: APPROVER_PASSWORD,
        }),
      }
    );
    assert.equal(crossStore.response.status, 404);
    assert.equal(crossStore.body.code, "EXPENSE_NOT_FOUND");
    const [[crossStoreRow]] = await pool.query(
      `SELECT is_voided FROM expenses WHERE id = ?`,
      [seeded.crossStoreExpenseId]
    );
    assert.equal(Number(crossStoreRow.is_voided), 0);

    const [[closing]] = await pool.query(
      `SELECT stale_after_close, latest_revision_number, verification_status
       FROM daily_closings
       WHERE branch_id = ? AND closing_date = ?`,
      [seeded.branchA, TEST_DATE]
    );
    assert.equal(Number(closing.stale_after_close), 1);
    assert.equal(Number(closing.latest_revision_number), 2);
    assert.equal(closing.verification_status, "variance_review");

    const [[revision]] = await pool.query(
      `SELECT source_entity_type, source_entity_id, changed_by, approved_by
       FROM daily_closing_revisions
       WHERE branch_id = ? AND closing_date = ?
       ORDER BY revision_number DESC
       LIMIT 1`,
      [seeded.branchA, TEST_DATE]
    );
    assert.equal(revision.source_entity_type, "expense_void");
    assert.equal(String(revision.source_entity_id), String(seeded.expenseId));
    assert.equal(Number(revision.changed_by), seeded.requesterId);
    assert.equal(Number(revision.approved_by), seeded.approverId);

    const evidenceMap = await loadDailyClosingExpenseEvidence(
      seeded.branchA,
      TEST_DATE
    );
    const decorated = decorateDailyClosingPayload(
      {
        expenses: ledgerRows.map((row) => ({
          id: row.id,
          category: row.category,
          description: row.description,
          amount: Number(row.amount),
        })),
      },
      evidenceMap
    );
    assert.equal(decorated.expense_correction_count, 1);
    assert.equal(Number(decorated.expense_corrections[0].net_effect), 0);
    assert.ok(
      decorated.expenses.some((row) =>
        String(row.category).startsWith("VOIDED —")
      )
    );
    assert.ok(
      decorated.expenses.some((row) =>
        String(row.category).startsWith("REVERSAL —")
      )
    );

    const [[auditRow]] = await pool.query(
      `SELECT action, action_type, outcome, severity, branch_id, user_id
       FROM activity_log
       WHERE action = 'VOID_EXPENSE'
       ORDER BY id DESC
       LIMIT 1`
    );
    assert.equal(auditRow.action_type, "expense.void");
    assert.equal(auditRow.outcome, "success");
    assert.equal(auditRow.severity, "critical");
    assert.equal(Number(auditRow.branch_id), seeded.branchA);
    assert.equal(Number(auditRow.user_id), seeded.requesterId);

    contextServer = await listen(
      buildStoreContextApp({
        id: seeded.requesterId,
        username: "accept_requester",
        role: "manager",
      })
    );
    const contextBaseUrl = `http://127.0.0.1:${contextServer.address().port}`;

    const missingStore = await requestJson(contextBaseUrl, "/probe");
    assert.equal(missingStore.response.status, 400);
    assert.equal(missingStore.body.code, "STORE_CONTEXT_REQUIRED");

    const deniedStore = await requestJson(contextBaseUrl, "/probe", {
      headers: { "x-chalin03-branch-id": String(seeded.branchB) },
    });
    assert.equal(deniedStore.response.status, 403);
    assert.equal(deniedStore.body.code, "STORE_ACCESS_DENIED");

    const allowedStore = await requestJson(contextBaseUrl, "/probe", {
      headers: { "x-chalin03-branch-id": String(seeded.branchA) },
    });
    assert.equal(allowedStore.response.status, 200);
    assert.equal(Number(allowedStore.body.branch_id), seeded.branchA);
    assert.equal(allowedStore.body.branch_code, "ACCEPT-A");

    const [[invalidVoidRows]] = await pool.query(
      `SELECT COUNT(*) AS count
       FROM expenses original
       WHERE original.is_voided = 1
         AND (
           original.is_reversal <> 0
           OR original.void_reason IS NULL
           OR CHAR_LENGTH(TRIM(original.void_reason)) < 8
           OR original.void_reference IS NULL
           OR original.voided_by IS NULL
           OR original.void_approved_by IS NULL
           OR original.voided_by = original.void_approved_by
           OR NOT EXISTS (
             SELECT 1 FROM expenses reversal
             WHERE reversal.reversal_of_expense_id = original.id
               AND reversal.is_reversal = 1
               AND reversal.is_voided = 0
               AND reversal.reversal_reference = original.void_reference
               AND reversal.branch_id = original.branch_id
               AND reversal.expense_date = original.expense_date
               AND ROUND(reversal.amount + original.amount, 2) = 0.00
           )
         )`
    );
    assert.equal(Number(invalidVoidRows.count), 0);

    evidence.store_context = {
      missing_context: "rejected",
      unauthorised_store: "rejected",
      authorised_store: "accepted",
    };
    evidence.expense_void = {
      short_reason: "rejected",
      self_approval: "rejected",
      wrong_approver_password: "rejected",
      successful_two_person_void: "passed",
      duplicate_void: "rejected",
      original_preserved: true,
      reversal_created: true,
      net_effect: 0,
      void_reference: original.void_reference,
    };
    evidence.locked_period = {
      status: "rejected",
      code: locked.body.code,
      original_unchanged: true,
    };
    evidence.cross_store = {
      status: "rejected",
      code: crossStore.body.code,
      other_store_record_unchanged: true,
    };
    evidence.daily_closing = {
      stale_after_close: true,
      revision_number: 2,
      correction_count: decorated.expense_correction_count,
      net_effect: decorated.expense_corrections[0].net_effect,
      labels: ["VOIDED", "REVERSAL"],
    };
    evidence.audit = {
      action: auditRow.action,
      outcome: auditRow.outcome,
      severity: auditRow.severity,
      requester_id: seeded.requesterId,
      approver_id: seeded.approverId,
    };

    fs.writeFileSync(
      "phase1-runtime-acceptance-evidence.json",
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8"
    );
    console.log("PHASE 1 RUNTIME ACCEPTANCE PASSED");
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await closeServer(contextServer);
    await closeServer(expenseServer);
    await pool.end();
  }
}

run().catch((error) => {
  console.error("PHASE 1 RUNTIME ACCEPTANCE FAILED");
  console.error(error);
  process.exitCode = 1;
});
