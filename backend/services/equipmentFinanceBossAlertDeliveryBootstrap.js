const { getProfessionalSettings } = require("./equipmentFinanceProfessionalService");
const { sendSmsAlertToPhone } = require("./smsAlertService");
const { pool } = require("../config/db");

const INSTALL_FLAG = Symbol.for("chalin03.equipmentFinanceBossAlertDeliveryInstalled");
const POLL_MS = Math.max(1000, Number(process.env.EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS) || 2000);
const BATCH_SIZE = 100;
const IMPORTANT_FINANCE_ACTIONS = new Set([
  "EQUIPMENT_CREDIT_APPLICATION_ADMIN_APPROVED",
  "EQUIPMENT_FINANCE_CUSTOMER_CREATED",
  "EQUIPMENT_FINANCE_MACHINE_REGISTERED",
  "EQUIPMENT_FINANCE_COLLECTION_RECORDED",
  "EQUIPMENT_FINANCE_DEPOSIT_RECORDED",
  "EQUIPMENT_FINANCE_AGREEMENT_ACTIVATED",
]);
const NOISY_FINANCE_ACTIONS = new Set([
  "EQUIPMENT_FINANCE_MACHINE_UPDATED",
  "EQUIPMENT_FINANCE_MANAGEMENT_EXPORT_GENERATED",
  "EQUIPMENT_FINANCE_INSTALLMENT_STARTED",
]);

function clean(value, max = 240) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}
function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `GHS ${number.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "";
}
function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { const parsed = JSON.parse(String(value)); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; }
}
function findValue(metadata, keys) {
  for (const key of keys) if (metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== "") return metadata[key];
  return null;
}
function eventKind(row, metadata) {
  const text = `${clean(row?.action, 220)} ${clean(row?.action_type, 220)} ${clean(row?.entity_type, 140)} ${clean(row?.details, 1000)}`.toLowerCase();
  if (/admin.*approv|credit.*application.*approv/.test(text)) return "application_approved";
  if (/machine.*(register|creat)|equipment.*(register|creat)|equipment_catalogue_asset_created|_machine_registered|machine\.register/.test(text)) return "machine_created";
  if (/customer.*(creat|register)|customer\.creat/.test(text)) return "customer_created";
  if (/opening.*deposit|deposit.*reservation|deposit/.test(text)) return "deposit";
  if (/payment|collection/.test(text) || String(row?.entity_type || "").toLowerCase() === "equipment_sale_payment") return "payment";
  if (/agreement.*(activat|creat)|agreement\.activat/.test(text)) return "agreement";
  if (/update|updated|edit|edited|change|changed|setting/.test(text) || /(amount|price|deposit|financed|balance|installment|payment|total|selling|hire_rate|periodic)/i.test(`${Object.keys(metadata).join(" ")} ${row?.details || ""}`)) return "edited";
  return "finance_activity";
}
function isFinanceActivity(row) {
  const action = clean(row?.action, 200).toUpperCase();
  const workspace = clean(row?.workspace_code, 100).toLowerCase();
  if (NOISY_FINANCE_ACTIONS.has(action)) return false;
  if (IMPORTANT_FINANCE_ACTIONS.has(action)) return true;
  if (workspace !== "equipment_installment_finance") return false;
  return ["machine_created", "customer_created", "deposit", "payment", "agreement", "application_approved"].includes(eventKind(row, parseMetadata(row?.metadata_json)));
}
function buildActivityMessage(row) {
  const metadata = parseMetadata(row?.metadata_json);
  const kind = eventKind(row, metadata);
  const agreement = clean(findValue(metadata, ["agreement_number", "agreement", "agreementNumber"]), 80);
  const application = clean(findValue(metadata, ["application_number", "application", "applicationNumber"]), 90);
  const asset = clean(findValue(metadata, ["asset_code", "equipment_code", "machine_code", "asset_name", "equipment_name"]), 110);
  const customer = clean(findValue(metadata, ["customer_name", "customer"]), 120);
  const receipt = clean(findValue(metadata, ["receipt_number", "receipt"]), 80);
  const staff = clean(findValue(metadata, ["staff_name", "received_by", "created_by_name", "updated_by_name"]), 100);
  const method = clean(findValue(metadata, ["payment_method", "method"]), 50);
  const amount = findValue(metadata, ["amount", "payment_amount", "deposit_amount", "total_amount", "target_selling_price", "proposed_deposit", "financed_amount", "proposed_installment_amount"]);
  const balance = findValue(metadata, ["outstanding_balance", "balance", "remaining_balance"]);
  const dueDate = clean(findValue(metadata, ["next_due_date", "due_date", "first_due_date"]), 30);
  const installment = findValue(metadata, ["proposed_installment_amount", "installment_amount", "periodic_amount"]);
  const frequency = clean(findValue(metadata, ["proposed_frequency", "frequency", "payment_frequency"]), 40);
  const count = findValue(metadata, ["proposed_installment_count", "installment_count", "number_of_installments"]);
  const changedFields = findValue(metadata, ["changed_fields", "changedFields", "fields_changed"]);
  const details = clean(row?.details, 260);
  const identity = [customer, agreement || application, asset].filter(Boolean).join(" | ") || clean(row?.entity_id, 80) || "Finance record";
  const who = staff ? `Processed by ${staff}.` : "Processed by Chalin 03 Finance.";
  const amountText = amount !== null && amount !== "" ? `Amount ${money(amount) || clean(amount, 50)}.` : "";
  const balanceText = balance !== null && balance !== "" ? `Remaining balance ${money(balance) || clean(balance, 50)}.` : "";
  const planText = [installment !== null && installment !== "" ? `Installment ${money(installment) || clean(installment, 50)}` : "", frequency ? `every ${frequency}` : "", count ? `${count} instalments` : "", dueDate ? `next due ${dueDate}` : ""].filter(Boolean).join(", ");
  switch (kind) {
    case "application_approved":
      return `CHALIN 03 FINANCE: Credit application ${application || agreement || identity} has been approved for ${customer || "the customer"}. Equipment: ${asset || "not specified"}.${agreement ? ` Agreement: ${agreement}.` : ""} ${amountText} ${planText ? `Plan: ${planText}.` : ""} ${who}`.replace(/\s+/g, " ").trim();
    case "machine_created":
      return `CHALIN 03 FINANCE: Equipment ${asset || identity} has been registered for installment finance${customer ? ` for ${customer}` : ""}.${amountText} ${details ? `Details: ${details}.` : ""} ${who}`.replace(/\s+/g, " ").trim();
    case "customer_created":
      return `CHALIN 03 FINANCE: New finance customer ${customer || identity} has been created.${application ? ` Application: ${application}.` : ""}${asset ? ` Equipment: ${asset}.` : ""} ${who}`.replace(/\s+/g, " ").trim();
    case "deposit":
      return `CHALIN 03 FINANCE: Opening deposit recorded for ${customer || "customer"}.${agreement ? ` Agreement: ${agreement}.` : ""}${asset ? ` Equipment: ${asset}.` : ""} ${amountText}${method ? ` Method: ${method}.` : ""}${receipt ? ` Receipt: ${receipt}.` : ""} ${balanceText} ${who}`.replace(/\s+/g, " ").trim();
    case "payment":
      return `CHALIN 03 FINANCE: Payment received from ${customer || "customer"}.${agreement ? ` Agreement: ${agreement}.` : ""}${asset ? ` Equipment: ${asset}.` : ""} ${amountText}${method ? ` Method: ${method}.` : ""}${receipt ? ` Receipt: ${receipt}.` : ""} ${balanceText} ${who}`.replace(/\s+/g, " ").trim();
    case "agreement":
      return `CHALIN 03 FINANCE: Installment agreement ${agreement || identity} is now active for ${customer || "customer"}.${asset ? ` Equipment: ${asset}.` : ""} ${amountText}${planText ? ` Plan: ${planText}.` : ""} ${balanceText} ${who}`.replace(/\s+/g, " ").trim();
    default:
      return `CHALIN 03 FINANCE: Finance activity recorded for ${identity}. ${details || "No additional details were recorded."} ${who}`.replace(/\s+/g, " ").trim();
  }
}
async function professionalBossSettings() {
  const settings = await getProfessionalSettings();
  return { enabled: Boolean(Number(settings?.boss_payment_alert_enabled)), phone: clean(settings?.boss_payment_alert_phone, 40) };
}
async function sourceAlreadyLogged(sourceReference) {
  try { const [rows] = await pool.query("SELECT id FROM sms_log WHERE source_reference = ? LIMIT 1", [sourceReference]); return rows.length > 0; } catch (error) { console.warn("Boss SMS duplicate check skipped:", error.message); return false; }
}
async function repairLegacyBossAlertMessages() {
  try {
    const [rows] = await pool.query(`SELECT sms.id, activity.id AS activity_id, activity.branch_id, activity.user_id, activity.action, activity.details, activity.workspace_code, activity.entity_type, activity.entity_id, activity.action_type, activity.outcome, activity.severity, activity.metadata_json FROM sms_log sms INNER JOIN activity_log activity ON activity.id = CAST(SUBSTRING_INDEX(sms.source_reference, ':', -1) AS UNSIGNED) WHERE sms.sms_type = 'equipment_finance_boss_alert' AND sms.source_reference LIKE 'equipment-finance-boss-activity:%' ORDER BY sms.id ASC LIMIT 5000`);
    for (const row of rows) {
      if (NOISY_FINANCE_ACTIONS.has(clean(row.action, 200).toUpperCase())) continue;
      await pool.query("UPDATE sms_log SET message = ? WHERE id = ? LIMIT 1", [buildActivityMessage(row), row.id]);
    }
    if (rows.length) console.log(`Finance boss SMS history message intelligence repaired: ${rows.length} record(s).`);
  } catch (error) {
    if (!/unknown table|doesn't exist|unknown column/i.test(String(error.message || ""))) console.warn("Finance boss SMS history repair skipped:", error.message);
  }
}
async function deliverFinanceActivityBossAlert(row) {
  const sourceReference = `equipment-finance-boss-activity:${Number(row.id)}`;
  if (await sourceAlreadyLogged(sourceReference)) return;
  const settings = await professionalBossSettings();
  if (!settings.enabled || !settings.phone) return;
  const message = buildActivityMessage(row);
  const result = await sendSmsAlertToPhone({ branchId: Number(row.branch_id || 1), phone: settings.phone, message, logMessage: message, smsType: "equipment_finance_boss_alert", sentBy: row.user_id || null, sourceReference });
  if (!result?.ok && !result?.delivery_confirmed) console.warn(`Finance boss alert ${row.id} did not confirm acceptance: ${result?.status || "unknown"}.`);
}
let activityCursor = 0;
let pollPromise = null;
async function initialiseActivityCursor() {
  try { const [[row]] = await pool.query("SELECT COALESCE(MAX(id), 0) AS max_id FROM activity_log"); activityCursor = Math.max(0, Number(row?.max_id || 0) - 50); } catch (error) { console.warn("Finance boss alert cursor initialization skipped:", error.message); activityCursor = 0; }
}
async function pollFinanceActivity() {
  if (pollPromise) return pollPromise;
  pollPromise = (async () => {
    try {
      const [rows] = await pool.query(`SELECT id, branch_id, user_id, action, details, workspace_code, entity_type, entity_id, action_type, outcome, severity, metadata_json FROM activity_log WHERE id > ? AND outcome = 'success' AND (workspace_code = 'equipment_installment_finance' OR action LIKE '%EQUIPMENT_FINANCE%' OR action LIKE '%equipment_finance%' OR action LIKE 'EQUIPMENT_CATALOGUE_ASSET_%' OR action_type LIKE 'equipment.finance.%' OR entity_type IN ('equipment_sale_payment','equipment_sale_agreement','fleet_asset','equipment_customer')) ORDER BY id ASC LIMIT ?`, [activityCursor, BATCH_SIZE]);
      for (const row of rows) { activityCursor = Math.max(activityCursor, Number(row.id || 0)); if (!isFinanceActivity(row)) continue; try { await deliverFinanceActivityBossAlert(row); } catch (error) { console.error(`Finance boss alert ${row.id} failed:`, error.message); } }
    } catch (error) { if (!/unknown table|doesn't exist/i.test(String(error.message || ""))) console.warn("Finance boss activity poll failed:", error.message); }
    finally { pollPromise = null; }
  })();
  return pollPromise;
}
function installEquipmentFinanceBossAlertDelivery() {
  if (globalThis[INSTALL_FLAG]) return false;
  void repairLegacyBossAlertMessages().finally(() => void initialiseActivityCursor().then(() => void pollFinanceActivity()));
  const timer = setInterval(() => void pollFinanceActivity(), POLL_MS); timer.unref?.();
  Object.defineProperty(globalThis, INSTALL_FLAG, { value: true, configurable: false, enumerable: false, writable: false });
  return true;
}
installEquipmentFinanceBossAlertDelivery();
module.exports = { buildActivityMessage, deliverFinanceActivityBossAlert, eventKind, installEquipmentFinanceBossAlertDelivery, isFinanceActivity, parseMetadata };