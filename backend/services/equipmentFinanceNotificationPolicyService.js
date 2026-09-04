const { pool } = require("../config/db");

const TABLE = "equipment_finance_notification_settings";
const CATEGORIES = Object.freeze([
  "equipment_created",
  "customer_created",
  "application_approved",
  "agreement",
  "deposit",
  "payment",
  "reminders",
  "document_share",
]);
const LABELS = Object.freeze({
  equipment_created: "Equipment & machine created",
  customer_created: "Customer & account created",
  application_approved: "Credit applications approved",
  agreement: "Agreements activated",
  deposit: "Deposits & reservations",
  payment: "Payments & collections",
  reminders: "Due, overdue & arrears reminders",
  document_share: "Document shares",
});
const DEFAULTS = Object.freeze(Object.fromEntries(CATEGORIES.map((key) => [key, true])));

function parseBoolean(value) {
  if ([true, 1, "1", "true", "yes", "on", "enabled"].includes(value)) return true;
  if ([false, 0, "0", "false", "no", "off", "disabled"].includes(value)) return false;
  return null;
}

async function getNotificationPolicy(connection = pool) {
  const [rows] = await connection.query(`SELECT * FROM ${TABLE} WHERE id = 1 LIMIT 1`);
  const row = rows[0];
  return Object.fromEntries(
    CATEGORIES.map((key) => [key, row ? Boolean(Number(row[key])) : DEFAULTS[key]])
  );
}

async function updateNotificationPolicy(input = {}, connection = pool) {
  const current = await getNotificationPolicy(connection);
  const next = { ...current };
  const changed = [];
  for (const key of CATEGORIES) {
    if (input[key] === undefined) continue;
    const value = parseBoolean(input[key]);
    if (value === null) {
      const error = new Error(`${LABELS[key]} setting must be true or false.`);
      error.statusCode = 400;
      error.code = "INVALID_NOTIFICATION_CONTROL";
      throw error;
    }
    next[key] = value;
    if (next[key] !== current[key]) changed.push(key);
  }
  if (!changed.length) return { changed: false, changed_categories: [], controls: current };
  const assignment = CATEGORIES.map((key) => `\`${key}\` = ?`).join(", ");
  await connection.query(
    `UPDATE ${TABLE} SET ${assignment}, updated_at = NOW() WHERE id = 1`,
    CATEGORIES.map((key) => (next[key] ? 1 : 0))
  );
  return { changed: true, changed_categories: changed, controls: next };
}

async function isNotificationEnabled(category, connection = pool) {
  if (!CATEGORIES.includes(String(category))) return true;
  try {
    const controls = await getNotificationPolicy(connection);
    return controls[category] === true;
  } catch (error) {
    console.warn(`Installment notification policy unavailable; blocking ${category}:`, error.message);
    return false;
  }
}

module.exports = {
  CATEGORIES,
  DEFAULTS,
  LABELS,
  getNotificationPolicy,
  isNotificationEnabled,
  updateNotificationPolicy,
};
