const crypto = require("node:crypto");
const { normalizeGhanaPhone } = require("./smsService");

const CAMPAIGN_ID = "excavator-discount-2026-11";
const DEFAULT_MESSAGE =
  "CHALIN03: Great news! Our excavator is available for ready-cash purchase or installment payment at a special discount. Limited-time offer! Hurry and secure yours. For enquiries, call 024 946 9080.";

function validMobile(value) {
  const raw = String(value || "").replace(/\D/g, "");
  // A Ghana mobile number must not begin with a local zero when only nine digits are supplied.
  if (/^0\d{8}$/.test(raw)) return "";
  const formatted = normalizeGhanaPhone(value);
  if (!formatted || !/^\+233[25]\d{8}$/.test(formatted)) return "";
  return formatted;
}

function buildFinanceRecipients(customers = []) {
  const unique = [];
  const seen = new Set();
  let missingOrInvalid = 0;
  let duplicates = 0;
  for (const customer of customers) {
    const phone = validMobile(customer.phone);
    if (!phone) {
      missingOrInvalid += 1;
      continue;
    }
    if (seen.has(phone)) {
      duplicates += 1;
      continue;
    }
    seen.add(phone);
    unique.push({
      customer_id: Number(customer.customer_id || customer.id),
      customer_name: String(customer.customer_name || customer.name || "Customer").slice(0, 120),
      phone,
      portfolio_status: String(customer.portfolio_status || ""),
    });
  }
  return { recipients: unique, invalid_count: missingOrInvalid, duplicate_count: duplicates };
}

function sourceReference(phone) {
  const hash = crypto.createHash("sha256").update(String(phone)).digest("hex").slice(0, 32);
  return "finance-promo:" + CAMPAIGN_ID + ":" + hash;
}

function maskPhone(phone) {
  return String(phone).replace(/(\+233\d{2})\d{4}(\d{3})/, "$1****$2");
}

module.exports = {
  CAMPAIGN_ID,
  DEFAULT_MESSAGE,
  buildFinanceRecipients,
  maskPhone,
  sourceReference,
  validMobile,
};
