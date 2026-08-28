const http = require("node:http");
const { pool } = require("../config/db");
const { sendSmsAlertToPhone } = require("./smsAlertService");

const INSTALL_FLAG = Symbol.for("chalin03.executivePackNotificationDeliveryInstalled");

function isExecutivePackRequest(request) {
  if (String(request?.method || "").toUpperCase() !== "POST") return false;
  const path = String(request?.originalUrl || request?.url || "").split("?", 1)[0];
  if (path !== "/notifications/manual" && path !== "/api/notifications/manual") return false;
  const body = request?.body || {};
  const category = String(body.category || "").trim().toLowerCase();
  const source = String(body.source_reference || "").trim();
  return category === "executive" && source.startsWith("executive-message-pack:");
}

async function deliverExecutivePackSms(request) {
  try {
    if (!isExecutivePackRequest(request)) return;

    const recipientId = Number(request.body?.target_user_id);
    const sourceReference = String(request.body?.source_reference || "").trim();
    if (!Number.isInteger(recipientId) || recipientId <= 0) {
      console.warn("Executive intelligence SMS skipped: invalid recipient user id.", { sourceReference });
      return;
    }

    const smsSourceReference = `${sourceReference}:sms`;
    const [existing] = await pool.query(
      `SELECT id FROM sms_log WHERE source_reference = ? ORDER BY id DESC LIMIT 1`,
      [smsSourceReference]
    );
    if (existing.length) return;

    const [rows] = await pool.query(
      `SELECT phone FROM users WHERE id = ? AND is_active = TRUE LIMIT 1`,
      [recipientId]
    );
    const phone = rows[0]?.phone;
    if (!phone) {
      console.warn("Executive intelligence SMS skipped: recipient has no registered phone.", { recipientId });
      return;
    }

    const title = String(request.body?.title || "Chalin 03 Executive Intelligence").trim();
    const rawMessage = String(request.body?.message || "").trim();
    if (!rawMessage) return;

    const message = `CHALIN 03 — ${title}\n${rawMessage}`;
    const result = await sendSmsAlertToPhone({
      branchId: Number(request.user?.branch_id || 1),
      phone,
      message,
      smsType: "executive_intelligence_pack",
      sentBy: request.user?.id || null,
      sourceReference: smsSourceReference,
    });

    console.info("Executive intelligence SMS delivery attempt recorded.", {
      recipientId,
      smsStatus: result?.status || "unknown",
      logId: result?.log_id || null,
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
    if (request && isExecutivePackRequest(request)) {
      void deliverExecutivePackSms(request);
    }
    return result;
  };

  Object.defineProperty(globalThis, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return true;
}

installExecutivePackNotificationDelivery();

module.exports = { installExecutivePackNotificationDelivery };
