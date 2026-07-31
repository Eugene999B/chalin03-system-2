const { pool } = require("../config/db");

const RECONCILIATION_ACTION = "APPLY_CREDIT_RETURN_TO_DEBT";
const MAX_RETURNS_PER_PASS = 1000;

function roundMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function branchIdFromRequest(req) {
  const branchId = Number(
    req.user?.branch_id || req.user?.default_branch_id || 0
  );
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function debtStatus(balance, amountPaid, adjustmentApplied) {
  if (roundMoney(balance) <= 0) return "paid";
  return roundMoney(amountPaid) > 0 || roundMoney(adjustmentApplied) > 0
    ? "partial"
    : "unpaid";
}

async function acquireBranchLock(connection, branchId) {
  const lockName = `chalin03:credit-return-debt:${branchId}`;
  const [[row]] = await connection.query(
    "SELECT GET_LOCK(?, 5) AS acquired",
    [lockName]
  );
  return {
    acquired: Number(row?.acquired) === 1,
    lockName,
  };
}

async function releaseBranchLock(connection, lockName) {
  try {
    await connection.query("SELECT RELEASE_LOCK(?) AS released", [lockName]);
  } catch (error) {
    console.error("Credit-return reconciliation lock release failed:", error);
  }
}

async function loadUnprocessedReturns(connection, branchId) {
  const [rows] = await connection.query(
    `SELECT
       r.id,
       r.branch_id,
       r.sale_id,
       r.product_id,
       r.quantity,
       r.return_type,
       r.refund_amount,
       r.refund_method,
       r.returned_by,
       r.returned_at,
       s.receipt_number,
       COALESCE((
         SELECT MAX(si.unit_price)
         FROM sale_items si
         WHERE si.sale_id = r.sale_id
           AND si.product_id = r.product_id
       ), 0) AS unit_price
     FROM returns r
     INNER JOIN sales s
       ON s.id = r.sale_id
      AND s.branch_id = r.branch_id
     LEFT JOIN activity_log marker
       ON marker.branch_id = r.branch_id
      AND marker.action = ?
      AND marker.details LIKE CONCAT('%[CreditReturn:', r.id, ']%')
     WHERE r.branch_id = ?
       AND marker.id IS NULL
     ORDER BY r.returned_at ASC, r.id ASC
     LIMIT ${MAX_RETURNS_PER_PASS}`,
    [RECONCILIATION_ACTION, branchId]
  );
  return rows;
}

async function applyReturnToDebts(connection, returnRow) {
  const returnedValue = roundMoney(
    Number(returnRow.quantity || 0) * Number(returnRow.unit_price || 0)
  );
  const refundedValue = roundMoney(returnRow.refund_amount);
  let unappliedCredit = roundMoney(
    Math.max(returnedValue - refundedValue, 0)
  );
  let debtReduction = 0;

  const [debts] = await connection.query(
    `SELECT id, sale_id, amount_owed, amount_paid, balance, status
     FROM debts
     WHERE branch_id = ?
       AND sale_id = ?
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [returnRow.branch_id, returnRow.sale_id]
  );

  for (const debt of debts) {
    if (unappliedCredit <= 0) break;

    const oldBalance = roundMoney(debt.balance);
    if (oldBalance <= 0) continue;

    const adjustment = roundMoney(Math.min(unappliedCredit, oldBalance));
    const newBalance = roundMoney(Math.max(oldBalance - adjustment, 0));
    const newAmountOwed = roundMoney(
      Math.max(
        Number(debt.amount_paid || 0),
        Number(debt.amount_owed || 0) - adjustment
      )
    );
    const newStatus = debtStatus(newBalance, debt.amount_paid, adjustment);

    await connection.query(
      `UPDATE debts
       SET amount_owed = ?, balance = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND branch_id = ?`,
      [
        newAmountOwed,
        newBalance,
        newStatus,
        debt.id,
        returnRow.branch_id,
      ]
    );

    debtReduction = roundMoney(debtReduction + adjustment);
    unappliedCredit = roundMoney(unappliedCredit - adjustment);
  }

  if (debtReduction > 0) {
    await connection.query(
      `UPDATE sales
       SET balance = GREATEST(COALESCE(balance, 0) - ?, 0)
       WHERE id = ? AND branch_id = ?`,
      [debtReduction, returnRow.sale_id, returnRow.branch_id]
    );
  }

  const marker = `[CreditReturn:${returnRow.id}]`;
  const details = [
    marker,
    `Receipt ${returnRow.receipt_number || returnRow.sale_id}`,
    `returned value GHS ${returnedValue.toFixed(2)}`,
    `financial refund GHS ${refundedValue.toFixed(2)}`,
    `debt reduced GHS ${debtReduction.toFixed(2)}`,
    unappliedCredit > 0
      ? `GHS ${unappliedCredit.toFixed(2)} required no debt reduction because the outstanding balance was already lower or cleared`
      : "return credit fully reconciled against the available outstanding debt",
  ].join("; ");

  await connection.query(
    `INSERT INTO activity_log (branch_id, user_id, action, details)
     VALUES (?, ?, ?, ?)`,
    [
      returnRow.branch_id,
      returnRow.returned_by || null,
      RECONCILIATION_ACTION,
      details,
    ]
  );

  return {
    returnId: Number(returnRow.id),
    saleId: Number(returnRow.sale_id),
    returnedValue,
    refundedValue,
    debtReduction,
    unappliedCredit,
  };
}

async function reconcileCreditReturnsForBranch(branchId) {
  if (!Number.isInteger(Number(branchId)) || Number(branchId) <= 0) {
    return { processed: 0, adjusted: 0, debtReduction: 0 };
  }

  const connection = await pool.getConnection();
  let lockName = null;
  let transactionStarted = false;

  try {
    const lock = await acquireBranchLock(connection, Number(branchId));
    lockName = lock.lockName;
    if (!lock.acquired) {
      return {
        processed: 0,
        adjusted: 0,
        debtReduction: 0,
        skipped: "reconciliation_busy",
      };
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const returnRows = await loadUnprocessedReturns(
      connection,
      Number(branchId)
    );
    const results = [];

    for (const returnRow of returnRows) {
      results.push(await applyReturnToDebts(connection, returnRow));
    }

    await connection.commit();
    transactionStarted = false;

    return {
      processed: results.length,
      adjusted: results.filter((result) => result.debtReduction > 0).length,
      debtReduction: roundMoney(
        results.reduce((sum, result) => sum + result.debtReduction, 0)
      ),
    };
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    throw error;
  } finally {
    if (lockName) {
      await releaseBranchLock(connection, lockName);
    }
    connection.release();
  }
}

async function reconcileCreditReturnDebts(req, _res, next) {
  const branchId = branchIdFromRequest(req);
  if (!branchId) return next();

  try {
    req.creditReturnDebtReconciliation =
      await reconcileCreditReturnsForBranch(branchId);
    return next();
  } catch (error) {
    console.error("Credit-return debt reconciliation failed:", error);

    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      error.statusCode = error.statusCode || 500;
      error.code = error.code || "CREDIT_RETURN_DEBT_RECONCILIATION_FAILED";
      return next(error);
    }

    // Read pages remain available even when reconciliation encounters an
    // unexpected legacy row. The problem is logged without deleting or hiding
    // any debt, return, sale or payment evidence.
    req.creditReturnDebtReconciliation = {
      processed: 0,
      adjusted: 0,
      debtReduction: 0,
      warning: "reconciliation_failed",
    };
    return next();
  }
}

module.exports = {
  RECONCILIATION_ACTION,
  applyReturnToDebts,
  debtStatus,
  reconcileCreditReturnDebts,
  reconcileCreditReturnsForBranch,
  roundMoney,
};
