const http = require("node:http");
const { getProfessionalSettings } = require("./equipmentFinanceProfessionalService");
const { sendSmsAlertToPhone } = require("./smsAlertService");

const INSTALL_FLAG = Symbol.for("chalin03.equipmentFinanceBossAlertDeliveryInstalled");

function clean(value, max = 240) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function isSuccessfulEquipmentCreate(request, response) {
  if (String(request?.method || "").toUpperCase() !== "POST") return false;
  const path = String(request?.originalUrl || request?.url || "").split("?", 1)[0];
  return path === "/equipment-catalogue/assets" || path === "/api/equipment-catalogue/assets";
}

async function deliverEquipmentCreatedBossAlert(request) {
  try {
    const settings = await getProfessionalSettings();
    const enabled = Boolean(Number(settings?.boss_payment_alert_enabled));
    const phone = clean(settings?.boss_payment_alert_phone, 40);
    if (!enabled || !phone) {
      console.warn(`Equipment-created boss SMS not sent: enabled=${enabled} phone_configured=${Boolean(phone)}.`);
      return;
    }

    const body = request?.body || {};
    const assetCode = clean(body.asset_code, 50).toUpperCase();
    const assetName = clean(body.asset_name, 150);
    const assetType = clean(body.asset_type, 60);
    const make = clean(body.make, 80);
    const model = clean(body.model, 80);
    const serial = clean(body.serial_number, 80);
    const chassis = clean(body.chassis_number, 80);
    const purpose = clean(body.operational_purpose, 50).replaceAll("_", " ");
    const sellingPrice = Number(body.target_selling_price || 0);
    const hireRate = Number(body.standard_hire_rate || 0);
    const registeredBy = clean(request?.user?.full_name || request?.user?.username || "Finance staff", 100);

    const identity = [assetCode, assetName].filter(Boolean).join(" — ") || assetType || "New equipment";
    const machineIdentity = [make, model].filter(Boolean).join(" ");
    const message = [
      "CHALIN 03 — Equipment Alert",
      `New excavator/equipment registered: ${identity}.`,
      machineIdentity ? `Machine: ${machineIdentity}.` : null,
      serial || chassis ? `Identity: ${serial ? `Serial ${serial}` : ""}${serial && chassis ? ", " : ""}${chassis ? `Chassis ${chassis}` : ""}.` : null,
      purpose ? `Purpose: ${purpose}.` : null,
      sellingPrice > 0 ? `Selling price: GHS ${sellingPrice.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.` : null,
      hireRate > 0 ? `Hire rate: GHS ${hireRate.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.` : null,
      `Registered by: ${registeredBy}.`,
      "Open Equipment Sales & Hire to review the new machine and its evidence.",
    ].filter(Boolean).join("\n\n");

    await sendSmsAlertToPhone({
      branchId: Number(request?.user?.branch_id || 1),
      phone,
      message,
      logMessage: `Boss alert: new equipment ${assetCode || assetName || "created"}.`,
      smsType: "equipment_finance_boss_alert",
      sentBy: request?.user?.id || null,
      sourceReference: `equipment-created:${assetCode || assetName || Date.now()}`,
    });
  } catch (error) {
    console.error("Equipment-created boss SMS hook failed:", error.message);
  }
}

function installEquipmentFinanceBossAlertDelivery() {
  if (globalThis[INSTALL_FLAG]) return false;
  const originalEnd = http.ServerResponse.prototype.end;
  http.ServerResponse.prototype.end = function equipmentCreatedAwareEnd(...args) {
    const request = this.req;
    const response = this;
    const result = originalEnd.apply(this, args);
    if (request && response.statusCode >= 200 && response.statusCode < 300 && isSuccessfulEquipmentCreate(request, response)) {
      void deliverEquipmentCreatedBossAlert(request);
    }
    return result;
  };
  Object.defineProperty(globalThis, INSTALL_FLAG, { value: true, configurable: false, enumerable: false, writable: false });
  return true;
}

installEquipmentFinanceBossAlertDelivery();
module.exports = { installEquipmentFinanceBossAlertDelivery, deliverEquipmentCreatedBossAlert }; 
