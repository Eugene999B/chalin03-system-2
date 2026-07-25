const { pool } = require("../config/db");

const MINING_APPROVAL_RECORDS = Object.freeze({
  "daily-logs": "mining_daily_logs",
  production: "mining_production_records",
  "equipment-logs": "mining_equipment_logs",
  expenses: "mining_expenses",
});

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function independentApprovalResponse(res, subject) {
  return res.status(409).json({
    status: "error",
    code: "INDEPENDENT_APPROVER_REQUIRED",
    message: `The person who prepared this ${subject} cannot approve the same record. Ask another authorised manager, accountant or administrator to approve it.`,
  });
}

async function preventMiningSelfApproval(req, res, next) {
  try {
    if (req.method !== "PATCH") return next();

    const match = String(req.path || "").match(
      /^\/(daily-logs|production|equipment-logs|expenses)\/(\d+)\/approve\/?$/
    );
    if (!match) return next();

    const tableName = MINING_APPROVAL_RECORDS[match[1]];
    const recordId = positiveId(match[2]);
    if (!tableName || !recordId) return next();

    const [rows] = await pool.query(
      `SELECT id, created_by
       FROM \`${tableName}\`
       WHERE id = ?
       LIMIT 1`,
      [recordId]
    );

    const record = rows[0];
    if (
      record &&
      positiveId(record.created_by) &&
      Number(record.created_by) === Number(req.user?.id)
    ) {
      const label = match[1].replaceAll("-", " ").replace(/s$/, "");
      return independentApprovalResponse(res, label);
    }

    return next();
  } catch (error) {
    console.error("Mining independent-approval validation failed:", error);
    return res.status(500).json({
      status: "error",
      code: "INDEPENDENT_APPROVAL_CHECK_FAILED",
      message: "The Mining approval separation check could not be completed safely.",
    });
  }
}

async function preventStockTransferSelfApproval(req, res, next) {
  try {
    if (req.method !== "POST") return next();

    const match = String(req.path || "").match(/^\/(\d+)\/approve\/?$/);
    if (!match) return next();

    const transferId = positiveId(match[1]);
    if (!transferId) return next();

    const [rows] = await pool.query(
      `SELECT id, requested_by
       FROM stock_transfers
       WHERE id = ?
       LIMIT 1`,
      [transferId]
    );

    const transfer = rows[0];
    if (
      transfer &&
      positiveId(transfer.requested_by) &&
      Number(transfer.requested_by) === Number(req.user?.id)
    ) {
      return independentApprovalResponse(res, "stock transfer request");
    }

    return next();
  } catch (error) {
    console.error("Stock-transfer independent-approval validation failed:", error);
    return res.status(500).json({
      status: "error",
      code: "INDEPENDENT_APPROVAL_CHECK_FAILED",
      message: "The stock-transfer approval separation check could not be completed safely.",
    });
  }
}

module.exports = {
  MINING_APPROVAL_RECORDS,
  preventMiningSelfApproval,
  preventStockTransferSelfApproval,
};
