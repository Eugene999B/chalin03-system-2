const crypto = require("crypto");
const { pool } = require("../config/db");
const {
  nextDueFromSchedule,
  describeDueDate,
  agreementLateFeePolicy,
} = require("../services/equipmentFinanceAuthoritativePolicyService");

function createRequestId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return crypto.randomBytes(16).toString("hex");
}

function financeLifecyclePath(path = "") {
  return path.startsWith("/api/equipment-catalogue/sales/finance-lifecycle/accounts");
}

async function enrichFinanceAccountBody(body) {
  if (!body || typeof body !== "object") return body;
  const accounts = Array.isArray(body.accounts)
    ? body.accounts
    : body.account?.agreement_id
      ? [body.account]
      : [];
  if (!accounts.length) return body;

  const ids = [...new Set(
    accounts
      .map((account) => Number(account.agreement_id))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];
  if (!ids.length) return body;

  const placeholders = ids.map(() => "?").join(",");
  // Only fetch the single authoritative unpaid current/future schedule line
  // per agreement. This keeps the list endpoint bounded even for long terms.
  const [rows] = await pool.query(
    `WITH ranked_schedule AS (
       SELECT schedule.*,
              ROW_NUMBER() OVER (
                PARTITION BY schedule.agreement_id
                ORDER BY schedule.due_date, schedule.sequence_number
              ) AS finance_due_rank
          FROM equipment_installment_schedule schedule
         WHERE schedule.agreement_id IN (${placeholders})
           AND schedule.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
           AND schedule.due_date >= CURRENT_DATE
           AND GREATEST(
                 schedule.scheduled_amount + schedule.late_charge_amount -
                 schedule.waived_charge_amount - schedule.amount_paid,
                 0
               ) > 0.01
     )
     SELECT *
       FROM ranked_schedule
      WHERE finance_due_rank = 1`,
    ids
  );
  const [agreements] = await pool.query(
    `SELECT id, policy_version_snapshot, late_charge_type_snapshot, late_charge_value_snapshot,
            late_charge_cap_snapshot, grace_days_snapshot, reconciliation_status,
            reconciliation_checked_at
       FROM equipment_sale_agreements
      WHERE id IN (${placeholders})`,
    ids
  );

  const agreementMap = new Map(agreements.map((agreement) => [Number(agreement.id), agreement]));
  const scheduleMap = new Map(rows.map((row) => [Number(row.agreement_id), [row]]));
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const enriched = accounts.map((account) => {
    const id = Number(account.agreement_id);
    const agreement = agreementMap.get(id) || account;
    const schedule = scheduleMap.get(id) || [];
    const next = nextDueFromSchedule(schedule, today);
    const due = describeDueDate({ row: next?.row || null, today, agreement });
    const policy = agreementLateFeePolicy(agreement);
    return {
      ...account,
      next_due_date: due.date,
      next_due_amount: due.amount,
      next_due_status: due.status,
      next_due_days: due.daysUntilDue,
      next_due_late_fee_warning: due.lateFeeWarningAmount,
      reconciliation_status:
        agreement.reconciliation_status ||
        (policy.legacyReviewRequired ? "review_required" : "unknown"),
      reconciliation_checked_at: agreement.reconciliation_checked_at || null,
      policy_version_snapshot: agreement.policy_version_snapshot || null,
      legacy_policy_review_required: policy.legacyReviewRequired,
    };
  });

  if (Array.isArray(body.accounts)) return { ...body, accounts: enriched };
  return { ...body, account: enriched[0] };
}

function requestContext(req, res, next) {
  const inboundRequestId =
    req.headers["x-request-id"] || req.headers["x-correlation-id"];
  const requestId = String(inboundRequestId || createRequestId())
    .trim()
    .slice(0, 80);

  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);

  // The legacy branch-based installment ledger is retired from live use. Keep
  // the old implementation in the repository for historical recovery only.
  if (req.path === "/api/installments" || req.path.startsWith("/api/installments/")) {
    return res.status(410).json({
      status: "error",
      code: "LEGACY_INSTALLMENT_API_RETIRED",
      message:
        "The legacy installment API has been retired. Use the Equipment Installment Finance workspace.",
      request_id: requestId,
    });
  }

  // Read-model enrichment is GET-only so payment/deposit mutation responses
  // never pay an extra database-query cost and the critical mutation path
  // remains exactly as before.
  if (req.method === "GET" && financeLifecyclePath(req.path)) {
    const sendJson = res.json.bind(res);
    res.json = function financeLifecycleJson(body) {
      void enrichFinanceAccountBody(body)
        .then((enriched) => sendJson(enriched))
        .catch((error) => {
          console.error("Finance account read-model enrichment failed:", error);
          sendJson(body);
        });
      return res;
    };
  }

  next();
}

module.exports = {
  requestContext,
  createRequestId,
  enrichFinanceAccountBody,
};
