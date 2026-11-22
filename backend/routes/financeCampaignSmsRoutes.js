const express = require("express");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { buildRateLimiter } = require("../middleware/securityMiddleware");
const { listFinanceCustomers } = require("../services/equipmentFinanceCustomerPortfolioService");
const { getSmsConfig } = require("../services/smsService");
const { sendSmsAlertToPhone } = require("../services/smsAlertService");
const {
  CAMPAIGN_ID,
  DEFAULT_MESSAGE,
  buildFinanceRecipients,
  maskPhone,
  sourceReference,
  validMobile,
} = require("../services/financeSmsCampaignService");

const router = express.Router();
function providerReady(config) {
  if (!config.enabled || !config.senderId) return false;
  if (config.provider === "arkesel") return Boolean(config.arkeselApiKey);
  if (config.provider === "hubtel") return Boolean(config.hubtelClientId && config.hubtelClientSecret);
  return false;
}

const MAX_RECIPIENTS = 200;
const CONFIRMATION = "SEND EXCAVATOR OFFER";
const rateLimit = buildRateLimiter({
  windowMinutes: 15,
  max: 5,
  message: "Please check the campaign history before submitting another SMS batch.",
});

function operatorOnly(req, res, next) {
  if (!["admin", "manager"].includes(String(req.user?.role || "").toLowerCase())) {
    return res.status(403).json({ message: "Only authorised managers can send Finance campaigns." });
  }
  return next();
}

function fail(res, code, message) {
  return res.status(code).json({ status: "error", message });
}

function safeHandler(fn) {
  return async (req, res, next) => {
    try {
      return await fn(req, res);
    } catch (error) {
      return next(error);
    }
  };
}

async function currentRecipients() {
  // The Finance portfolio contains finance applicants/account holders only, not Spare Parts or Hire customers.
  const portfolio = await listFinanceCustomers({ limit: 500 });
  const audience = buildFinanceRecipients(portfolio.customers || []);
  return {
    ...audience,
    finance_customers: Number(portfolio.summary?.customers || portfolio.count || 0),
    ready: Boolean(portfolio.readiness),
  };
}

router.use(requireAuth, operatorOnly, requirePermission("fleet.assets.view"));

router.get("/preview", safeHandler(async (_req, res) => {
  const audience = await currentRecipients();
  const config = getSmsConfig();
  res.json({
    status: "success",
    campaign_id: CAMPAIGN_ID,
    default_message: DEFAULT_MESSAGE,
    finance_customer_count: audience.finance_customers,
    valid_unique_phone_count: audience.recipients.length,
    invalid_count: audience.invalid_count,
    duplicate_count: audience.duplicate_count,
    sms_enabled: Boolean(config.enabled),
    live_sending: providerReady(config),
    provider: config.provider,
    confirmation_text: CONFIRMATION,
    recipients: audience.recipients.map((row) => ({
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      masked_phone: maskPhone(row.phone),
      portfolio_status: row.portfolio_status,
    })),
  });
}));

router.get("/history", safeHandler(async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT id, recipient_phone, sms_type, status, created_at, provider_message_id, source_reference, status_reason FROM sms_log WHERE source_reference LIKE ? ORDER BY id DESC LIMIT 150",
    ["finance-promo:" + CAMPAIGN_ID + ":%"]
  );
  res.json({
    status: "success",
    messages: rows.map((row) => ({
      id: row.id,
      masked_phone: maskPhone(row.recipient_phone),
      status: row.status,
      created_at: row.created_at,
      provider_message_id: row.provider_message_id,
      status_reason: row.status_reason,
    })),
  });
}));

router.post("/send",
  requirePermission("fleet.assets.manage"),
  rateLimit,
  safeHandler(async (req, res) => {
    const { confirmation, offer_verified, contact_consent_confirmed } = req.body || {};
    if (String(confirmation || "").trim().toUpperCase() !== CONFIRMATION) {
      return fail(res, 400, "Type " + CONFIRMATION + " to confirm the campaign.");
    }
    if (offer_verified !== true) {
      return fail(res, 400, "Verify the excavator offer, availability and discount with management first.");
    }
    if (contact_consent_confirmed !== true) {
      return fail(res, 400, "Confirm that every selected recipient is eligible for promotional SMS.");
    }

    const message = String(req.body.message || DEFAULT_MESSAGE).trim();
    if (!message || message.length > 480) return fail(res, 400, "Message must be 1-480 characters.");

    const config = getSmsConfig();
    if (!providerReady(config)) {
      return fail(res, 409, "Live SMS sending is not enabled. No campaign messages were sent.");
    }

    const targetType = String(req.body.target_type || "all");
    let recipients = [];

    if (targetType === "single") {
      const phone = validMobile(req.body.phone);
      if (!phone) return fail(res, 400, "A valid Ghana mobile number is required (10 digits starting 02 or 05).");
      recipients = [{ customer_id: null, customer_name: "Manual recipient", phone }];
    } else if (targetType === "all" || targetType === "selected") {
      const audience = await currentRecipients();
      if (targetType === "all") {
        recipients = audience.recipients;
      } else {
        const chosen = new Set(
          (Array.isArray(req.body.customer_ids) ? req.body.customer_ids : [])
            .map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
        );
        recipients = audience.recipients.filter((recipient) => chosen.has(recipient.customer_id));
      }
    } else {
      return fail(res, 400, "Choose all, selected or single recipients.");
    }

    if (!recipients.length) return fail(res, 400, "No valid recipients match this selection.");
    if (recipients.length > MAX_RECIPIENTS) return fail(res, 400, "Campaign limit is 200 unique numbers.");

    // A named MySQL lock prevents simultaneous submissions from sending the same campaign twice.
    const connection = await pool.getConnection();
    let locked = false;
    try {
      const [[lockRow]] = await connection.query(
        "SELECT GET_LOCK('chalin03_finance_campaign_202611', 0) AS acquired"
      );
      locked = Number(lockRow?.acquired) === 1;
      if (!locked) return fail(res, 409, "Another campaign submission is in progress. Check history before retrying.");

      const results = [];
      for (const recipient of recipients) {
        const ref = sourceReference(recipient.phone);
        const [prior] = await connection.query(
          "SELECT id, status FROM sms_log WHERE source_reference = ? ORDER BY id DESC LIMIT 1",
          [ref]
        );
        if (prior.length) {
          results.push({
            customer_id: recipient.customer_id,
            customer_name: recipient.customer_name,
            masked_phone: maskPhone(recipient.phone),
            status: "already_processed",
            existing_sms_log_id: prior[0].id,
          });
          continue;
        }
        const result = await sendSmsAlertToPhone({
          branchId: Number(req.user?.branch_id || 1) || 1,
          phone: recipient.phone,
          message,
          smsType: "other",
          sentBy: Number(req.user?.id || req.user?.user_id) || null,
          sourceReference: ref,
        });
        results.push({
          customer_id: recipient.customer_id,
          customer_name: recipient.customer_name,
          masked_phone: maskPhone(recipient.phone),
          status: result.status || "failed",
          log_id: result.log_id || null,
          error: result.error || result.reason || null,
        });
      }
      const counts = {};
      for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
      return res.status(202).json({
        status: "accepted",
        message: "SMS submission checked. Provider acceptance is not proof of delivery.",
        total_recipients: results.length,
        counts,
        results,
      });
    } finally {
      if (locked) {
        try { await connection.query("SELECT RELEASE_LOCK('chalin03_finance_campaign_202611')"); }
        catch (error) { console.warn("Finance campaign lock release:", error.message); }
      }
      connection.release();
    }
  })
);

module.exports = router;
