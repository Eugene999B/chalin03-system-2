const { getProfessionalSettings } = require("./equipmentFinanceProfessionalService");
const { sendSmsAlertToPhone } = require("./smsAlertService");
const { pool } = require("../config/db");

const INSTALL_FLAG = Symbol.for("chalin03.equipmentFinanceBossAlertDeliveryInstalled");
const POLL_MS = Math.max(1000, Number(process.env.EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS) || 2000);
const BATCH_SIZE = 100;

const FINANCE_WORKSPACES = new Set([
  "equipment_installment_finance",
  "equipment_hire",
]);

function clean(value, max = 240) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return `GHS ${number.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
  const action = clean(row?.action, 200).toLowerCase();
  const actionType = clean(row?.action_type, 200).toLowerCase();
  const entityType = clean(row?.entity_type, 120).toLowerCase();
  const workspace = clean(row?.workspace_code, 100).toLowerCase();
  const details = clean(row?.details, 1000);

  if (FINANCE_WORKSPACES.has(workspace) && /(finance|installment|customer|payment|deposit|agreement|machine|equipment)/i.test(`${action} ${actionType} ${entityType} ${details}`)) {
    return true;
  }
  if (/equipment_finance|equipment\\.finance|installment/.test(`${action} ${actionType} ${entityType}`)) return true;
  if (entityType.includes("equipment") || entityType === "fleet_asset" || entityType === "equipment_sale_payment" || entityType === "equipment_sale_agreement") {
    return /create|created|register|registered|update|updated|edit|edited|payment|deposit|agreement|reserve|reservation/i.test(`${action} ${actionType}`);
  }
  if (/customer/.test(`${action} ${actionType} ${entityType}`) && FINANCE_WORKSPACES.has(workspace)) return true;
  return false;
}

function eventKind(row, metadata) {
  const text = `${clean(row?.action, 220)} ${clean(row?.action_type, 220)} ${clean(row?.entity_type, 140)} ${clean(row?.details, 1000)}`.toLowerCase();
  if (/machine.*(register|creat)|equipment.*(register|creat)|_machine_registered|machine\.register/.test(text)) return "machine_created";
  if (/customer.*(creat|register)|customer\.creat/.test(text)) return "customer_created";
  if (/opening.*deposit|deposit.*reservation|deposit/.test(text)) return "deposit";
  if (/payment/.test(text) || row?.entity_type === "equipment_sale_payment") return "payment";
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
  const fieldText = Array.isArray(changedFields) ? changedFields.map((value) => clean(value, 60)).filter(Boolean).slice(0, 6).join(", ") : clean(changedFields, 220);

  const subject = agreement || asset || entityId || "Installment Finance";
  const actor = staff ? ` By: ${staff}.` : "";
  const amountText = amount === null ? "" : money(amount) ? ` Amount: ${money(amount)}.` : ` Amount: ${clean(amount, 60)}.`;

  switch (kind) {
    case "machine_created":
      return [
        "CHALIN 03 — Installment Finance Alert",
        `New excavator/equipment registered: ${subject}.${customer ? ` Customer: ${customer}.` : ""}${amountText}`,
        details ? `${details}` : null,
        `${actor.trim()}`.trim() || null,
      ].filter(Boolean).join(" ");
    case "customer_created":
      return [
        "CHALIN 03 — Installment Finance Alert",
        `New finance customer created: ${customer || subject}.`,
        agreement ? `Agreement: ${agreement}.` : null,
        asset ? `Equipment: ${asset}.` : null,
        `${actor.trim()}`.trim() || null,
      ].filter(Boolean).join(" ");
    case "deposit":
      return [
        "CHALIN 03 — Installment Finance Alert",
        `Deposit recorded for ${subject}.${customer ? ` Customer: ${customer}.` : ""}`,
        amountText,
        method ? `Method: ${method}.` : null,
        receipt ? `Receipt: ${receipt}.` : null,
        `${actor.trim()}`.trim() || null,
      ].filter(Boolean).join(" ");
    case "payment":
      return [
        "CHALIN 03 — Installment Finance Alert",
        `Payment recorded for ${subject}.${customer ? ` Customer: ${customer}.` : ""}`,
        amountText,
        method ? `Method: ${method}.` : null,
        receipt ? `Receipt: ${receipt}.` : null,
        `${actor.trim()}`.trim() || null,
      ].filter(Boolean).join(" ");
    case "agreement":
      return [
        "CHALIN 03 — Installment Finance Alert",
        `Installment agreement activated: ${subject}.${customer ? ` Customer: ${customer}.` : ""}`,
        asset ? `Equipment: ${asset}.` : null,
        amountText,
        `${actor.trim()}`.trim() || null,
      ].filter(Boolean).join(" ");
    case "edited":
      return [
        "CHALIN 03 — Installment Finance Alert",
        `Finance record edited: ${subject}.`,
        fieldText ? `Changed: ${fieldText}.` : null,
        hasAmountSignal(metadata, details) ? "Amount/financial field was involved." : null,
        details && !fieldText ? details : null,
        `${actor.trim()}`.trim() || null,
      ].filter(Boolean).join(" ");
    default:
      return [
        "CHALIN 03 — Installment Finance Alert",
        details || `Finance activity recorded for ${subject}.`,
        `${actor.trim()}`.trim() || null,
      ].filter(Boolean).join(" ");
  }
}

async function professionalBossSettings() {
  const settings = await getProfessionalSettings();
  return {
    enabled: Boolean(Number(settings?.boss_payment_alert_enabled)),
    phone: clean(settings?.boss_payment_alert_phone, 40),
  };
}

async function sourceAlreadyLogged(sourceReference) {
  try {
    const [rows] = await pool.query(
      "SELECT id FROM sms_log WHERE source_reference = ? LIMIT 1",
      [sourceReference]
    );
    return rows.length > 0;
  } catch (error) {
    console.warn("Boss SMS duplicate check skipped:", error.message);
    return false;
  }
}

async function deliverFinanceActivityBossAlert(row) {
  const sourceReference = `equipment-finance-boss-activity:${Number(row.id)}`;
  if (await sourceAlreadyLogged(sourceReference)) return;

  const settings = await professionalBossSettings();
  if (!settings.enabled || !settings.phone) {
    return;
  }

  const message = buildActivityMessage(row);
  const result = await sendSmsAlertToPhone({
    branchId: Number(row.branch_id || 1),
    phone: settings.phone,
    message,
    logMessage: `Boss alert: ${clean(row.action || row.entity_type || "Finance activity", 360)}.`,
    smsType: "other",
    sentBy: row.user_id || null,
    sourceReference,
  });

  if (!result?.ok && !result?.delivery_confirmed) {
    console.warn(`Finance boss alert ${row.id} did not confirm acceptance: ${result?.status || "unknown"}.`);
  }
}

let activityCursor = 0;
let pollPromise = null;

async function initialiseActivityCursor() {
  try {
    const [[row]] = await pool.query("SELECT COALESCE(MAX(id), 0) AS max_id FROM activity_log");
    activityCursor = Number(row?.max_id || 0);
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
             workspace_code IN ('equipment_installment_finance', 'equipment_hire')
             OR action LIKE '%EQUIPMENT_FINANCE%'
             OR action LIKE '%equipment_finance%'
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
      if (!/unknown table|doesn't exist/i.test(String(error.message || ""))) {
        console.warn("Finance boss activity poll failed:", error.message);
      }
    } finally {
      pollPromise = null;
    }
  })();
  return pollPromise;
}

function isSuccessfulEquipmentCreate(request) {
  if (String(request?.method || "").toUpperCase() !== "POST") return false;
  const path = String(request?.originalUrl || request?.url || "").split("?", 1)[0];
  return path === "/equipment-catalogue/assets" || path === "/api/equipment-catalogue/assets";
}

async function deliverEquipmentCreatedBossAlert(request) {
  const settings = await professionalBossSettings();
  if (!settings.enabled || !settings.phone) return;
  const body = request?.body || {};
  const assetCode = clean(body.asset_code, 50).toUpperCase();
  const assetName = clean(body.asset_name, 150);
  const assetType = clean(body.asset_type, 60);
  const make = clean(body.make, 80);
  const model = clean(body.model, 80);
  const serial = clean(body.serial_number, 80);
  const chassis = clean(body.chassis_number, 80);
  const sellingPrice = Number(body.target_selling_price || 0);
  const registeredBy = clean(request?.user?.full_name || request?.user?.username || "Finance staff", 100);
  const identity = [assetCode, assetName].filter(Boolean).join(" — ") || assetType || "New equipment";
  const machineIdentity = [make, model].filter(Boolean).join(" ");
  const message = [
    "CHALIN 03 — Installment Finance Alert",
    `New excavator/equipment registered: ${identity}.`,
    machineIdentity ? `Machine: ${machineIdentity}.` : null,
    serial || chassis ? `Identity: ${serial ? `Serial ${serial}` : ""}${serial && chassis ? ", " : ""}${chassis ? `Chassis ${chassis}` : ""}.` : null,
    sellingPrice > 0 ? `Selling price: ${money(sellingPrice)}.` : null,
    `Registered by: ${registeredBy}.`,
  ].filter(Boolean).join(" ");
  await sendSmsAlertToPhone({
    branchId: Number(request?.user?.branch_id || 1),
    phone: settings.phone,
    message,
    logMessage: `Boss alert: new equipment ${assetCode || assetName || "created"}.`,
    smsType: "other",
    sentBy: request?.user?.id || null,
    sourceReference: `equipment-created:${assetCode || assetName || Date.now()}`,
  });
}

function installEquipmentFinanceBossAlertDelivery() {
  if (globalThis[INSTALL_FLAG]) return false;
  // The committed activity_log poller is the authoritative delivery path.
  // It observes only post-transaction audit rows, so rolled-back writes cannot alert the boss.
  void initialiseActivityCursor().then(() => void pollFinanceActivity());
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
