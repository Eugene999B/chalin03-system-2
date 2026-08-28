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
  const titleKey = cleanTitle.toLowerCase();

  if (audience === "auditor") {
    if (titleKey.includes("exception") || titleKey.includes("risk")) {
      return [
        "CHALIN 03 — Audit Review",
        `One point I would put on the review list is this: ${insight}`,
        action ? `The useful next step is to ${action.toLowerCase().replace(/^please\s+/i, "")}` : "Trace the transaction back to its original evidence, approval and final outcome before deciding whether the pattern is significant.",
        "Treat unusual activity as a prompt for evidence-led review, not as a conclusion of wrongdoing.",
      ].join("\n\n");
    }
    return [
      "CHALIN 03 — Audit Review",
      `Here is the point I would want evidenced: ${insight}`,
      action ? `For the review, ${action.replace(/^please\s+/i, "").replace(/^confirm\s+/i, "confirm ")}` : "Compare the management figure with the source records, approvals and reconciliation trail before relying on the summary.",
      "The aim is to establish what happened, who approved it, what evidence supports it and whether the control worked as intended.",
    ].join("\n\n");
  }

  if (audience === "manager") {
    if (titleKey.includes("cash") || titleKey.includes("collection")) {
      return [
        "CHALIN 03 — Management",
        `The immediate business issue here is cash conversion: ${insight}`,
        action ? `I would act on this by ${action.replace(/^please\s+/i, "").replace(/\.$/, "")}.` : "Start with the oldest and largest balances, assign clear owners and check the result rather than only recording follow-up attempts.",
        "A sale is only helping the business fully when the cash is actually collected and controlled.",
      ].join("\n\n");
    }
    if (titleKey.includes("stock") || titleKey.includes("sales protection")) {
      return [
        "CHALIN 03 — Management",
        `This needs attention because stock availability can quietly turn into lost sales: ${insight}`,
        action ? `I would make this practical by ${action.replace(/^please\s+/i, "").replace(/\.$/, "")}.` : "Prioritise the fastest-moving parts and make sure the website stock position agrees with the physical store.",
      ].filter(Boolean).join("\n\n");
    }
    return [
      "CHALIN 03 — Management",
      `${cleanTitle}: ${insight}`,
      action ? `The practical move is to ${action.replace(/^please\s+/i, "")}` : "Give this a named owner, a date and a clear definition of what completion looks like.",
      "The goal is not another report; it is a visible action that improves the business.",
    ].join("\n\n");
  }

  if (titleKey.includes("cash") || titleKey.includes("collections")) {
    return [
      "CHALIN 03 — Executive",
      `The number itself is only half the story. ${insight}`,
      "What concerns me is the business effect: money that has been earned or is expected but is not yet safely back in the business reduces room to restock, invest and absorb surprises.",
      action ? `My recommendation is to ${action.replace(/^please\s+/i, "")}` : "Keep the oldest and highest-value balances on the management agenda until responsibility and recovery are clear.",
    ].join("\n\n");
  }

  if (titleKey.includes("risk") || titleKey.includes("suspicion")) {
    return [
      "CHALIN 03 — Executive",
      `This is the area I would not ignore: ${insight}`,
      "A warning signal is not proof of misconduct, but repeated exceptions can reveal weak controls, poor discipline or money being put at risk. The right response is to understand the pattern before it becomes expensive.",
      action ? `I would ask management to ${action.replace(/^please\s+/i, "")}` : "Ask for the underlying records, approval trail and explanation for any pattern that looks unusual.",
    ].join("\n\n");
  }

  if (titleKey.includes("decision") || titleKey.includes("desk")) {
    return [
      "CHALIN 03 — Executive",
      `Here is the management point behind the figures: ${insight}`,
      action ? `The decision I would put on the table is simple: ${action}` : "Decide who owns the issue, what must change and when management will review the result.",
      "Small unresolved decisions become expensive operational problems when they are allowed to sit too long.",
    ].join("\n\n");
  }

  if (titleKey.includes("website") || titleKey.includes("system")) {
    return [
      "CHALIN 03 — Executive",
      `The website and operating system should be helping management control the business, not merely display it. ${insight}`,
      action ? `The improvement I would prioritise is to ${action.replace(/^please\s+/i, "")}` : "Make risk, overdue cash, approvals, stock exceptions and important follow-up impossible to miss.",
      "A good system should reduce the chance of a problem being missed in the first place.",
    ].join("\n\n");
  }

  return [
    "CHALIN 03 — Executive",
    `${cleanTitle}: ${insight}`,
    action ? `My recommendation is to ${action.replace(/^please\s+/i, "")}` : "This deserves a clear owner and a management follow-up rather than being left as a number in a report.",
    "The purpose of this review is to turn information into a decision that improves the business.",
  ].join("\n\n");
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
module.exports = { installExecutivePackNotificationDelivery, buildHumanSms };
