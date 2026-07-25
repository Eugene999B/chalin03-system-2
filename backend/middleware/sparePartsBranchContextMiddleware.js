const { pool } = require("../config/db");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function selectedBranchId(req) {
  return (
    positiveId(req.user?.branch_id) ||
    positiveId(req.user?.selected_branch_id) ||
    positiveId(req.user?.selected_branch?.id) ||
    positiveId(req.headers?.["x-chalin03-branch-id"]) ||
    positiveId(req.headers?.["x-branch-id"])
  );
}

function closingDateFromRequest(req) {
  const values = [
    req.query?.date,
    req.query?.closing_date,
    req.body?.closing_date,
    req.params?.date,
  ];

  for (const value of values) {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  }

  return new Date().toISOString().slice(0, 10);
}

async function userCanAccessBranch(req, branchId) {
  if (isOriginalSystemAdministrator(req.user)) return true;

  const [rows] = await pool.query(
    `SELECT
       u.id,
       u.default_branch_id,
       u.can_access_all_branches,
       EXISTS (
         SELECT 1
         FROM user_branch_access uba
         WHERE uba.user_id = u.id
           AND uba.branch_id = ?
           AND uba.can_access = TRUE
       ) AS has_explicit_access
     FROM users u
     WHERE u.id = ?
       AND u.is_active = TRUE
     LIMIT 1`,
    [branchId, req.user?.id]
  );

  const user = rows[0];
  if (!user) return false;

  return (
    Number(user.can_access_all_branches || 0) === 1 ||
    Number(user.default_branch_id || 0) === Number(branchId) ||
    Number(user.has_explicit_access || 0) === 1
  );
}

async function loadDailyClosingExpenseEvidence(branchId, closingDate) {
  const [rows] = await pool.query(
    `SELECT
       e.id,
       e.is_voided,
       e.void_reason,
       e.void_reference,
       e.voided_at,
       e.is_reversal,
       e.reversal_of_expense_id,
       e.reversal_reference,
       voider.full_name AS voided_by_name,
       approver.full_name AS void_approved_by_name,
       original.category AS original_category,
       original.description AS original_description
     FROM expenses e
     LEFT JOIN users voider ON voider.id = e.voided_by
     LEFT JOIN users approver ON approver.id = e.void_approved_by
     LEFT JOIN expenses original ON original.id = e.reversal_of_expense_id
     WHERE e.branch_id = ?
       AND e.expense_date = ?
       AND (e.is_voided = 1 OR e.is_reversal = 1)`,
    [branchId, closingDate]
  );

  return new Map(rows.map((row) => [Number(row.id), row]));
}

function decorateExpenseRow(row, evidenceMap) {
  if (!row || row.phase1_expense_evidence_applied) return row;

  const evidence = evidenceMap.get(Number(row.id));
  if (!evidence) return row;

  if (Number(evidence.is_voided || 0) === 1) {
    const reason = evidence.void_reason || "No reason recorded";
    const reference = evidence.void_reference || "No reference";
    const approver = evidence.void_approved_by_name || "Unknown approver";

    return {
      ...row,
      category: `VOIDED — ${row.category || "Expense"}`,
      description: `${row.description || "Expense"} [VOIDED — ${reason}; reference ${reference}; approved by ${approver}]`,
      ledger_status: "voided_original",
      void_reason: reason,
      void_reference: reference,
      voided_at: evidence.voided_at || null,
      voided_by_name: evidence.voided_by_name || null,
      void_approved_by_name: evidence.void_approved_by_name || null,
      net_effect: 0,
      phase1_expense_evidence_applied: true,
    };
  }

  const reference =
    evidence.reversal_reference || evidence.void_reference || "No reference";
  const originalLabel = evidence.original_category || row.category || "Expense";

  return {
    ...row,
    category: `REVERSAL — ${originalLabel}`,
    description: `${row.description || "Financial reversal"} [Linked to expense ${
      evidence.reversal_of_expense_id || "unknown"
    }; reference ${reference}]`,
    ledger_status: "linked_reversal",
    reversal_of_expense_id: evidence.reversal_of_expense_id || null,
    reversal_reference: reference,
    original_category: evidence.original_category || null,
    original_description: evidence.original_description || null,
    phase1_expense_evidence_applied: true,
  };
}

function decorateExpenseCollection(expenses, evidenceMap) {
  if (!Array.isArray(expenses)) return expenses;
  return expenses.map((row) => decorateExpenseRow(row, evidenceMap));
}

function buildExpenseCorrections(expenses, evidenceMap) {
  if (!Array.isArray(expenses)) return [];

  const byId = new Map(expenses.map((row) => [Number(row.id), row]));
  const corrections = [];

  for (const evidence of evidenceMap.values()) {
    if (Number(evidence.is_voided || 0) !== 1) continue;

    const original = byId.get(Number(evidence.id));
    const reversalEvidence = Array.from(evidenceMap.values()).find(
      (candidate) =>
        Number(candidate.is_reversal || 0) === 1 &&
        Number(candidate.reversal_of_expense_id) === Number(evidence.id)
    );
    const reversal = reversalEvidence
      ? byId.get(Number(reversalEvidence.id))
      : null;

    corrections.push({
      original_expense_id: Number(evidence.id),
      reversal_expense_id: reversal ? Number(reversal.id) : null,
      void_reference: evidence.void_reference || null,
      reason: evidence.void_reason || null,
      voided_by_name: evidence.voided_by_name || null,
      approved_by_name: evidence.void_approved_by_name || null,
      original_amount: Number(original?.amount || 0),
      reversal_amount: Number(reversal?.amount || 0),
      net_effect: Number(original?.amount || 0) + Number(reversal?.amount || 0),
    });
  }

  return corrections;
}

function decorateDailyClosingPayload(payload, evidenceMap) {
  if (!payload || typeof payload !== "object" || evidenceMap.size === 0) {
    return payload;
  }

  const decorateTarget = (target) => {
    if (!target || typeof target !== "object" || !Array.isArray(target.expenses)) {
      return;
    }
    const rawExpenses = target.expenses;
    target.expenses = decorateExpenseCollection(rawExpenses, evidenceMap);
    target.expense_corrections = buildExpenseCorrections(rawExpenses, evidenceMap);
    target.expense_correction_count = target.expense_corrections.length;
  };

  decorateTarget(payload);
  decorateTarget(payload.summary);

  return payload;
}

function installDailyClosingResponseDecorator(req, res, evidenceMap) {
  if (res.__chalin03ExpenseEvidenceDecoratorInstalled) return;

  const originalJson = res.json.bind(res);
  res.json = (payload) => originalJson(decorateDailyClosingPayload(payload, evidenceMap));

  Object.defineProperty(res, "__chalin03ExpenseEvidenceDecoratorInstalled", {
    value: true,
    enumerable: false,
  });
}

async function requireSparePartsBranchContext(req, res, next) {
  try {
    if (req.sparePartsBranch && positiveId(req.user?.branch_id)) {
      return next();
    }

    const branchId = selectedBranchId(req);

    if (!branchId) {
      return res.status(400).json({
        status: "error",
        code: "STORE_CONTEXT_REQUIRED",
        message:
          "No active Spare Parts store is selected. Logout, choose the correct store and login again before continuing.",
      });
    }

    const [[branchRows], canAccess] = await Promise.all([
      pool.query(
        `SELECT id, code, branch_code, name, location, is_active
         FROM branches
         WHERE id = ?
         LIMIT 1`,
        [branchId]
      ),
      userCanAccessBranch(req, branchId),
    ]);

    const branch = branchRows[0];
    if (!branch || Number(branch.is_active || 0) !== 1) {
      return res.status(400).json({
        status: "error",
        code: "STORE_CONTEXT_INVALID",
        message: "The selected Spare Parts store is missing or inactive.",
      });
    }

    if (!canAccess) {
      return res.status(403).json({
        status: "error",
        code: "STORE_ACCESS_DENIED",
        message: "Your account is not authorised for the selected Spare Parts store.",
      });
    }

    req.user.branch_id = branchId;
    req.user.branch_code = branch.branch_code || branch.code || null;
    req.user.branch_name = branch.name || null;
    req.user.branch_location = branch.location || null;
    req.sparePartsBranch = branch;

    if (String(req.baseUrl || "") === "/api/daily-closing") {
      const evidenceMap = await loadDailyClosingExpenseEvidence(
        branchId,
        closingDateFromRequest(req)
      );
      installDailyClosingResponseDecorator(req, res, evidenceMap);
    }

    return next();
  } catch (error) {
    console.error("Spare Parts store-context validation failed:", error);
    return res.status(500).json({
      status: "error",
      code: "STORE_CONTEXT_CHECK_FAILED",
      message: "The selected Spare Parts store could not be verified safely.",
    });
  }
}

module.exports = {
  buildExpenseCorrections,
  closingDateFromRequest,
  decorateDailyClosingPayload,
  decorateExpenseCollection,
  decorateExpenseRow,
  installDailyClosingResponseDecorator,
  loadDailyClosingExpenseEvidence,
  requireSparePartsBranchContext,
  selectedBranchId,
  userCanAccessBranch,
};
