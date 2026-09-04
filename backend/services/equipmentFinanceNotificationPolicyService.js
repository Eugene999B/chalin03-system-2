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
  "settlement_ownership",
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
  settlement_ownership: "Settlement & ownership readiness",
  document_share: "Document shares",
});
const DEFAULTS = Object.freeze(Object.fromEntries(CATEGORIES.map((key) => [key, true])));
let schemaPromise = null;
function parseBoolean(value) {
  if ([true,1,"1","true","yes","on","enabled"].includes(value)) return true;
  if ([false,0,"0","false","no","off","disabled"].includes(value)) return false;
  return null;
}
async function ensureNotificationPolicySchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
        id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
        equipment_created TINYINT(1) NOT NULL DEFAULT 1,
        customer_created TINYINT(1) NOT NULL DEFAULT 1,
        application_approved TINYINT(1) NOT NULL DEFAULT 1,
        agreement TINYINT(1) NOT NULL DEFAULT 1,
        deposit TINYINT(1) NOT NULL DEFAULT 1,
        payment TINYINT(1) NOT NULL DEFAULT 1,
        reminders TINYINT(1) NOT NULL DEFAULT 1,
        settlement_ownership TINYINT(1) NOT NULL DEFAULT 1,
        document_share TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT chk_equipment_finance_notification_singleton CHECK (id = 1)
      )`);
      await pool.query(`INSERT INTO ${TABLE} (id) VALUES (1) ON DUPLICATE KEY UPDATE id = id`);
    })().catch((error) => { schemaPromise = null; throw error; });
  }
  await schemaPromise;
}
async function getNotificationPolicy(connection = pool) {
  await ensureNotificationPolicySchema();
  const [rows] = await connection.query(`SELECT * FROM ${TABLE} WHERE id = 1 LIMIT 1`);
  const row = rows[0];
  return Object.fromEntries(CATEGORIES.map((key) => [key, row ? Boolean(Number(row[key])) : DEFAULTS[key]]));
}
async function updateNotificationPolicy(input = {}, connection = pool) {
  await ensureNotificationPolicySchema();
  const current = await getNotificationPolicy(connection);
  const next = { ...current };
  const changed = [];
  for (const key of CATEGORIES) {
    if (input[key] === undefined) continue;
    const value = parseBoolean(input[key]);
    if (value === null) { const error = new Error(`${LABELS[key]} setting must be true or false.`); error.statusCode = 400; error.code = "INVALID_NOTIFICATION_CONTROL"; throw error; }
    next[key] = value;
    if (next[key] !== current[key]) changed.push(key);
  }
  if (!changed.length) return { changed: false, changed_categories: [], controls: current };
  const assignment = CATEGORIES.map((key) => `\`${key}\` = ?`).join(", ");
  await connection.query(`UPDATE ${TABLE} SET ${assignment}, updated_at = NOW() WHERE id = 1`, CATEGORIES.map((key) => next[key] ? 1 : 0));
  return { changed: true, changed_categories: changed, controls: next };
}
async function isNotificationEnabled(category, connection = pool) {
  if (!CATEGORIES.includes(String(category))) return true;
  try { return (await getNotificationPolicy(connection))[category] !== false; }
  catch (error) { console.warn(`Installment notification policy check failed-open for ${category}:`, error.message); return true; }
}
module.exports = { CATEGORIES, DEFAULTS, LABELS, ensureNotificationPolicySchema, getNotificationPolicy, isNotificationEnabled, updateNotificationPolicy };
