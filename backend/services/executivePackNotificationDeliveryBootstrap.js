const http = require("node:http");
const { pool } = require("../config/db");
const { sendSmsAlertToPhone } = require("./smsAlertService");

const INSTALL_FLAG = Symbol.for("chalin03.executivePackNotificationDeliveryInstalled");

function isExecutivePackRequest(request) {
  if (String(request?.method || "").toUpperCase() !== "POST") return false;
  const path = String(request?.originalUrl || request?.url || "").split("?", 1)[0];
  if (path !== "/notifications/manual" && path !== "/api/notifications/manual") return false;
  const body = request?.body || {};
  return String(body.category || "").trim().toLowerCase() === "executive"
    && String(body.source_reference || "").trim().startsWith("executive-message-pack:");
}

function cleanLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitNotificationMessage(value) {
  const text = String(value || "").trim();
  if (!text) return { message: "", action: "" };
  const marker = /\n\s*Recommended action:\s*/i;
  const match = text.match(marker);
  if (!match || typeof match.index !== "number") return { message: cleanLine(text), action: "" };
  const message = text.slice(0, match.index).trim();
  const remainder = text.slice(match.index + match[0].length);
  const scopeMarker = /\n\s*Scope:\s*/i;
  const scopeMatch = remainder.match(scopeMarker);
  const action = (scopeMatch && typeof scopeMatch.index === "number"
    ? remainder.slice(0, scopeMatch.index)
    : remainder).trim();
  return { message: cleanLine(message), action: cleanLine(action) };
}

function normalizeAudience(sourceReference) {
  const parts = String(sourceReference || "").split(":");
  const value = parts.find((part) => ["executive", "auditor", "manager"].includes(String(part).toLowerCase()));
  return String(value || "executive").toLowerCase();
}

function buildHumanSms({ title, rawMessage, rawAction, audience }) {
  const cleanTitle = cleanLine(title) || "Business update";
  const insight = cleanLine(rawMessage);
  const action = cleanLine(rawAction);

  if (audience === "auditor") {
    return [
      "CHALIN 03 — Audit Review",
      `${cleanTitle}: ${insight}`,
      action ? `Please check this: ${action}` : "Please trace the supporting records and approval trail before drawing a conclusion.",
    ].filter(Boolean).join("\n\n");
  }

  if (audience === "manager") {
    return [
      "CHALIN 03 — Management",
      `${cleanTitle}: ${insight}`,
      action ? `Next step: ${action}` : "Make sure this has a named owner and a clear follow-up date.",
    ].filter(Boolean).join("\n\n");
  }

  return [
    "CHALIN 03 — Executive",
    `${cleanTitle}: ${insight}`,
    action ? `My recommendation: ${action}` : "Keep this on the management radar and confirm the appropriate follow-up.",
  ].filter(Boolean).join("\n\n");
}

async function deliverExecutivePackSms(request) {
  try {
    if (!isExecutivePackRequest(request)) return;
    const recipientId = Number(request.body?.target_user_id);
    const sourceReference = String(request.body?.source_reference || "").trim();
    if (!Number.isInteger(recipientId) || recipientId <= 0) return;

    const smsSourceReference = `${sourceReference}:recipient:${recipientId}:sms`;
    const [existing] = await pool.query(`SELECT id FROM sms_log WHERE source_reference = ? ORDER BY id DESC LIMIT 1`, [smsSourceReference]);
    if (existing.length) return;

    const [rows] = await pool.query(`SELECT phone FROM users WHERE id = ? AND is_active = TRUE LIMIT 1`, [recipientId]);
    const phone = rows[0]?.phone;
    if (!phone) return;

    const title = cleanLine(request.body?.title) || "Business update";
    const parsed = splitNotificationMessage(request.body?.message);
    if (!parsed.message) return;

    const audience = normalizeAudience(sourceReference);
    const message = buildHumanSms({ title, rawMessage: parsed.message, rawAction: parsed.action, audience });

    await sendSmsAlertToPhone({
      branchId: Number(request.user?.branch_id || 1),
      phone,
      message,
      smsType: "executive_intelligence_pack",
      sentBy: request.user?.id || null,
      sourceReference: smsSourceReference,
    });
  } catch (error) {
    console.error("Executive intelligence SMS delivery hook failed:", error.message);
  }
}

function installExecutivePackNotificationDelivery() {
  if (globalThis[INSTALL_FLAG]) return false;
  const originalEnd = http.ServerResponse.prototype.end;
  http.ServerResponse.prototype.end = function executivePackAwareEnd(...args) {
    const request = this.req;
    const result = originalEnd.apply(this, args);
    if (request && isExecutivePackRequest(request)) void deliverExecutivePackSms(request);
    return result;
  };
  Object.defineProperty(globalThis, INSTALL_FLAG, { value: true, configurable: false, enumerable: false, writable: false });
  return true;
}

installExecutivePackNotificationDelivery();
module.exports = { installExecutivePackNotificationDelivery };
