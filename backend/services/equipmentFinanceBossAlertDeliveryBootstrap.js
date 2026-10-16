const { getProfessionalSettings } = require("./equipmentFinanceProfessionalService");
const { sendSmsAlertToPhone } = require("./smsAlertService");
const { pool } = require("../config/db");

const INSTALL_FLAG = Symbol.for("chalin03.equipmentFinanceBossAlertDeliveryInstalled");
const POLL_MS = Math.max(1000, Number(process.env.EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS) || 2000);
const BATCH_SIZE = 100;
const FINANCE_WORKSPACES = new Set(["equipment_installment_finance"]);
const FINANCE_CATALOGUE_ACTIONS = new Set(["equipment_catalogue_asset_created"]);
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
  if (!Number.isFinite(number)) return "";
  return `GHS ${number.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function hasAmountSignal(metadata = {}, details = "") {
  const keys = Object.keys(metadata).map((key) => key.toLowerCase());
  const text = `${keys.join(" ")} ${String(details || "").toLowerCase()}`;
  return /(amount|price|deposit|financed|balance|installment|payment|total|selling|hire_rate|periodic)/i.test(text);
}

function isFinanceActivity(row) {
  const action = clean(row?.action, 200);
  const actionLower = action.toLowerCase();
  const actionType = clean(row?.action_type, 200).toLowerCase();
  const entityType = clean(row?.entity_type, 120).toLowerCase();
  const workspace = clean(row?.workspace_code, 100).toLowerCase();
  const details = clean(row?.details, 1000);
  const metadata = parseMetadata(row?.metadata_json);

  if (NOISY_FINANCE_ACTIONS.has(action)) return false;
  if (IMPORTANT_FINANCE_ACTIONS.has(action)) return true;
  if (FINANCE_CATALOGUE_ACTIONS.has(actionLower)) return true;
  if (workspace === "equipment_installment_finance") {
    const kind = eventKind(row, metadata);
    if (["machine_created", "customer_created", "deposit", "payment", "agreement", "application_approved"].includes(kind)) return true;
    if (kind === "edited") return hasAmountSignal(metadata, details);
  }
  if (/equipment_finance|equipment\.finance|installment/.test(`${actionLower} ${actionType} ${entityType}`)) return false;
  return false;
}

function eventKind(row, metadata) {
  const text = `${clean(row?.action, 220)} ${clean(row?.action_type, 220)} ${clean(row?.entity_type, 140)} ${clean(row?.details, 1000)}`.toLowerCase();
  if (/admin.*approv|credit.*application.*approv/.test(text)) return "application_approved";
  if (/machine.*(register|creat)|equipment.*(register|creat)|equipment_catalogue_asset_created|_machine_registered|machine\.register/.test(text)) return "machine_created";
  if (/customer.*(creat|register)|customer\.creat/.test(text)) return "customer_created";
  if (/opening.*deposit|deposit.*reservation|deposit/.test(text)) return "deposit";
  if (/payment|collection/.test(text) || String(row?.entity_type || "").toLowerCase() === "equipment_sale_payment") return "payment";
  if (/agreement.*(activat|creat)|agreement\.activat/.test(text)) return "agreement";
  if (/update|updated|edit|edited|change|changed|setting/.test(text) || hasAmountSignal(metadata, row?.details)) return "edited";
  return "finance_activity";
}

function findValue(metadata, keys) {
  for (const key of keys) {
    if (metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== "") return metadata[key];
  }
  return null;
}

function buildActivityMessage(row) {
  const metadata = parseMetadata(row?.metadata_json);
  const kind = eventKind(row, metadata);
  const details = clean(row?.details, 420);
  const entityId = clean(row?.entity_id, 80);
  const amount = findValue(metadata, ["amount", "payment_amount", "deposit_amount", "total_amount", "target_selling_price", "proposed_deposit", "financed_amount", "proposed_installment_amount"]);
  const agreement = clean(findValue(metadata, ["agreement_number", "agreement", "agreementNumber"]), 80);
  const asset = clean(findValue(metadata, ["asset_code", "equipment_code", "machine_code", "asset_name", "equipment_name"]), 110);
  const receipt = clean(findValue(metadata, ["receipt_number", "receipt"]), 80);
  const customer = clean(findValue(metadata, ["customer_name", "customer"]), 120);
  const staff = clean(findValue(metadata, ["staff_name", "received_by", "created_by_name", "updated_by_name"]), 100);
  const method = clean(findValue(metadata, ["payment_method", "method"]), 50);
  const changedFields = findValue(metadata, ["changed_fields", "changedFields", "fields_changed"]);
  const fieldText = Array.isArray(changedFields)
    ? changedFields.map((value) => clean(value, 60)).filter(Boolean).slice(0, 6).join(", ")
    : clean(changedFields, 220);
  const subject = agreement || asset || entityId || "Installment Finance";
  const actor = staff ? `By: ${staff}.` : "";
  const amountText = amount === null ? "" : money(amount) ? `Amount: ${money(amount)}.` : `Amount: ${clean(amount, 60)}.`;

  switch (kind) {
    case "application_approved":
      return ["CHALIN 03 — Installment Finance Alert", `Credit application approved: ${agreement || subject}.`, customer ? `Customer: ${customer}.` : null, asset ? `Equipment: ${asset}.` : null, actor || null].filter(Boolean).join(" ");
    case "machine_created":
      return ["CHALIN 03 — Installment Finance Alert", `New excavator/equipment registered: ${subject}.${customer ? ` Customer: ${customer}.` : ""}${amountText}`, details || null, actor || null].filter(Boolean).join(" ");
    case "customer_created":
      return ["CHALIN 03 — Installment Finance Alert", `New finance customer created: ${customer || subject}.`, agreement ? `Agreement: ${agreement}.` : null, asset ? `Equipment: ${asset}.` : null, actor || null].filter(Boolean).join(" ");
    case "deposit":
      return ["CHALIN 03 — Installment Finance Alert", `Deposit recorded for ${subject}.${customer ? ` Customer: ${customer}.` : ""}`, amountText || null, method ? `Method: ${method}.` : null, receipt ? `Receipt: ${receipt}.` : null, actor || null].filter(Boolean).join(" ");
    case "payment":
      return ["CHALIN 03 — Installment Finance Alert", `Payment recorded for ${subject}.${customer ? ` Customer: ${customer}.` : ""}`, amountText || null, method ? `Method: ${method}.` : null, receipt ? `Receipt: ${receipt}.` : null, actor || null].filter(Boolean).join(" ");
    case "agreement":
      return ["CHALIN 03 — Installment Finance Alert", `Installment agreement activated: ${subject}.${customer ? ` Customer: ${customer}.` : ""}`, asset ? `Equipment: ${asset}.` : null, amountText || null, actor || null].filter(Boolean).join(" ");
    case "edited":
      return ["CHALIN 03 — Installment Finance Alert", `Finance record updated: ${subject}.`, fieldText ? `Changed: ${fieldText}.` : null, hasAmountSignal(metadata, details) ? "Amount/financial field was involved." : null, details && !fieldText ? details : null, actor || null].filter(Boolean).join(" ");
    default:
      return ["CHALIN 03 — Installment Finance Alert", details || `Finance activity recorded for ${subject}.`, actor || null].filter(Boolean).join(" ");
  }
}

async function professionalBossSettings() {
  const settings = await getProfessionalSettings();
  return { enabled: Boolean(Number(settings?.boss_payment_alert_enabled)), phone: clean(settings?.boss_payment_alert_phone, 40) };
}

async function sourceAlreadyLogged(sourceReference) {
  try {
    const [rows] = await pool.query("SELECT id FROM sms_log WHERE source_reference = ? LIMIT 1", [sourceReference]);
    return rows.length > 0;
  } catch (error) {
    console.warn("Boss SMS duplicate check skipped:", error.message);
    return false;
  }
}

async function repairLegacyBossAlertMessages() {
  try {
    const [rows] = await pool.query(
      `SELECT sms.id, activity.id AS activity_id, activity.branch_id, activity.user_id,
              activity.action, activity.details, activity.workspace_code,
              activity.entity_type, activity.entity_id, activity.action_type,
              activity.outcome, activity.severity, activity.metadata_json
         FROM sms_log sms
         INNER JOIN activity_log activity
           ON activity.id = CAST(SUBSTRING_INDEX(sms.source_reference, ':', -1) AS UNSIGNED)
        WHERE sms.sms_type = 'equipment_finance_boss_alert'
          AND sms.source_reference LIKE 'equipment-finance-boss-activity:%'
          AND sms.message LIKE 'Boss alert:%'
        ORDER BY sms.id ASC
        LIMIT 5000`
    );
    for (const row of rows) {
      const message = buildActivityMessage(row);
      await pool.query("UPDATE sms_log SET message = ? WHERE id = ? LIMIT 1", [message, row.id]);
    }
    if (rows.length) console.log(`Finance boss SMS history repaired: ${rows.length} record(s).`);
  } catch (error) {
    if (!/unknown table|doesn't exist|unknown column/i.test(String(error.message || ""))) {
      console.warn("Finance boss SMS history repair skipped:", error.message);
    }
  }
}

async function deliverFinanceActivityBossAlert(row) {
  const sourceReference = `equipment-finance-boss-activity:${Number(row.id)}`;
  if (await sourceAlreadyLogged(sourceReference)) return;
  const settings = await professionalBossSettings();
  if (!settings.enabled || !settings.phone) {
    console.warn(`Finance boss alert skipped for activity ${row.id}: enabled=${settings.enabled} phone_configured=${Boolean(settings.phone)}.`);
    return;
  }
  const message = buildActivityMessage(row);
  const result = await sendSmsAlertToPhone({
    branchId: Number(row.branch_id || 1),
    phone: settings.phone,
    message,
    logMessage: message,
    smsType: "equipment_finance_boss_alert",
    sentBy: row.user_id || null,
    sourceReference,
  });
  if (!result?.ok && !result?.delivery_confirmed) console.warn(`Finance boss alert ${row.id} did not confirm acceptance: ${result?.status || "unknown"}.`);
}

let activityCursor = 0;
let pollPromise = null;

async function initialiseActivityCursor() {
  try {
    const [[row]] = await pool.query("SELECT COALESCE(MAX(id), 0) AS max_id FROM activity_log");
    const maxId = Number(row?.max_id || 0);
    activityCursor = Math.max(0, maxId - 50);
    console.log(`Finance boss alert watcher initialized at activity ${activityCursor}; recovering the latest 50 audit events.`);
  } catch (error) {
    console.warn("Finance boss alert cursor initialization skipped:", error.message);
    activityCursor = 0;
  }
}

async function pollFinanceActivity() {
  if (pollPromise) return pollPromise;
  pollPromise = (async () => {
    try {
      const [rows] = await pool.query(
        `SELECT id, branch_id, user_id, action, details, workspace_code,
                entity_type, entity_id, action_type, outcome, severity, metadata_json
         FROM activity_log
         WHERE id > ?
           AND outcome = 'success'
           AND (
             workspace_code = 'equipment_installment_finance'
             OR action LIKE '%EQUIPMENT_FINANCE%'
             OR action LIKE '%equipment_finance%'
             OR action LIKE 'EQUIPMENT_CATALOGUE_ASSET_%'
             OR action_type LIKE 'equipment.finance.%'
             OR entity_type IN ('equipment_sale_payment','equipment_sale_agreement','fleet_asset','equipment_customer')
           )
         ORDER BY id ASC
         LIMIT ?`,
        [activityCursor, BATCH_SIZE]
      );
      for (const row of rows) {
        activityCursor = Math.max(activityCursor, Number(row.id || 0));
        if (!isFinanceActivity(row)) continue;
        try {
          await deliverFinanceActivityBossAlert(row);
        } catch (error) {
          console.error(`Finance boss alert ${row.id} failed:`, error.message);
        }
      }
    } catch (error) {
      if (!/unknown table|doesn't exist/i.test(String(error.message || ""))) console.warn("Finance boss activity poll failed:", error.message);
    } finally {
      pollPromise = null;
    }
  })();
  return pollPromise;
}

// Retained for compatibility with the earlier equipment-create hook.
async function deliverEquipmentCreatedBossAlert(request) {
  const settings = await professionalBossSettings();
  if (!settings.enabled || !settings.phone) return;
  const body = request?.body || {};
  const assetCode = clean(body.asset_code, 50).toUpperCase();
  const assetName = clean(body.asset_name, 150);
  const identity = [assetCode, assetName].filter(Boolean).join(" — ") || "New equipment";
  const message = `CHALIN 03 — Installment Finance Alert New excavator/equipment registered: ${identity}.`;
  await sendSmsAlertToPhone({
    branchId: Number(request?.user?.branch_id || 1),
    phone: settings.phone,
    message,
    logMessage: message,
    smsType: "equipment_finance_boss_alert",
    sentBy: request?.user?.id || null,
    sourceReference: `equipment-created:${assetCode || assetName || Date.now()}`,
  });
}

function installEquipmentFinanceBossAlertDelivery() {
  if (globalThis[INSTALL_FLAG]) return false;
  void repairLegacyBossAlertMessages().finally(() => {
    void initialiseActivityCursor().then(() => void pollFinanceActivity());
  });
  const timer = setInterval(() => void pollFinanceActivity(), POLL_MS);
  timer.unref?.();
  Object.defineProperty(globalThis, INSTALL_FLAG, { value: true, configurable: false, enumerable: false, writable: false });
  return true;
}

installEquipmentFinanceBossAlertDelivery();

module.exports = {
  buildActivityMessage,
  deliverEquipmentCreatedBossAlert,
  deliverFinanceActivityBossAlert,
  eventKind,
  installEquipmentFinanceBossAlertDelivery,
  isFinanceActivity,
  parseMetadata,
};
