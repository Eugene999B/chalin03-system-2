const { getProfessionalSettings } = require("./equipmentFinanceProfessionalService");
const { sendSmsAlertToPhone } = require("./smsAlertService");
const { pool } = require("../config/db");
const { isNotificationEnabled } = require("./equipmentFinanceNotificationPolicyService");

const INSTALL_FLAG = Symbol.for("chalin03.equipmentFinanceBossAlertDeliveryInstalled");
const POLL_MS = Math.max(1000, Number(process.env.EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS) || 2000);
const BATCH_SIZE = 100;
const IMPORTANT_FINANCE_ACTIONS = new Set([
  "EQUIPMENT_CREDIT_APPLICATION_ADMIN_APPROVED",
  "EQUIPMENT_FINANCE_CUSTOMER_CREATED",
  "EQUIPMENT_FINANCE_MACHINE_REGISTERED",
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
  return Number.isFinite(number)
    ? `GHS ${number.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "";
}
function dateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value, 30);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Accra" });
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
function firstMatch(text, expressions) {
  for (const expression of expressions) {
    const match = String(text || "").match(expression);
    if (match?.[1]) return clean(match[1], 140);
  }
  return "";
}
function eventKind(row, metadata) {
  const action = clean(row?.action, 220).toUpperCase();
  if (NOISY_FINANCE_ACTIONS.has(action)) return "noise";
  if (action === "EQUIPMENT_CREDIT_APPLICATION_ADMIN_APPROVED") return "application_approved";
  if (action === "EQUIPMENT_FINANCE_CUSTOMER_CREATED") return "customer_created";
  if (action === "EQUIPMENT_FINANCE_MACHINE_REGISTERED" || action === "EQUIPMENT_CATALOGUE_ASSET_CREATED") return "machine_created";
  if (action === "EQUIPMENT_FINANCE_DEPOSIT_RECORDED") return "deposit";
  if (action === "EQUIPMENT_FINANCE_AGREEMENT_ACTIVATED") return "agreement";
  const text = `${clean(row?.action, 220)} ${clean(row?.action_type, 220)} ${clean(row?.entity_type, 140)} ${clean(row?.details, 1000)}`.toLowerCase();
  if (/admin.*approv|credit.*application.*approv/.test(text)) return "application_approved";
  if (/machine.*(register|creat)|equipment.*(register|creat)|equipment_catalogue_asset_created|_machine_registered|machine\.register/.test(text)) return "machine_created";
  if (/customer.*(creat|register)|customer\.creat/.test(text)) return "customer_created";
  if (/opening.*deposit|deposit.*reservation|deposit/.test(text)) return "deposit";
  if (/payment|collection/.test(text) || String(row?.entity_type || "").toLowerCase() === "equipment_sale_payment") return "payment";
  if (/agreement.*(activat|creat)|agreement\.activat/.test(text)) return "agreement";
  return "finance_activity";
}
async function notificationCategoryEnabled(category) {
  if (!category) return true;
  return isNotificationEnabled(category);
}
function notificationCategoryForEventKind(kind) {
  return { machine_created: "equipment_created", customer_created: "customer_created", application_approved: "application_approved", agreement: "agreement", deposit: "deposit" }[kind] || null;
}
function isFinanceActivity(row) {
  const action = clean(row?.action, 200).toUpperCase();
  const workspace = clean(row?.workspace_code, 100).toLowerCase();
  if (NOISY_FINANCE_ACTIONS.has(action)) return false;
  if (action === "EQUIPMENT_FINANCE_COLLECTION_RECORDED") return false;
  if (IMPORTANT_FINANCE_ACTIONS.has(action)) return true;
  if (workspace !== "equipment_installment_finance") return false;
  return ["machine_created", "customer_created", "deposit", "agreement", "application_approved"].includes(eventKind(row, parseMetadata(row?.metadata_json)));
}
async function enrichActivityRow(row) {
  const metadata = parseMetadata(row?.metadata_json);
  const entityType = clean(row?.entity_type, 100).toLowerCase();
  const entityId = Number(row?.entity_id || 0);
  const context = {};
  try {
    if (entityId > 0 && /credit_application/.test(entityType)) {
      const [rows] = await pool.query(`SELECT application.application_number, application.quoted_total,
          application.proposed_deposit, application.financed_amount, application.proposed_frequency,
          application.proposed_installment_count, application.proposed_installment_amount,
          customer.customer_name, asset.asset_code, asset.asset_name
        FROM equipment_credit_applications application
        LEFT JOIN hire_customers customer ON customer.id = application.customer_id
        LEFT JOIN fleet_assets asset ON asset.id = application.asset_id
        WHERE application.id = ? LIMIT 1`, [entityId]);
      if (rows[0]) Object.assign(context, rows[0]);
    } else if (entityId > 0 && /sale_agreement/.test(entityType)) {
      const [rows] = await pool.query(`SELECT agreement.agreement_number,
          agreement.total_amount, agreement.deposit_required, agreement.amount_paid,
          agreement.outstanding_balance, agreement.next_due_date,
          agreement.customer_name_snapshot AS customer_name,
          agreement.asset_code_snapshot AS asset_code,
          agreement.asset_name_snapshot AS asset_name
        FROM equipment_sale_agreements agreement WHERE agreement.id = ? LIMIT 1`, [entityId]);
      if (rows[0]) Object.assign(context, rows[0]);
    } else if (entityId > 0 && /fleet_asset|equipment/.test(entityType)) {
      const [rows] = await pool.query(`SELECT asset_code, asset_name, selling_price, sale_status FROM fleet_assets WHERE id = ? LIMIT 1`, [entityId]);
      if (rows[0]) Object.assign(context, rows[0]);
    } else if (entityId > 0 && /customer/.test(entityType)) {
      const [rows] = await pool.query(`SELECT customer_name, phone FROM hire_customers WHERE id = ? LIMIT 1`, [entityId]);
      if (rows[0]) Object.assign(context, rows[0]);
    }
  } catch (error) {
    if (!/unknown table|doesn't exist|unknown column/i.test(String(error.message || ""))) {
      console.warn(`Finance boss activity enrichment skipped for ${entityId}:`, error.message);
    }
  }
  const detailText = clean(row?.details, 1000);
  const merged = { ...metadata, ...context };
  merged.application_number ||= firstMatch(detailText, [/(ECAPP-[A-Z0-9-]+)/i]);
  merged.agreement_number ||= firstMatch(detailText, [/(ESA-[A-Z0-9-]+)/i]);
  merged.asset_code ||= firstMatch(detailText, [/(EXC-[A-Z0-9-]+)/i, /\b(EX-\d{3})\b/i]);
  if (!merged.asset_name) merged.asset_name = firstMatch(detailText, [/\bEXC-[A-Z0-9-]+\s*-\s*([^,.]+(?:\s+[^,.]+){0,3})/i]);
  merged.customer_name ||= firstMatch(detailText, [/for\s+([A-Z][A-Z .'-]{2,80})(?:\s+and\s+|\.|$)/i, /customer\s+([A-Z][A-Z .'-]{2,80})/i]);
  return { ...row, metadata_json: JSON.stringify(merged) };
}
function buildActivityMessage(row) {
  const metadata = parseMetadata(row?.metadata_json);
  const kind = eventKind(row, metadata);
  const agreement = clean(findValue(metadata, ["agreement_number", "agreement", "agreementNumber"]), 80);
  const application = clean(findValue(metadata, ["application_number", "application", "applicationNumber"]), 90);
  const assetCode = clean(findValue(metadata, ["asset_code", "equipment_code", "machine_code"]), 60);
  const assetName = clean(findValue(metadata, ["asset_name", "equipment_name", "machine_name"]), 90);
  const asset = [assetCode, assetName].filter(Boolean).join(" — ");
  const customer = clean(findValue(metadata, ["customer_name", "customer"]), 120);
  const receipt = clean(findValue(metadata, ["receipt_number", "receipt"]), 80);
  const staff = clean(findValue(metadata, ["staff_name", "received_by", "created_by_name", "updated_by_name"]), 100);
  const method = clean(findValue(metadata, ["payment_method", "method"]), 50);
  const amount = findValue(metadata, ["amount", "payment_amount", "deposit_amount", "total_amount", "target_selling_price", "quoted_total", "proposed_deposit", "financed_amount"]);
  const balance = findValue(metadata, ["outstanding_balance", "balance", "remaining_balance"]);
  const nextDue = findValue(metadata, ["next_due_date", "due_date", "first_due_date"]);
  const installment = findValue(metadata, ["proposed_installment_amount", "installment_amount", "periodic_amount"]);
  const frequency = clean(findValue(metadata, ["proposed_frequency", "frequency", "payment_frequency"]), 40);
  const count = findValue(metadata, ["proposed_installment_count", "installment_count", "number_of_installments"]);
  const details = clean(row?.details, 220);
  const who = staff ? `Handled by ${staff}.` : "Handled by Chalin 03 Finance.";
  const amountText = amount !== null && amount !== "" ? `Value ${money(amount) || clean(amount, 50)}.` : "";
  const balanceText = balance !== null && balance !== "" ? `Outstanding balance ${money(balance) || clean(balance, 50)}.` : "";
  const plan = [installment !== null && installment !== "" ? `${money(installment) || clean(installment, 50)} per instalment` : "", frequency ? `every ${frequency}` : "", count ? `${count} instalments` : "", nextDue ? `next due ${dateLabel(nextDue)}` : ""].filter(Boolean).join(", ");
  switch (kind) {
    case "application_approved":
      return `CHALIN 03 FINANCE: Credit application ${application || ""} has been approved for ${customer || "the customer"}. ${asset ? `Equipment: ${asset}. ` : ""}${agreement ? `Agreement: ${agreement}. ` : ""}${amountText ? `Approved value ${amountText.replace(/^Value /, "")}` : ""}${plan ? ` Plan: ${plan}.` : ""} ${who}`.replace(/\s+/g, " ").trim();
    case "machine_created":
      return `CHALIN 03 FINANCE: Equipment ${asset || "record"} has been registered for installment finance${customer ? ` for ${customer}` : ""}. ${amount !== null && amount !== "" ? `Selling price ${money(amount) || clean(amount, 50)}. ` : ""}${details ? `${details}. ` : ""}${who}`.replace(/\s+/g, " ").trim();
    case "customer_created":
      return `CHALIN 03 FINANCE: New customer ${customer || "Finance customer"} has been added to the installment portfolio.${application ? ` Application ${application}.` : ""}${asset ? ` Equipment ${asset}.` : ""} ${who}`.replace(/\s+/g, " ").trim();
    case "deposit":
      return `CHALIN 03 FINANCE: Opening deposit received for ${customer || "customer"}.${agreement ? ` Agreement ${agreement}.` : ""}${asset ? ` Equipment ${asset}.` : ""} ${amountText ? ` ${amountText}` : ""}${method ? ` Method ${method}.` : ""}${receipt ? ` Receipt ${receipt}.` : ""} ${who}`.replace(/\s+/g, " ").trim();
    case "agreement":
      return `CHALIN 03 FINANCE: Installment agreement ${agreement || ""} is now ACTIVE for ${customer || "the customer"}.${asset ? ` Equipment: ${asset}.` : ""}${amount !== null && amount !== "" ? ` Contract value ${money(amount) || clean(amount, 50)}.` : ""}${plan ? ` Payment plan: ${plan}.` : ""}${balanceText ? ` ${balanceText}` : ""} ${who}`.replace(/\s+/g, " ").trim();
    case "payment":
      return `CHALIN 03 FINANCE: Payment received from ${customer || "customer"}.${agreement ? ` Agreement ${agreement}.` : ""}${asset ? ` Equipment: ${asset}.` : ""}${amountText ? ` ${amountText}` : ""}${method ? ` Method ${method}.` : ""}${receipt ? ` Receipt ${receipt}.` : ""}${balanceText ? ` ${balanceText}` : ""} ${who}`.replace(/\s+/g, " ").trim();
    default:
      return `CHALIN 03 FINANCE: Finance activity recorded for ${customer || agreement || asset || "the installment portfolio"}. ${details || "No additional business details were recorded."} ${who}`.replace(/\s+/g, " ").trim();
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
    const [rows] = await pool.query(`SELECT sms.id, activity.id AS activity_id, activity.branch_id, activity.user_id,
      activity.action, activity.details, activity.workspace_code, activity.entity_type, activity.entity_id,
      activity.action_type, activity.outcome, activity.severity, activity.metadata_json
      FROM sms_log sms INNER JOIN activity_log activity
        ON activity.id = CAST(SUBSTRING_INDEX(sms.source_reference, ':', -1) AS UNSIGNED)
      WHERE sms.sms_type = 'equipment_finance_boss_alert'
        AND sms.source_reference LIKE 'equipment-finance-boss-activity:%'
      ORDER BY sms.id ASC LIMIT 1000`);
    let repaired = 0;
    for (const row of rows) {
      const enriched = await enrichActivityRow(row);
      if (eventKind(enriched, parseMetadata(enriched.metadata_json)) === "noise") continue;
      await pool.query("UPDATE sms_log SET message = ? WHERE id = ? LIMIT 1", [buildActivityMessage(enriched), row.id]);
      repaired += 1;
    }
    if (repaired) console.log(`Finance boss SMS history message intelligence repaired: ${repaired} record(s).`);
  } catch (error) {
    if (!/unknown table|doesn't exist|unknown column/i.test(String(error.message || ""))) console.warn("Finance boss SMS history repair skipped:", error.message);
  }
}
async function deliverFinanceActivityBossAlert(row) {
  const sourceReference = `equipment-finance-boss-activity:${Number(row.id)}`;
  if (await sourceAlreadyLogged(sourceReference)) return;
  const settings = await professionalBossSettings();
  if (!settings.enabled || !settings.phone) return;
  const enriched = await enrichActivityRow(row);
  const kind = eventKind(enriched, parseMetadata(enriched.metadata_json));
  if (!(await notificationCategoryEnabled(notificationCategoryForEventKind(kind)))) return;
  if (kind === "noise" || kind === "payment") return;
  const message = buildActivityMessage(enriched);
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
      const [rows] = await pool.query(`SELECT id, branch_id, user_id, action, details, workspace_code,
        entity_type, entity_id, action_type, outcome, severity, metadata_json
        FROM activity_log WHERE id > ? AND outcome = 'success'
        AND (workspace_code = 'equipment_installment_finance'
          OR action LIKE '%EQUIPMENT_FINANCE%'
          OR action LIKE '%equipment_finance%'
          OR action LIKE 'EQUIPMENT_CATALOGUE_ASSET_%'
          OR action_type LIKE 'equipment.finance.%'
          OR entity_type IN ('equipment_sale_payment','equipment_sale_agreement','fleet_asset','equipment_customer','equipment_credit_application'))
        ORDER BY id ASC LIMIT ?`, [activityCursor, BATCH_SIZE]);
      for (const row of rows) {
        activityCursor = Math.max(activityCursor, Number(row.id || 0));
        if (!isFinanceActivity(row)) continue;
        try { await deliverFinanceActivityBossAlert(row); } catch (error) { console.error(`Finance boss alert ${row.id} failed:`, error.message); }
      }
    } catch (error) {
      if (!/unknown table|doesn't exist/i.test(String(error.message || ""))) console.warn("Finance boss activity poll failed:", error.message);
    } finally { pollPromise = null; }
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