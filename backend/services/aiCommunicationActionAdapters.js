"use strict";

const {
  normalizeGhanaPhone,
  sendSms,
  validateSmsMessage,
} = require("./smsService");
const {
  sendCustomerDebtReminderSms,
} = require("./debtReminderService");

class AiCommunicationActionError extends Error {
  constructor(message, { code = "AI_ACTION_COMMUNICATION_FAILED", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiCommunicationActionError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clean(value, maximum = 1000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maximum);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validateOutboundSms(input = {}) {
  const to = normalizeGhanaPhone(input.to);
  let message;
  try {
    message = validateSmsMessage(input.message);
  } catch (error) {
    throw new AiCommunicationActionError(error.message || "SMS message is invalid.", {
      code: "AI_ACTION_SMS_INPUT_INVALID",
    });
  }
  if (!to) {
    throw new AiCommunicationActionError("A valid Ghana SMS phone number is required.", {
      code: "AI_ACTION_SMS_RECIPIENT_INVALID",
    });
  }
  return Object.freeze({
    to,
    message,
    recipient_label: clean(input.recipient_label, 180) || null,
  });
}

async function executeOutboundSms({ input }) {
  const result = await sendSms({ to: input.to, message: input.message });
  if (result?.success !== true) {
    throw new AiCommunicationActionError("The SMS provider did not accept the governed message.", {
      code: "AI_ACTION_SMS_SEND_FAILED",
      statusCode: 502,
    });
  }
  return Object.freeze({
    channel: "sms",
    submitted: true,
    delivery_confirmed: result.status === "delivered",
    status: result.status || "accepted",
    recipient: result.to || input.to,
    recipient_label: input.recipient_label,
    provider: result.provider || null,
    provider_message_id: result.providerMessageId || null,
    provider_status: result.providerStatus || null,
    segment_count: Number(result.segmentCount || 0),
    submitted_at: result.submittedAt || new Date(),
  });
}

function validateCustomerDebtReminder(input = {}) {
  const branchId = positiveInteger(input.branch_id);
  const customerId = positiveInteger(input.customer_id);
  if (!branchId || !customerId) {
    throw new AiCommunicationActionError(
      "A valid branch ID and customer ID are required for a debt reminder.",
      { code: "AI_ACTION_DEBT_REMINDER_INPUT_INVALID" }
    );
  }
  return Object.freeze({
    branch_id: branchId,
    customer_id: customerId,
  });
}

async function executeCustomerDebtReminder({ input, user }) {
  const result = await sendCustomerDebtReminderSms({
    branchId: input.branch_id,
    customerId: input.customer_id,
    sentBy: Number(user?.id) || null,
  });

  if (result?.success !== true) {
    throw new AiCommunicationActionError(
      result?.reason === "invalid_phone"
        ? "The customer's saved phone number is not valid for a debt reminder."
        : result?.error || "The debt reminder SMS was not accepted by the provider.",
      {
        code: "AI_ACTION_DEBT_REMINDER_SEND_FAILED",
        statusCode: result?.reason === "invalid_phone" ? 409 : 502,
      }
    );
  }

  return Object.freeze({
    channel: "sms",
    reminder_type: result.reminder_type || null,
    submitted: true,
    delivery_confirmed: result.status === "delivered",
    status: result.status || "accepted",
    customer_id: Number(result.customer_id || input.customer_id),
    customer_name: result.customer_name || null,
    recipient_phone: result.recipient_phone || null,
    sms_log_id: result.sms_log_id || null,
    provider: result.provider || null,
    provider_message_id: result.provider_message_id || null,
  });
}

module.exports = {
  AiCommunicationActionError,
  clean,
  executeCustomerDebtReminder,
  executeOutboundSms,
  positiveInteger,
  validateCustomerDebtReminder,
  validateOutboundSms,
};