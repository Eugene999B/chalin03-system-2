const { pool } = require("../config/db");
const base = require("./equipmentInstallmentReadModelService");

function normalizeDate(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

async function futureDueMap(agreementIds) {
  const ids = [...new Set(agreementIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT agreement_id,
            MIN(due_date) AS next_due_date
       FROM equipment_installment_schedule
      WHERE agreement_id IN (${placeholders})
        AND schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
        AND due_date >= CURDATE()
      GROUP BY agreement_id`,
    ids
  );
  return new Map(rows.map((row) => [Number(row.agreement_id), normalizeDate(row.next_due_date)]));
}

async function sanitizeAccounts(accounts) {
  if (!Array.isArray(accounts) || !accounts.length) return accounts || [];
  const ids = accounts.map((row) => row.agreement_id);
  const nextMap = await futureDueMap(ids);
  return accounts.map((row) => {
    const next = nextMap.get(Number(row.agreement_id)) || null;
    return {
      ...row,
      next_due_date: next,
      next_schedule_due_date: next,
      days_until_due: next ? base.deriveAccount({ ...row, next_due_date: next }).days_until_due : null,
    };
  });
}

async function getInstallmentPortfolio(options = {}) {
  const result = await base.getInstallmentPortfolio(options);
  result.urgent_accounts = await sanitizeAccounts(result.urgent_accounts);
  result.upcoming_accounts = await sanitizeAccounts(result.upcoming_accounts);
  return result;
}

async function listInstallmentCollections(options = {}) {
  const result = await base.listInstallmentCollections(options);
  result.accounts = await sanitizeAccounts(result.accounts);
  return result;
}

module.exports = {
  ...base,
  getInstallmentPortfolio,
  listInstallmentCollections,
};
