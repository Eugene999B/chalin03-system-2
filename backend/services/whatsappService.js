const DEFAULT_GRAPH_VERSION = "v20.0";

function envIsTrue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function getWhatsAppConfig() {
  return {
    enabled: envIsTrue(process.env.WHATSAPP_RECEIPT_ENABLED),
    phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim(),
    accessToken: String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim(),
    templateName: String(
      process.env.WHATSAPP_TEMPLATE_NAME || "receipt_notification"
    ).trim(),
    templateLanguage: String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en").trim(),
    graphVersion: String(
      process.env.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION
    ).trim(),
  };
}

function normalizeWhatsAppPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");

  if (!digits) return "";

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("0") && digits.length === 10) {
    digits = `233${digits.slice(1)}`;
  }

  if (digits.length === 9) {
    digits = `233${digits}`;
  }

  if (digits.startsWith("2330") && digits.length === 13) {
    digits = `233${digits.slice(4)}`;
  }

  if (!digits.startsWith("233") || digits.length !== 12) {
    return "";
  }

  return digits;
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

async function readResponseBody(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function sendSaleReceiptWhatsApp({
  phone,
  customerName,
  receiptNumber,
  total,
}) {
  const config = getWhatsAppConfig();

  if (!config.enabled) {
    return {
      status: "skipped",
      skipped: true,
      message: "WhatsApp receipt is disabled.",
    };
  }

  const normalizedPhone = normalizeWhatsAppPhone(phone);

  if (!normalizedPhone) {
    return {
      status: "skipped",
      skipped: true,
      message: "No valid customer WhatsApp phone number.",
    };
  }

  if (!config.phoneNumberId || !config.accessToken) {
    return {
      status: "failed",
      skipped: false,
      message:
        "WhatsApp Cloud API is not configured. Add WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN.",
    };
  }

  const url = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: normalizedPhone,
    type: "template",
    template: {
      name: config.templateName,
      language: {
        code: config.templateLanguage,
      },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: customerName || "Customer",
            },
            {
              type: "text",
              text: receiptNumber || "-",
            },
            {
              type: "text",
              text: formatMoney(total),
            },
          ],
        },
      ],
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const providerResponse = await readResponseBody(response);

    if (!response.ok) {
      return {
        status: "failed",
        skipped: false,
        message: `WhatsApp receipt failed. HTTP ${response.status}.`,
        status_code: response.status,
        provider_response: providerResponse,
      };
    }

    return {
      status: "sent",
      skipped: false,
      message: "WhatsApp receipt sent successfully.",
      phone: normalizedPhone,
      provider_response: providerResponse,
    };
  } catch (error) {
    return {
      status: "failed",
      skipped: false,
      message: error.message || "WhatsApp receipt failed.",
    };
  }
}

module.exports = {
  getWhatsAppConfig,
  normalizeWhatsAppPhone,
  sendSaleReceiptWhatsApp,
};