const {
  MOVEMENT_TYPES,
  validateMovementCompatibility,
} = require("../services/stockMovementService");

const MAX_AMOUNT = 999999999.99;
const MAX_ITEMS = 200;
const MONEY_PATTERN = /^\d{1,9}(?:\.\d{1,2})?$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const PURCHASE_ITEM_KEYS = new Set([
  "product_id",
  "product_name",
  "quantity",
  "cost_price",
  "line_total",
]);
const EXPENSE_PAYMENT_METHODS = new Set(["cash", "momo", "bank", "other"]);
const EXPENSE_FUNDING_SOURCES = new Set([
  "today_sales_receipts",
  "petty_cash",
  "prior_business_funds",
  "owner_manager_funds",
  "bank_account",
  "momo_wallet",
  "unpaid_credit",
  "other",
]);
const STOCK_ADJUSTMENT_TYPES = new Set(["increase", "decrease", "set"]);
const STOCK_MOVEMENT_TYPES = new Set(Object.values(MOVEMENT_TYPES));
const TRANSFER_ACTION_NOTE_KEYS = Object.freeze({
  approve: "approval_note",
  reject: "reject_note",
  dispatch: "dispatch_note",
  receive: "receive_note",
  cancel: "cancel_note",
});

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function addError(errors, field, message, code = "INVALID_VALUE") {
  errors.push({ field, code, message });
}

function success(value) {
  return { ok: true, value, errors: [] };
}

function failure(errors) {
  return { ok: false, value: null, errors };
}

function rejectUnknownKeys(object, allowedKeys, fieldPrefix, errors) {
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) {
      addError(
        errors,
        `${fieldPrefix}.${key}`,
        `Unknown request field: ${key}.`,
        "UNKNOWN_FIELD"
      );
    }
  }
}

function parsePositiveInteger(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) return null;

  const number = Number(normalized);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function parseWholeNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) return null;

  const number = Number(normalized);
  return Number.isSafeInteger(number) && number >= min && number <= max
    ? number
    : null;
}

function parseMoney(value, { allowZero = false, emptyAsZero = false } = {}) {
  const normalized = String(value ?? "").trim();

  if (!normalized && emptyAsZero) return 0;
  if (!MONEY_PATTERN.test(normalized)) return null;

  const number = Number(normalized);
  if (
    !Number.isFinite(number) ||
    number < 0 ||
    (!allowZero && number <= 0) ||
    number > MAX_AMOUNT
  ) {
    return null;
  }

  return Number(number.toFixed(2));
}

function parseDateOnly(value) {
  const text = String(value ?? "").trim();
  if (!DATE_ONLY_PATTERN.test(text)) return null;

  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10) === text ? text : null;
}

function optionalText(value, { field, maxLength, errors }) {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value !== "string") {
    addError(errors, field, `${field} must be text.`, "INVALID_TEXT");
    return null;
  }

  const text = value.trim();
  if (!text) return null;

  if (text.length > maxLength) {
    addError(
      errors,
      field,
      `${field} cannot exceed ${maxLength} characters.`,
      "TEXT_TOO_LONG"
    );
    return null;
  }

  return text;
}

function requiredText(value, options) {
  const text = optionalText(value, options);
  if (!text) {
    addError(
      options.errors,
      options.field,
      `${options.field} is required.`,
      "REQUIRED_FIELD"
    );
  }
  return text;
}

function validatePurchaseCreateRequest({ body }) {
  const errors = [];

  if (!isPlainObject(body)) {
    addError(
      errors,
      "body",
      "Purchase details must be sent as a JSON object.",
      "INVALID_JSON_OBJECT"
    );
    return failure(errors);
  }

  rejectUnknownKeys(
    body,
    new Set([
      "supplier_id",
      "invoice_number",
      "purchase_date",
      "amount_paid",
      "notes",
      "items",
    ]),
    "body",
    errors
  );

  let supplierId = null;
  if (body.supplier_id !== undefined && body.supplier_id !== null && body.supplier_id !== "") {
    supplierId = parsePositiveInteger(body.supplier_id);
    if (supplierId === null) {
      addError(
        errors,
        "body.supplier_id",
        "Supplier ID must be a positive whole number.",
        "INVALID_SUPPLIER_ID"
      );
    }
  }

  const invoiceNumber = optionalText(body.invoice_number, {
    field: "body.invoice_number",
    maxLength: 180,
    errors,
  });
  const purchaseDate = parseDateOnly(body.purchase_date);
  if (!purchaseDate) {
    addError(
      errors,
      "body.purchase_date",
      "Purchase date must use YYYY-MM-DD format.",
      "INVALID_PURCHASE_DATE"
    );
  }

  const amountPaid = parseMoney(body.amount_paid, {
    allowZero: true,
    emptyAsZero: true,
  });
  if (amountPaid === null) {
    addError(
      errors,
      "body.amount_paid",
      "Amount paid must be non-negative with no more than two decimal places.",
      "INVALID_AMOUNT_PAID"
    );
  }

  const notes = optionalText(body.notes, {
    field: "body.notes",
    maxLength: 2000,
    errors,
  });

  if (!Array.isArray(body.items) || body.items.length === 0) {
    addError(
      errors,
      "body.items",
      "At least one purchase item is required.",
      "PURCHASE_ITEMS_REQUIRED"
    );
  } else if (body.items.length > MAX_ITEMS) {
    addError(
      errors,
      "body.items",
      `A purchase cannot contain more than ${MAX_ITEMS} items.`,
      "TOO_MANY_PURCHASE_ITEMS"
    );
  }

  const items = [];
  const seenProducts = new Set();

  for (let index = 0; index < (Array.isArray(body.items) ? body.items.length : 0); index += 1) {
    const item = body.items[index];
    const field = `body.items[${index}]`;

    if (!isPlainObject(item)) {
      addError(errors, field, "Each purchase item must be an object.", "INVALID_PURCHASE_ITEM");
      continue;
    }

    rejectUnknownKeys(item, PURCHASE_ITEM_KEYS, field, errors);

    const productId = parsePositiveInteger(item.product_id);
    const quantity = parseWholeNumber(item.quantity, { min: 1, max: 1000000 });
    const costPrice = parseMoney(item.cost_price, { allowZero: true });

    if (productId === null) {
      addError(errors, `${field}.product_id`, "Product ID must be a positive whole number.", "INVALID_PRODUCT_ID");
    } else if (seenProducts.has(productId)) {
      addError(errors, `${field}.product_id`, "The same product cannot appear more than once in a purchase.", "DUPLICATE_PRODUCT");
    } else {
      seenProducts.add(productId);
    }

    if (quantity === null) {
      addError(errors, `${field}.quantity`, "Purchase quantity must be a positive whole number.", "INVALID_PURCHASE_QUANTITY");
    }

    if (costPrice === null) {
      addError(errors, `${field}.cost_price`, "Cost price must be non-negative with no more than two decimal places.", "INVALID_COST_PRICE");
    }

    if (productId !== null && quantity !== null && costPrice !== null) {
      items.push({ product_id: productId, quantity, cost_price: costPrice });
    }
  }

  const calculatedTotal = Number(
    items.reduce((sum, item) => sum + item.quantity * item.cost_price, 0).toFixed(2)
  );

  if (amountPaid !== null && amountPaid > calculatedTotal) {
    addError(
      errors,
      "body.amount_paid",
      "Amount paid cannot be greater than the calculated purchase total.",
      "AMOUNT_PAID_EXCEEDS_TOTAL"
    );
  }

  if (errors.length > 0) return failure(errors);

  return success({
    body: {
      supplier_id: supplierId,
      invoice_number: invoiceNumber,
      purchase_date: purchaseDate,
      amount_paid: amountPaid,
      notes,
      items,
    },
  });
}

function validateExpenseCreateRequest({ body }) {
  const errors = [];

  if (!isPlainObject(body)) {
    addError(errors, "body", "Expense details must be sent as a JSON object.", "INVALID_JSON_OBJECT");
    return failure(errors);
  }

  rejectUnknownKeys(
    body,
    new Set([
      "category",
      "description",
      "amount",
      "payment_method",
      "funding_source",
      "affects_daily_closing",
      "closing_treatment_note",
      "expense_date",
    ]),
    "body",
    errors
  );

  const category = requiredText(body.category, {
    field: "body.category",
    maxLength: 150,
    errors,
  });
  const description = optionalText(body.description, {
    field: "body.description",
    maxLength: 2000,
    errors,
  });
  const amount = parseMoney(body.amount);
  if (amount === null) {
    addError(errors, "body.amount", "Expense amount must be greater than zero with no more than two decimal places.", "INVALID_EXPENSE_AMOUNT");
  }

  const paymentMethod = String(body.payment_method || "cash").trim().toLowerCase();
  if (!EXPENSE_PAYMENT_METHODS.has(paymentMethod)) {
    addError(errors, "body.payment_method", "Expense payment method must be cash, momo, bank or other.", "INVALID_EXPENSE_PAYMENT_METHOD");
  }

  const fundingSource = String(body.funding_source || "").trim().toLowerCase();
  if (!EXPENSE_FUNDING_SOURCES.has(fundingSource)) {
    addError(errors, "body.funding_source", "Choose a valid source of funds for this expense.", "INVALID_FUNDING_SOURCE");
  }

  let affectsDailyClosing = null;
  if (typeof body.affects_daily_closing !== "boolean") {
    addError(errors, "body.affects_daily_closing", "affects_daily_closing must be true or false.", "INVALID_AFFECTS_DAILY_CLOSING");
  } else {
    affectsDailyClosing = body.affects_daily_closing;
  }

  const closingTreatmentNote = optionalText(body.closing_treatment_note, {
    field: "body.closing_treatment_note",
    maxLength: 500,
    errors,
  });
  const expenseDate = parseDateOnly(body.expense_date);
  if (!expenseDate) {
    addError(errors, "body.expense_date", "Expense date must use YYYY-MM-DD format.", "INVALID_EXPENSE_DATE");
  }

  if (affectsDailyClosing === true && fundingSource !== "today_sales_receipts") {
    addError(errors, "body.funding_source", "Only Today's Sales Receipts may reduce Daily Closing.", "INVALID_DAILY_CLOSING_FUNDING");
  }
  if (affectsDailyClosing === false && fundingSource === "today_sales_receipts") {
    addError(errors, "body.affects_daily_closing", "Today's Sales Receipts must reduce the selected Daily Closing payment channel.", "DAILY_CLOSING_REQUIRED");
  }
  if (fundingSource === "unpaid_credit" && paymentMethod !== "other") {
    addError(errors, "body.payment_method", "Unpaid credit expenses must use Other as the payment method.", "INVALID_UNPAID_CREDIT_METHOD");
  }
  if (fundingSource === "other" && (!closingTreatmentNote || closingTreatmentNote.length < 8)) {
    addError(errors, "body.closing_treatment_note", "Describe the other funding source using at least 8 characters.", "OTHER_FUNDING_NOTE_REQUIRED");
  }

  if (errors.length > 0) return failure(errors);

  return success({
    body: {
      category,
      description,
      amount,
      payment_method: paymentMethod,
      funding_source: fundingSource,
      affects_daily_closing: affectsDailyClosing,
      closing_treatment_note: closingTreatmentNote,
      expense_date: expenseDate,
    },
  });
}

function validateStockAdjustmentRequest({ params, body }) {
  const errors = [];
  const productId = parsePositiveInteger(params?.id);

  if (productId === null) {
    addError(errors, "params.id", "Product ID must be a positive whole number.", "INVALID_PRODUCT_ID");
  }

  if (!isPlainObject(body)) {
    addError(errors, "body", "Stock adjustment details must be sent as a JSON object.", "INVALID_JSON_OBJECT");
    return failure(errors);
  }

  rejectUnknownKeys(
    body,
    new Set([
      "adjustment_type",
      "movement_type",
      "quantity",
      "reason",
      "reference_number",
      "movement_date",
      "notes",
    ]),
    "body",
    errors
  );

  const adjustmentType = String(body.adjustment_type || "").trim().toLowerCase();
  if (!STOCK_ADJUSTMENT_TYPES.has(adjustmentType)) {
    addError(errors, "body.adjustment_type", "Adjustment type must be increase, decrease or set.", "INVALID_ADJUSTMENT_TYPE");
  }

  const quantity = parseWholeNumber(body.quantity, { min: 0, max: 1000000000 });
  if (quantity === null) {
    addError(errors, "body.quantity", "Quantity must be a whole number and cannot be negative.", "INVALID_STOCK_QUANTITY");
  } else if (adjustmentType !== "set" && quantity <= 0) {
    addError(errors, "body.quantity", "Increase or decrease quantity must be greater than zero.", "STOCK_QUANTITY_REQUIRED");
  }

  const defaultMovementType =
    adjustmentType === "increase"
      ? MOVEMENT_TYPES.CORRECTION_INCREASE
      : adjustmentType === "decrease"
        ? MOVEMENT_TYPES.CORRECTION_DECREASE
        : MOVEMENT_TYPES.PHYSICAL_COUNT;
  const movementType = String(body.movement_type || defaultMovementType)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (!STOCK_MOVEMENT_TYPES.has(movementType)) {
    addError(errors, "body.movement_type", "Choose a recognized stock movement type.", "INVALID_STOCK_MOVEMENT_TYPE");
  } else if (STOCK_ADJUSTMENT_TYPES.has(adjustmentType)) {
    try {
      validateMovementCompatibility(adjustmentType, movementType);
    } catch (error) {
      addError(errors, "body.movement_type", error.message, "INCOMPATIBLE_STOCK_MOVEMENT");
    }
  }

  const reason = requiredText(body.reason, {
    field: "body.reason",
    maxLength: 500,
    errors,
  });
  const referenceNumber = optionalText(body.reference_number, {
    field: "body.reference_number",
    maxLength: 180,
    errors,
  });
  const movementDate = parseDateOnly(body.movement_date);
  if (!movementDate) {
    addError(errors, "body.movement_date", "Movement date must use YYYY-MM-DD format.", "INVALID_MOVEMENT_DATE");
  }
  const notes = optionalText(body.notes, {
    field: "body.notes",
    maxLength: 1000,
    errors,
  });

  if (errors.length > 0) return failure(errors);

  return success({
    params: { id: productId },
    body: {
      adjustment_type: adjustmentType,
      movement_type: movementType,
      quantity,
      reason,
      reference_number: referenceNumber,
      movement_date: movementDate,
      notes,
    },
  });
}

function coalesceAliasedPositiveInteger(item, aliases, field, errors) {
  const supplied = aliases
    .filter((key) => item[key] !== undefined && item[key] !== null && item[key] !== "")
    .map((key) => ({ key, value: parsePositiveInteger(item[key]) }));

  if (supplied.length === 0 || supplied.some((entry) => entry.value === null)) {
    addError(errors, field, `${field} must be a positive whole number.`, "INVALID_POSITIVE_INTEGER");
    return null;
  }

  const distinct = new Set(supplied.map((entry) => entry.value));
  if (distinct.size > 1) {
    addError(errors, field, `${field} aliases contain conflicting values.`, "CONFLICTING_ALIASES");
    return null;
  }

  return supplied[0].value;
}

function validateStockTransferCreateRequest({ body }) {
  const errors = [];

  if (!isPlainObject(body)) {
    addError(errors, "body", "Stock transfer details must be sent as a JSON object.", "INVALID_JSON_OBJECT");
    return failure(errors);
  }

  rejectUnknownKeys(
    body,
    new Set(["from_branch_id", "to_branch_id", "request_note", "note", "items"]),
    "body",
    errors
  );

  const fromBranchId = parsePositiveInteger(body.from_branch_id);
  const toBranchId = parsePositiveInteger(body.to_branch_id);
  if (fromBranchId === null) {
    addError(errors, "body.from_branch_id", "Source store ID must be a positive whole number.", "INVALID_SOURCE_BRANCH_ID");
  }
  if (toBranchId === null) {
    addError(errors, "body.to_branch_id", "Destination store ID must be a positive whole number.", "INVALID_DESTINATION_BRANCH_ID");
  }
  if (fromBranchId !== null && toBranchId !== null && fromBranchId === toBranchId) {
    addError(errors, "body.to_branch_id", "Source and destination stores cannot be the same.", "SAME_TRANSFER_BRANCH");
  }

  const requestNote = optionalText(body.request_note ?? body.note, {
    field: "body.request_note",
    maxLength: 1000,
    errors,
  });
  if (
    body.request_note !== undefined &&
    body.note !== undefined &&
    String(body.request_note ?? "").trim() !== String(body.note ?? "").trim()
  ) {
    addError(errors, "body.note", "Transfer note aliases contain conflicting values.", "CONFLICTING_ALIASES");
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    addError(errors, "body.items", "Please add at least one product to transfer.", "TRANSFER_ITEMS_REQUIRED");
  } else if (body.items.length > MAX_ITEMS) {
    addError(errors, "body.items", `A transfer cannot contain more than ${MAX_ITEMS} items.`, "TOO_MANY_TRANSFER_ITEMS");
  }

  const items = [];
  const seenProducts = new Set();
  const allowedItemKeys = new Set([
    "source_product_id",
    "product_id",
    "id",
    "requested_quantity",
    "quantity",
    "transfer_quantity",
    "item_note",
    "note",
  ]);

  for (let index = 0; index < (Array.isArray(body.items) ? body.items.length : 0); index += 1) {
    const item = body.items[index];
    const field = `body.items[${index}]`;

    if (!isPlainObject(item)) {
      addError(errors, field, "Each transfer item must be an object.", "INVALID_TRANSFER_ITEM");
      continue;
    }

    rejectUnknownKeys(item, allowedItemKeys, field, errors);

    const productId = coalesceAliasedPositiveInteger(
      item,
      ["source_product_id", "product_id", "id"],
      `${field}.source_product_id`,
      errors
    );
    const quantity = coalesceAliasedPositiveInteger(
      item,
      ["requested_quantity", "quantity", "transfer_quantity"],
      `${field}.requested_quantity`,
      errors
    );

    if (productId !== null && seenProducts.has(productId)) {
      addError(errors, `${field}.source_product_id`, "The same product cannot appear more than once in a transfer.", "DUPLICATE_TRANSFER_PRODUCT");
    } else if (productId !== null) {
      seenProducts.add(productId);
    }

    const itemNote = optionalText(item.item_note ?? item.note, {
      field: `${field}.item_note`,
      maxLength: 500,
      errors,
    });
    if (
      item.item_note !== undefined &&
      item.note !== undefined &&
      String(item.item_note ?? "").trim() !== String(item.note ?? "").trim()
    ) {
      addError(errors, `${field}.note`, "Transfer item note aliases contain conflicting values.", "CONFLICTING_ALIASES");
    }

    if (productId !== null && quantity !== null) {
      items.push({
        source_product_id: productId,
        requested_quantity: quantity,
        item_note: itemNote,
      });
    }
  }

  if (errors.length > 0) return failure(errors);

  return success({
    body: {
      from_branch_id: fromBranchId,
      to_branch_id: toBranchId,
      request_note: requestNote,
      items,
    },
  });
}

function validateStockTransferActionRequest(action) {
  const noteKey = TRANSFER_ACTION_NOTE_KEYS[action];
  if (!noteKey) throw new TypeError(`Unsupported stock transfer action: ${action}`);

  return function stockTransferActionValidator({ params, body }) {
    const errors = [];
    const transferId = parsePositiveInteger(params?.id);

    if (transferId === null) {
      addError(errors, "params.id", "Transfer ID must be a positive whole number.", "INVALID_TRANSFER_ID");
    }

    if (!isPlainObject(body)) {
      addError(errors, "body", "Transfer action details must be sent as a JSON object.", "INVALID_JSON_OBJECT");
      return failure(errors);
    }

    rejectUnknownKeys(body, new Set([noteKey, "note"]), "body", errors);

    const actionNote = optionalText(body[noteKey] ?? body.note, {
      field: `body.${noteKey}`,
      maxLength: 1000,
      errors,
    });

    if (
      body[noteKey] !== undefined &&
      body.note !== undefined &&
      String(body[noteKey] ?? "").trim() !== String(body.note ?? "").trim()
    ) {
      addError(errors, "body.note", "Transfer action note aliases contain conflicting values.", "CONFLICTING_ALIASES");
    }

    if (errors.length > 0) return failure(errors);

    return success({
      params: { id: transferId },
      body: { [noteKey]: actionNote, note: actionNote },
    });
  };
}

module.exports = {
  MAX_AMOUNT,
  MAX_ITEMS,
  validateExpenseCreateRequest,
  validatePurchaseCreateRequest,
  validateStockAdjustmentRequest,
  validateStockTransferActionRequest,
  validateStockTransferCreateRequest,
};
