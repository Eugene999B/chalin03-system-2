const express = require("express");
const db = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  getSmsConfig,
  normalizeGhanaPhone,
  sendSms,
} = require("../services/smsService");

const router = express.Router();

const LIVE_BULK_CONFIRMATION_TEXT = "SEND LIVE BULK SMS";

/**
 * This project database config may expose execute(), query(), pool.execute(),
 * pool.query(), connection.execute(), or promise().execute().
 * This helper makes the SMS route work with the existing db.js structure.
 */
async function runQuery(sql, params = []) {
  const candidates = [];

  function addCandidate(client) {
    if (client && !candidates.includes(client)) {
      candidates.push(client);
    }
  }

  addCandidate(db);
  addCandidate(db?.pool);
  addCandidate(db?.connection);
  addCandidate(db?.db);

  try {
    if (typeof db?.promise === "function") {
      addCandidate(db.promise());
    }
  } catch {
    // Ignore unavailable promise wrapper.
  }

  try {
    if (typeof db?.pool?.promise === "function") {
      addCandidate(db.pool.promise());
    }
  } catch {
    // Ignore unavailable promise wrapper.
  }

  try {
    if (typeof db?.connection?.promise === "function") {
      addCandidate(db.connection.promise());
    }
  } catch {
    // Ignore unavailable promise wrapper.
  }

  try {
    if (typeof db?.db?.promise === "function") {
      addCandidate(db.db.promise());
    }
  } catch {
    // Ignore unavailable promise wrapper.
  }

  for (const client of candidates) {
    if (typeof client.execute === "function") {
      return client.execute(sql, params);
    }

    if (typeof client.query === "function") {
      return client.query(sql, params);
    }
  }

  throw new Error(
    "Database connection error: no query/execute method found in config/db.js."
  );
}

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      console.error("SMS route error:", error);

      res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while processing the SMS request.",
      });
    }
  };
}

function getUserId(req) {
  return req.user?.id || req.user?.user_id || null;
}

function getUserRole(req) {
  return String(req.user?.role || "").toLowerCase();
}

function getBranchId(req) {
  const possibleBranchId =
    req.body?.branch_id ||
    req.query?.branch_id ||
    req.headers["x-branch-id"] ||
    req.user?.branch_id ||
    req.user?.default_branch_id ||
    req.user?.selected_branch_id ||
    1;

  const branchId = Number(possibleBranchId);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function requireSmsPermission(req, res, next) {
  const role = getUserRole(req);

  if (!["admin", "manager"].includes(role)) {
    return res.status(403).json({
      status: "error",
      message: "Only admin or manager can send custom SMS messages.",
    });
  }

  next();
}

function safeJson(value) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return String(value || "");
  }
}

function cleanMessage(value) {
  return String(value || "").trim();
}

function cleanCustomerIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function truncateMessage(message, maxLength = 480) {
  const cleanSmsMessage = String(message || "").trim();

  if (cleanSmsMessage.length <= maxLength) {
    return cleanSmsMessage;
  }

  return `${cleanSmsMessage.slice(0, maxLength - 3)}...`;
}

function firstValidGhanaPhone(...values) {
  for (const value of values) {
    const rawValue = String(value || "").trim();

    if (!rawValue) {
      continue;
    }

    const possiblePhones = rawValue
      .split(/[\/,;|]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    for (const possiblePhone of possiblePhones) {
      const normalizedPhone = normalizeGhanaPhone(possiblePhone);

      if (normalizedPhone) {
        return normalizedPhone;
      }
    }

    const normalizedFullValue = normalizeGhanaPhone(rawValue);

    if (normalizedFullValue) {
      return normalizedFullValue;
    }
  }

  return "";
}

function getTodayDateText() {
  return new Date().toISOString().slice(0, 10);
}

function addOneDay(dateText) {
  const [year, month, day] = String(dateText || "")
    .split("-")
    .map((part) => Number(part));

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);

  return date.toISOString().slice(0, 10);
}

function getDateRange(value) {
  const requestedDate = String(value || "").trim();
  const dateText = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : getTodayDateText();

  const nextDateText = addOneDay(dateText);

  return {
    dateText,
    nextDateText,
    startDateTime: `${dateText} 00:00:00`,
    endDateTime: `${nextDateText} 00:00:00`,
  };
}

async function getTableColumns(tableName) {
  const allowedTableNames = new Set([
    "sales",
    "expenses",
    "debts",
    "debt_payments",
    "products",
  ]);

  if (!allowedTableNames.has(tableName)) {
    throw new Error(`Unsupported table name: ${tableName}`);
  }

  const [columns] = await runQuery(`SHOW COLUMNS FROM \`${tableName}\``);

  return columns.map((column) => column.Field);
}

async function writeSmsLog({
  branchId,
  phone,
  message,
  smsType,
  status,
  providerResponse,
  sentBy,
}) {
  const sentAt = status === "sent" ? new Date() : null;

  await runQuery(
    `
      INSERT INTO sms_log (
        branch_id,
        recipient_phone,
        message,
        sms_type,
        status,
        provider_response,
        sent_by,
        sent_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      branchId || null,
      phone,
      message,
      smsType || "other",
      status,
      safeJson(providerResponse).slice(0, 6000),
      sentBy || null,
      sentAt,
    ]
  );
}

async function sendAndLogSms({ branchId, phone, message, smsType, sentBy }) {
  const normalizedPhone = normalizeGhanaPhone(phone);

  if (!normalizedPhone) {
    const failureMessage = "Invalid Ghana phone number.";

    await writeSmsLog({
      branchId,
      phone: phone || "",
      message,
      smsType,
      status: "failed",
      providerResponse: {
        error: failureMessage,
      },
      sentBy,
    });

    return {
      phone,
      normalized_phone: "",
      status: "failed",
      message: failureMessage,
      status_code: null,
      provider: null,
      provider_response: {
        error: failureMessage,
      },
    };
  }

  try {
    const result = await sendSms({
      to: normalizedPhone,
      message,
    });

    await writeSmsLog({
      branchId,
      phone: normalizedPhone,
      message,
      smsType,
      status: "sent",
      providerResponse: result.providerResponse,
      sentBy,
    });

    return {
      phone,
      normalized_phone: normalizedPhone,
      status: "sent",
      message: "SMS sent successfully.",
      provider: result.provider,
      status_code: null,
      provider_response: result.providerResponse || null,
    };
  } catch (error) {
    const providerResponse = error.providerResponse || null;
    const failureMessage = error.message || "SMS failed.";

    await writeSmsLog({
      branchId,
      phone: normalizedPhone,
      message,
      smsType,
      status: "failed",
      providerResponse: {
        error: failureMessage,
        statusCode: error.statusCode || null,
        provider: error.provider || null,
        providerResponse,
      },
      sentBy,
    });

    return {
      phone,
      normalized_phone: normalizedPhone,
      status: "failed",
      message: failureMessage,
      status_code: error.statusCode || null,
      provider: error.provider || null,
      provider_response: providerResponse,
    };
  }
}
router.get(
  "/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const config = getSmsConfig();

    const provider = String(config.provider || "mock").toLowerCase();
    const smsEnabled = Boolean(config.enabled);
    const isMock = provider === "mock";
    const isArkesel = provider === "arkesel";
    const isHubtel = provider === "hubtel";
    const isLive = smsEnabled && !isMock;

    const arkeselReady = Boolean(config.arkeselApiKey && config.senderId);
    const hubtelReady = Boolean(
      config.hubtelClientId &&
        config.hubtelClientSecret &&
        config.senderId
    );

    let providerLabel = "Mock";
    let modeTitle = "SMS MODE: MOCK";
    let modeMessage =
      "Safe testing mode. SMS records will be saved, but no real SMS credit will be used.";
    let safetyLevel = "safe";

    if (!smsEnabled) {
      providerLabel = "Disabled";
      modeTitle = "SMS DISABLED";
      modeMessage =
        "SMS sending is turned off. The system will not send SMS until SMS_ENABLED=true.";
      safetyLevel = "disabled";
    } else if (isArkesel) {
      providerLabel = "Arkesel";
      modeTitle = "SMS MODE: ARKESEL LIVE";
      modeMessage = arkeselReady
        ? "Live SMS is active. Real SMS will be sent and SMS credit will be used."
        : "Arkesel is selected, but the API key or Sender ID is missing. Live SMS will fail until configured.";
      safetyLevel = arkeselReady ? "live" : "warning";
    } else if (isHubtel) {
      providerLabel = "Hubtel";
      modeTitle = "SMS MODE: HUBTEL LIVE";
      modeMessage = hubtelReady
        ? "Live SMS is active. Real SMS will be sent and SMS credit will be used."
        : "Hubtel is selected, but Client ID, Client Secret, or Sender ID is missing. Live SMS will fail until configured.";
      safetyLevel = hubtelReady ? "live" : "warning";
    } else if (!isMock) {
      providerLabel = provider || "Unknown";
      modeTitle = "SMS PROVIDER ERROR";
      modeMessage = `Unsupported SMS provider "${provider}". Use mock, arkesel, or hubtel.`;
      safetyLevel = "danger";
    }

    res.json({
      status: "success",
      sms: {
        enabled: smsEnabled,
        provider,
        provider_label: providerLabel,
        sender_id: config.senderId || "",
        live_sending: isLive,
        safety_level: safetyLevel,
        mode_title: modeTitle,
        mode_message: modeMessage,
        arkesel_ready: arkeselReady,
        hubtel_ready: hubtelReady,
        supported_providers: ["mock", "arkesel", "hubtel"],
        live_bulk_confirmation_text: LIVE_BULK_CONFIRMATION_TEXT,
      },
    });
  })
);

router.get(
  "/customers",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);

    const [customers] = await runQuery(
      `
        SELECT id, name, phone, location
        FROM customers
        WHERE branch_id = ?
          AND phone IS NOT NULL
          AND TRIM(phone) <> ''
        ORDER BY name ASC, id DESC
      `,
      [branchId]
    );

    res.json({
      status: "success",
      branch_id: branchId,
      count: customers.length,
      customers,
    });
  })
);

router.get(
  "/logs",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);

    const [logs] = await runQuery(
      `
        SELECT 
          sl.id,
          sl.branch_id,
          b.branch_code,
          b.name AS branch_name,
          sl.recipient_phone,
          sl.message,
          sl.sms_type,
          sl.status,
          sl.provider_response,
          sl.sent_at,
          sl.created_at,
          u.full_name AS sent_by_name,
          u.username AS sent_by_username
        FROM sms_log sl
        LEFT JOIN branches b ON sl.branch_id = b.id
        LEFT JOIN users u ON sl.sent_by = u.id
        WHERE sl.branch_id = ?
        ORDER BY sl.id DESC
        LIMIT ${limit}
      `,
      [branchId]
    );

    res.json({
      status: "success",
      branch_id: branchId,
      count: logs.length,
      logs,
    });
  })
);

router.post(
  "/test",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const sentBy = getUserId(req);

    const phone = String(req.body.phone || "").trim();
    const message =
      cleanMessage(req.body.message) ||
      "CHALIN03 test SMS. Your SMS setup is working.";

    const result = await sendAndLogSms({
      branchId,
      phone,
      message,
      smsType: "other",
      sentBy,
    });

    const statusCode = result.status === "sent" ? 200 : 400;

    res.status(statusCode).json({
      status: result.status === "sent" ? "success" : "error",
      result,
    });
  })
);

router.post(
  "/receipt/:saleId",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const sentBy = getUserId(req);
    const saleId = Number(req.params.saleId);

    if (!Number.isInteger(saleId) || saleId <= 0) {
      return res.status(400).json({
        status: "error",
        message: "Invalid sale ID.",
      });
    }

    const [sales] = await runQuery(
      `
        SELECT
          s.id,
          s.branch_id,
          s.receipt_number,
          s.customer_name,
          s.customer_phone,
          s.subtotal,
          s.discount_amount,
          s.tax_amount,
          s.total,
          s.payment_type,
          s.amount_paid,
          s.balance,
          s.created_at,

          b.branch_code,
          b.name AS branch_name,
          b.location AS branch_location,

          st.business_name,
          st.business_phone,
          st.owner_phone,
          st.receipt_footer,

          u.full_name AS staff_name,
          u.username AS staff_username
        FROM sales s
        LEFT JOIN branches b ON s.branch_id = b.id
        LEFT JOIN settings st ON s.branch_id = st.branch_id
        LEFT JOIN users u ON s.staff_id = u.id
        WHERE s.id = ?
          AND s.branch_id = ?
        LIMIT 1
      `,
      [saleId, branchId]
    );

    if (sales.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Sale not found in the selected branch.",
      });
    }

    const sale = sales[0];

    const [items] = await runQuery(
      `
        SELECT product_name, quantity, unit_price, line_total
        FROM sale_items
        WHERE sale_id = ?
        ORDER BY id ASC
      `,
      [saleId]
    );

    const customerPhone = sale.customer_phone;

    if (!customerPhone) {
      return res.status(400).json({
        status: "error",
        message: "Customer phone number is missing for this sale.",
      });
    }

    const itemSummary = items
      .slice(0, 4)
      .map((item) => {
        return `${item.product_name} x${item.quantity}=GHS ${formatMoney(
          item.line_total
        )}`;
      })
      .join("; ");

    const moreItemsText =
      items.length > 4 ? `; +${items.length - 4} more item(s)` : "";

    const businessName = sale.business_name || "Chalin 03 Company Limited";
    const branchCode = sale.branch_code || "MAIN";
    const receiptFooter = sale.receipt_footer || "Thank You For Coming";

    const receiptMessage = `${businessName}: Receipt ${sale.receipt_number}. Items: ${itemSummary}${moreItemsText}. Total: GHS ${formatMoney(
      sale.total
    )}. Paid: GHS ${formatMoney(sale.amount_paid)}. Balance: GHS ${formatMoney(
      sale.balance
    )}. Store: ${branchCode}. ${receiptFooter}`;

    const finalMessage = truncateMessage(receiptMessage, 480);

    const result = await sendAndLogSms({
      branchId,
      phone: customerPhone,
      message: finalMessage,
      smsType: "receipt",
      sentBy,
    });

    const statusCode = result.status === "sent" ? 200 : 400;

    res.status(statusCode).json({
      status: result.status === "sent" ? "success" : "error",
      message:
        result.status === "sent"
          ? "Receipt SMS sent successfully."
          : result.message || "Receipt SMS failed.",
      result,
      sms_message: finalMessage,
    });
  })
);

router.post(
  "/debt/:debtId",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const sentBy = getUserId(req);
    const debtId = Number(req.params.debtId);

    if (!Number.isInteger(debtId) || debtId <= 0) {
      return res.status(400).json({
        status: "error",
        message: "Invalid debt ID.",
      });
    }

    const [debts] = await runQuery(
      `
        SELECT
          d.id,
          d.branch_id,
          d.sale_id,
          d.customer_id,
          d.customer_name,
          d.customer_phone,
          d.amount_owed,
          d.amount_paid,
          d.balance,
          d.status,
          d.due_date,
          d.created_at,
          d.updated_at,

          b.branch_code,
          b.name AS branch_name,
          b.location AS branch_location,

          st.business_name,
          st.business_phone,
          st.owner_phone,
          st.receipt_footer
        FROM debts d
        LEFT JOIN branches b ON d.branch_id = b.id
        LEFT JOIN settings st ON d.branch_id = st.branch_id
        WHERE d.id = ?
          AND d.branch_id = ?
        LIMIT 1
      `,
      [debtId, branchId]
    );

    if (debts.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Debt record not found in the selected branch.",
      });
    }

    const debt = debts[0];

    if (String(debt.status || "").toLowerCase() === "paid") {
      return res.status(400).json({
        status: "error",
        message: "This debt is already marked as paid.",
      });
    }

    if (Number(debt.balance || 0) <= 0) {
      return res.status(400).json({
        status: "error",
        message: "This debt has no outstanding balance.",
      });
    }

    if (!debt.customer_phone) {
      return res.status(400).json({
        status: "error",
        message: "Customer phone number is missing for this debt.",
      });
    }

    const businessName = debt.business_name || "Chalin 03 Company Limited";
    const branchCode = debt.branch_code || "MAIN";
    const customerName = debt.customer_name || "Customer";
    const balance = formatMoney(debt.balance);
    const ownerPhone = debt.owner_phone || "";
    const branchName = debt.branch_name || "Chalin 03";

    const dueDateText = debt.due_date
      ? ` Due date: ${new Date(debt.due_date).toLocaleDateString("en-GB")}.`
      : "";

    const contactText = ownerPhone
      ? ` Contact ${ownerPhone} for payment.`
      : "";

    const debtMessage = `${businessName}: Dear ${customerName}, your outstanding balance is GHS ${balance} at ${branchName} (${branchCode}). Please make payment.${dueDateText}${contactText} Thank you.`;

    const finalMessage = truncateMessage(debtMessage, 480);

    const result = await sendAndLogSms({
      branchId,
      phone: debt.customer_phone,
      message: finalMessage,
      smsType: "debt_reminder",
      sentBy,
    });

    const statusCode = result.status === "sent" ? 200 : 400;

    res.status(statusCode).json({
      status: result.status === "sent" ? "success" : "error",
      message:
        result.status === "sent"
          ? "Debt reminder SMS sent successfully."
          : result.message || "Debt reminder SMS failed.",
      result,
      sms_message: finalMessage,
    });
  })
);

router.post(
  "/low-stock/product/:productId",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const sentBy = getUserId(req);
    const productId = Number(req.params.productId);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({
        status: "error",
        message: "Invalid product ID.",
      });
    }

    const [products] = await runQuery(
      `
        SELECT
          p.id,
          p.branch_id,
          p.name,
          p.barcode,
          p.category,
          p.size,
          p.quantity,
          p.low_stock_threshold,

          b.branch_code,
          b.name AS branch_name,
          b.location AS branch_location,

          st.business_name,
          st.business_phone,
          st.owner_phone
        FROM products p
        LEFT JOIN branches b ON p.branch_id = b.id
        LEFT JOIN settings st ON p.branch_id = st.branch_id
        WHERE p.id = ?
          AND p.branch_id = ?
        LIMIT 1
      `,
      [productId, branchId]
    );

    if (products.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Product not found in the selected branch.",
      });
    }

    const product = products[0];
    const quantity = Number(product.quantity || 0);
    const threshold = Number(product.low_stock_threshold || 0);

    if (threshold > 0 && quantity > threshold) {
      return res.status(400).json({
        status: "error",
        message: "This product is not currently below its low-stock threshold.",
      });
    }

    const alertPhone = firstValidGhanaPhone(
      req.body.phone,
      product.owner_phone,
      product.business_phone
    );

    if (!alertPhone) {
      return res.status(400).json({
        status: "error",
        message:
          "No valid alert phone number found. Add owner phone in settings or provide phone in the request.",
      });
    }

    const businessName = product.business_name || "Chalin 03 Company Limited";
    const branchCode = product.branch_code || "MAIN";
    const branchName = product.branch_name || "Chalin 03";

    const productDetails = [
      product.name,
      product.size ? `Size: ${product.size}` : "",
      product.category ? `Category: ${product.category}` : "",
      product.barcode ? `Barcode: ${product.barcode}` : "",
    ]
      .filter(Boolean)
      .join(", ");

    const lowStockMessage = `${businessName}: Low stock alert for ${branchName} (${branchCode}). ${productDetails} has only ${quantity} left. Threshold: ${threshold}. Please restock soon.`;

    const finalMessage = truncateMessage(lowStockMessage, 480);

    const result = await sendAndLogSms({
      branchId,
      phone: alertPhone,
      message: finalMessage,
      smsType: "low_stock",
      sentBy,
    });

    const statusCode = result.status === "sent" ? 200 : 400;

    res.status(statusCode).json({
      status: result.status === "sent" ? "success" : "error",
      message:
        result.status === "sent"
          ? "Low stock SMS alert sent successfully."
          : result.message || "Low stock SMS alert failed.",
      result,
      sms_message: finalMessage,
      product,
    });
  })
);

router.post(
  "/low-stock/all",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const sentBy = getUserId(req);

    const [branchSettings] = await runQuery(
      `
        SELECT
          b.id AS branch_id,
          b.branch_code,
          b.name AS branch_name,
          b.location AS branch_location,

          st.business_name,
          st.business_phone,
          st.owner_phone
        FROM branches b
        LEFT JOIN settings st ON b.id = st.branch_id
        WHERE b.id = ?
        LIMIT 1
      `,
      [branchId]
    );

    const settings = branchSettings[0] || {};

    const [lowStockProducts] = await runQuery(
      `
        SELECT
          id,
          name,
          barcode,
          category,
          size,
          quantity,
          low_stock_threshold
        FROM products
        WHERE branch_id = ?
          AND low_stock_threshold IS NOT NULL
          AND quantity <= low_stock_threshold
        ORDER BY quantity ASC, name ASC
      `,
      [branchId]
    );

    if (lowStockProducts.length === 0) {
      return res.json({
        status: "success",
        message: "No low-stock products found in the selected branch.",
        branch_id: branchId,
        count: 0,
        products: [],
      });
    }

    const alertPhone = firstValidGhanaPhone(
      req.body.phone,
      settings.owner_phone,
      settings.business_phone
    );

    if (!alertPhone) {
      return res.status(400).json({
        status: "error",
        message:
          "No valid alert phone number found. Add owner phone in settings or provide phone in the request.",
      });
    }

    const businessName = settings.business_name || "Chalin 03 Company Limited";
    const branchCode = settings.branch_code || "MAIN";
    const branchName = settings.branch_name || "Chalin 03";

    const productSummary = lowStockProducts
      .slice(0, 8)
      .map((product) => {
        return `${product.name}: ${Number(product.quantity || 0)}/${Number(
          product.low_stock_threshold || 0
        )}`;
      })
      .join("; ");

    const moreText =
      lowStockProducts.length > 8
        ? `; +${lowStockProducts.length - 8} more product(s)`
        : "";

    const lowStockMessage = `${businessName}: Low stock alert for ${branchName} (${branchCode}). ${lowStockProducts.length} product(s) need attention: ${productSummary}${moreText}. Please restock soon.`;

    const finalMessage = truncateMessage(lowStockMessage, 480);

    const result = await sendAndLogSms({
      branchId,
      phone: alertPhone,
      message: finalMessage,
      smsType: "low_stock",
      sentBy,
    });

    const statusCode = result.status === "sent" ? 200 : 400;

    res.status(statusCode).json({
      status: result.status === "sent" ? "success" : "error",
      message:
        result.status === "sent"
          ? "All low stock SMS alert sent successfully."
          : result.message || "Low stock SMS alert failed.",
      result,
      sms_message: finalMessage,
      branch_id: branchId,
      count: lowStockProducts.length,
      products: lowStockProducts,
    });
  })
);

router.post(
  "/daily-summary",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const sentBy = getUserId(req);
    const { dateText } = getDateRange(req.body.date || req.query.date);

    const [branchSettings] = await runQuery(
      `
        SELECT
          b.id AS branch_id,
          b.branch_code,
          b.name AS branch_name,
          b.location AS branch_location,
          st.business_name,
          st.business_phone,
          st.owner_phone
        FROM branches b
        LEFT JOIN settings st ON b.id = st.branch_id
        WHERE b.id = ?
        LIMIT 1
      `,
      [branchId]
    );

    const settings = branchSettings[0] || {};
    const alertPhone = firstValidGhanaPhone(
      req.body.phone,
      settings.owner_phone,
      settings.business_phone
    );

    if (!alertPhone) {
      return res.status(400).json({
        status: "error",
        message:
          "No valid phone number found for daily summary. Add owner phone in settings or provide phone in the request.",
      });
    }

    const [closingRows] = await runQuery(
      `
        SELECT
          dc.id,
          dc.closing_date,
          dc.sales_count,
          dc.sales_total,
          dc.sales_received,
          dc.debt_payment_count,
          dc.debt_payments_total,
          dc.expenses_count,
          dc.expenses_total,
          dc.expected_cash,
          dc.expected_momo,
          dc.expected_bank,
          dc.expected_other,
          dc.expected_total,
          dc.cash_counted,
          dc.momo_counted,
          dc.bank_counted,
          dc.other_counted,
          dc.total_counted,
          dc.difference_total,
          dc.verification_status,
          dc.stale_after_close,
          dc.closed_at,
          u.full_name AS closed_by_name
        FROM daily_closings dc
        LEFT JOIN users u ON dc.closed_by = u.id
        WHERE dc.branch_id = ?
          AND dc.closing_date = ?
        LIMIT 1
      `,
      [branchId, dateText]
    );

    if (closingRows.length === 0) {
      return res.status(409).json({
        status: "error",
        message:
          "Complete Daily Closing for this store and date before sending the official boss summary SMS.",
      });
    }

    const closing = closingRows[0];
    const businessName = settings.business_name || "Chalin 03 Company Limited";
    const branchCode = settings.branch_code || "MAIN";
    const branchName = settings.branch_name || "Chalin 03";

    const dailySummaryMessage = `${businessName}: Official Daily Closing ${branchName} (${branchCode}) ${dateText}. Sales GHS ${formatMoney(
      closing.sales_total
    )}; received at sale GHS ${formatMoney(
      closing.sales_received
    )}; debt collected GHS ${formatMoney(
      closing.debt_payments_total
    )}; expenses GHS ${formatMoney(
      closing.expenses_total
    )}. Expected C ${formatMoney(closing.expected_cash)}, M ${formatMoney(
      closing.expected_momo
    )}, B ${formatMoney(closing.expected_bank)}, O ${formatMoney(
      closing.expected_other
    )}; counted GHS ${formatMoney(
      closing.total_counted
    )}; variance GHS ${formatMoney(
      closing.difference_total
    )}. Closed by ${closing.closed_by_name || "Manager"}.`;

    const finalMessage = truncateMessage(dailySummaryMessage, 480);
    const result = await sendAndLogSms({
      branchId,
      phone: alertPhone,
      message: finalMessage,
      smsType: "daily_summary",
      sentBy,
    });

    const statusCode = result.status === "sent" ? 200 : 400;

    return res.status(statusCode).json({
      status: result.status === "sent" ? "success" : "error",
      message:
        result.status === "sent"
          ? "Official Daily Closing summary SMS sent successfully."
          : result.message || "Daily Closing summary SMS failed.",
      result,
      sms_message: finalMessage,
      summary: {
        ...closing,
        branch_id: branchId,
        branch_code: branchCode,
        branch_name: branchName,
      },
    });
  })
);

router.post(
  "/custom",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const sentBy = getUserId(req);

    const targetType = String(req.body.target_type || "").toLowerCase();
    const message = cleanMessage(req.body.message);
    const smsType = req.body.sms_type || "other";
    const customerIds = cleanCustomerIds(req.body.customer_ids);
    const manualPhone = String(req.body.phone || "").trim();

    const config = getSmsConfig();
    const isLiveSmsMode =
      Boolean(config.enabled) &&
      String(config.provider || "mock").toLowerCase() !== "mock";

    const confirmLiveBulk =
      req.body.confirm_live_bulk === true ||
      String(req.body.confirm_live_bulk || "").toLowerCase() === "true";

    const confirmText = String(req.body.confirm_text || "")
      .trim()
      .toUpperCase();

    if (!message) {
      return res.status(400).json({
        status: "error",
        message: "Type the SMS message before sending.",
      });
    }

    if (message.length > 480) {
      return res.status(400).json({
        status: "error",
        message: "SMS message is too long. Keep it under 480 characters.",
      });
    }

    if (targetType === "all" && isLiveSmsMode) {
      if (!confirmLiveBulk || confirmText !== LIVE_BULK_CONFIRMATION_TEXT) {
        return res.status(400).json({
          status: "error",
          message: `Live bulk SMS is locked for safety. Tick the confirmation box and type ${LIVE_BULK_CONFIRMATION_TEXT} before sending to all customers.`,
          requires_confirmation: true,
          confirmation_text: LIVE_BULK_CONFIRMATION_TEXT,
        });
      }
    }

    let recipients = [];

    if (targetType === "single") {
      if (!manualPhone) {
        return res.status(400).json({
          status: "error",
          message: "Enter a phone number for single SMS.",
        });
      }

      recipients = [
        {
          id: null,
          name: "Manual Recipient",
          phone: manualPhone,
        },
      ];
    } else if (targetType === "selected") {
      if (customerIds.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "Select at least one customer.",
        });
      }

      const placeholders = customerIds.map(() => "?").join(", ");

      const [customers] = await runQuery(
        `
          SELECT id, name, phone, location
          FROM customers
          WHERE branch_id = ?
            AND id IN (${placeholders})
            AND phone IS NOT NULL
            AND TRIM(phone) <> ''
          ORDER BY name ASC, id DESC
        `,
        [branchId, ...customerIds]
      );

      recipients = customers;
    } else if (targetType === "all") {
      const [customers] = await runQuery(
        `
          SELECT id, name, phone, location
          FROM customers
          WHERE branch_id = ?
            AND phone IS NOT NULL
            AND TRIM(phone) <> ''
          ORDER BY name ASC, id DESC
        `,
        [branchId]
      );

      recipients = customers;
    } else {
      return res.status(400).json({
        status: "error",
        message: "Invalid target type. Use single, selected, or all.",
      });
    }

    const maxBulkRecipients = Math.max(
      Number(process.env.SMS_MAX_BULK_RECIPIENTS || 200),
      1
    );

    const uniqueRecipients = [];
    const phoneTracker = new Set();

    for (const recipient of recipients) {
      const normalizedPhone = normalizeGhanaPhone(recipient.phone);

      if (!normalizedPhone) {
        continue;
      }

      if (phoneTracker.has(normalizedPhone)) {
        continue;
      }

      phoneTracker.add(normalizedPhone);

      uniqueRecipients.push({
        ...recipient,
        normalized_phone: normalizedPhone,
      });
    }

    if (uniqueRecipients.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No valid customer phone numbers found.",
      });
    }

    if (uniqueRecipients.length > maxBulkRecipients) {
      return res.status(400).json({
        status: "error",
        message: `Too many recipients. Maximum allowed at once is ${maxBulkRecipients}.`,
      });
    }

    const results = [];

    for (const recipient of uniqueRecipients) {
      const result = await sendAndLogSms({
        branchId,
        phone: recipient.normalized_phone,
        message,
        smsType,
        sentBy,
      });

      results.push({
        customer_id: recipient.id,
        customer_name: recipient.name,
        ...result,
      });
    }

    const sentCount = results.filter(
      (result) => result.status === "sent"
    ).length;

    const failedCount = results.filter(
      (result) => result.status === "failed"
    ).length;

    res.json({
      status: failedCount === 0 ? "success" : "partial",
      message: `SMS sending completed. Sent: ${sentCount}. Failed: ${failedCount}.`,
      branch_id: branchId,
      total_recipients: results.length,
      sent_count: sentCount,
      failed_count: failedCount,
      results,
    });
  })
);

router.post(
  "/retry/:logId",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const sentBy = getUserId(req);
    const logId = Number(req.params.logId);

    if (!Number.isInteger(logId) || logId <= 0) {
      return res.status(400).json({
        status: "error",
        message: "Invalid SMS log ID.",
      });
    }

    const [logs] = await runQuery(
      `
        SELECT
          id,
          branch_id,
          recipient_phone,
          message,
          sms_type,
          status,
          created_at
        FROM sms_log
        WHERE id = ?
          AND branch_id = ?
        LIMIT 1
      `,
      [logId, branchId]
    );

    if (logs.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "SMS log not found in the selected branch.",
      });
    }

    const originalLog = logs[0];

    if (String(originalLog.status || "").toLowerCase() !== "failed") {
      return res.status(400).json({
        status: "error",
        message: "Only failed SMS messages can be retried.",
      });
    }

    if (!originalLog.recipient_phone) {
      return res.status(400).json({
        status: "error",
        message: "This SMS log has no phone number to retry.",
      });
    }

    if (!originalLog.message) {
      return res.status(400).json({
        status: "error",
        message: "This SMS log has no message to retry.",
      });
    }

    const result = await sendAndLogSms({
      branchId,
      phone: originalLog.recipient_phone,
      message: originalLog.message,
      smsType: originalLog.sms_type || "other",
      sentBy,
    });

    const statusCode = result.status === "sent" ? 200 : 400;

    res.status(statusCode).json({
      status: result.status === "sent" ? "success" : "error",
      message:
        result.status === "sent"
          ? "SMS retry sent successfully."
          : result.message || "SMS retry failed.",
      original_log_id: originalLog.id,
      result,
    });
  })
);

module.exports = router;