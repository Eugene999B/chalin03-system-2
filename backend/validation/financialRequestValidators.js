const MAX_AMOUNT = 999999999.99;
const MAX_ITEMS_PER_SALE = 200;
const MONEY_PATTERN = /^\d{1,9}(?:\.\d{1,2})?$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const SALE_PAYMENT_TYPES = new Set([
  "cash",
  "momo",
  "bank",
  "credit",
  "mixed",
  "installment",
]);
const PAYMENT_ALLOCATION_CHANNELS = new Set(["cash", "momo", "bank", "other"]);
const RETURN_TYPES = new Set(["stock_only", "refund"]);
const REFUND_METHODS = new Set(["cash", "momo", "bank", "other"]);
const PURCHASE_PAYMENT_METHODS = new Set([
  "cash",
  "momo",
  "bank",
  "mixed",
  "other",
]);
const INSTALLMENT_PAYMENT_METHODS = new Set(["cash", "momo", "bank", "other"]);
const INSTALLMENT_FREQUENCIES = new Set([
  "weekly",
  "fortnightly",
  "monthly",
  "custom",
]);
const DELIVERY_POLICIES = new Set(["immediate", "after_full_payment"]);
const LATE_CHARGE_TYPES = new Set(["none", "fixed", "percentage"]);

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

function unknownKeys(object, allowedKeys) {
  return Object.keys(object).filter((key) => !allowedKeys.has(key));
}

function rejectUnknownKeys(object, allowedKeys, fieldPrefix, errors) {
  for (const key of unknownKeys(object, allowedKeys)) {
    addError(
      errors,
      `${fieldPrefix}.${key}`,
      `Unknown request field: ${key}.`,
      "UNKNOWN_FIELD"
    );
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

function parseMoney(
  value,
  { allowZero = false, emptyAsZero = false } = {}
) {
  const normalized = String(value ?? "").trim();

  if (!normalized && emptyAsZero) {
    return 0;
  }

  if (!MONEY_PATTERN.test(normalized)) {
    return null;
  }

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

function optionalText(
  value,
  { field, maxLength, errors, preserveWhitespace = false } = {}
) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    addError(errors, field, `${field} must be text.`, "INVALID_TEXT");
    return null;
  }

  const text = preserveWhitespace ? value : value.trim();
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

function requiredText(value, options = {}) {
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

function validatePaymentAllocations(value, errors) {
  const allocations = { cash: 0, momo: 0, bank: 0, other: 0 };

  if (value === undefined || value === null) {
    return allocations;
  }

  if (Array.isArray(value)) {
    const seen = new Set();

    value.forEach((item, index) => {
      const field = `body.payment_allocations[${index}]`;

      if (!isPlainObject(item)) {
        addError(
          errors,
          field,
          "Each payment allocation must be an object.",
          "INVALID_PAYMENT_ALLOCATION"
        );
        return;
      }

      rejectUnknownKeys(
        item,
        new Set(["payment_channel", "channel", "amount"]),
        field,
        errors
      );

      const channel = String(
        item.payment_channel ?? item.channel ?? ""
      )
        .trim()
        .toLowerCase();

      if (!PAYMENT_ALLOCATION_CHANNELS.has(channel)) {
        addError(
          errors,
          `${field}.payment_channel`,
          "Payment allocation channel must be cash, momo, bank or other.",
          "INVALID_PAYMENT_CHANNEL"
        );
        return;
      }

      if (seen.has(channel)) {
        addError(
          errors,
          `${field}.payment_channel`,
          `Duplicate payment allocation channel: ${channel}.`,
          "DUPLICATE_PAYMENT_CHANNEL"
        );
        return;
      }

      seen.add(channel);
      const amount = parseMoney(item.amount, {
        allowZero: true,
        emptyAsZero: true,
      });

      if (amount === null) {
        addError(
          errors,
          `${field}.amount`,
          "Payment allocation amounts must be non-negative with no more than two decimal places.",
          "INVALID_PAYMENT_ALLOCATION_AMOUNT"
        );
        return;
      }

      allocations[channel] = amount;
    });

    return allocations;
  }

  if (!isPlainObject(value)) {
    addError(
      errors,
      "body.payment_allocations",
      "Payment allocations must be an object or array.",
      "INVALID_PAYMENT_ALLOCATIONS"
    );
    return allocations;
  }

  rejectUnknownKeys(
    value,
    PAYMENT_ALLOCATION_CHANNELS,
    "body.payment_allocations",
    errors
  );

  for (const channel of PAYMENT_ALLOCATION_CHANNELS) {
    const amount = parseMoney(value[channel], {
      allowZero: true,
      emptyAsZero: true,
    });

    if (amount === null) {
      addError(
        errors,
        `body.payment_allocations.${channel}`,
        "Payment allocation amounts must be non-negative with no more than two decimal places.",
        "INVALID_PAYMENT_ALLOCATION_AMOUNT"
      );
      continue;
    }

    allocations[channel] = amount;
  }

  return allocations;
}

function validateInstallmentPlan(plan, paymentType, customerPhone, errors) {
  if (paymentType !== "installment") {
    return null;
  }

  if (!isPlainObject(plan)) {
    addError(
      errors,
      "body.installment_plan",
      "Installment sale details must be provided as an object.",
      "INVALID_INSTALLMENT_PLAN"
    );
    return null;
  }

  const allowedKeys = new Set([
    "frequency",
    "installment_count",
    "first_due_date",
    "grace_days",
    "delivery_policy",
    "late_charge_type",
    "late_charge_value",
    "guarantor_name",
    "guarantor_phone",
    "guarantor_location",
    "terms_accepted",
    "notes",
    "custom_due_dates",
    "custom_due_dates_text",
    "customer_phone",
  ]);
  rejectUnknownKeys(plan, allowedKeys, "body.installment_plan", errors);

  const frequency = String(plan.frequency || "monthly")
    .trim()
    .toLowerCase();
  if (!INSTALLMENT_FREQUENCIES.has(frequency)) {
    addError(
      errors,
      "body.installment_plan.frequency",
      "Installment frequency must be weekly, fortnightly, monthly or custom.",
      "INVALID_INSTALLMENT_FREQUENCY"
    );
  }

  const installmentCount = parseWholeNumber(
    plan.installment_count === undefined ? 3 : plan.installment_count,
    { min: 1, max: 120 }
  );
  if (installmentCount === null) {
    addError(
      errors,
      "body.installment_plan.installment_count",
      "Installment count must be a whole number between 1 and 120.",
      "INVALID_INSTALLMENT_COUNT"
    );
  }

  const firstDueDate = parseDateOnly(plan.first_due_date);
  if (!firstDueDate) {
    addError(
      errors,
      "body.installment_plan.first_due_date",
      "A valid first due date in YYYY-MM-DD format is required.",
      "INVALID_FIRST_DUE_DATE"
    );
  }

  const graceDays = parseWholeNumber(
    plan.grace_days === undefined ? 0 : plan.grace_days,
    { min: 0, max: 60 }
  );
  if (graceDays === null) {
    addError(
      errors,
      "body.installment_plan.grace_days",
      "Grace days must be a whole number between 0 and 60.",
      "INVALID_GRACE_DAYS"
    );
  }

  const deliveryPolicy = String(plan.delivery_policy || "immediate")
    .trim()
    .toLowerCase();
  if (!DELIVERY_POLICIES.has(deliveryPolicy)) {
    addError(
      errors,
      "body.installment_plan.delivery_policy",
      "Delivery policy must be immediate or after_full_payment.",
      "INVALID_DELIVERY_POLICY"
    );
  }

  const lateChargeType = String(plan.late_charge_type || "none")
    .trim()
    .toLowerCase();
  if (!LATE_CHARGE_TYPES.has(lateChargeType)) {
    addError(
      errors,
      "body.installment_plan.late_charge_type",
      "Late charge type must be none, fixed or percentage.",
      "INVALID_LATE_CHARGE_TYPE"
    );
  }

  const lateChargeValue = parseMoney(plan.late_charge_value, {
    allowZero: true,
    emptyAsZero: true,
  });
  if (lateChargeValue === null) {
    addError(
      errors,
      "body.installment_plan.late_charge_value",
      "Late charge value must be non-negative with no more than two decimal places.",
      "INVALID_LATE_CHARGE_VALUE"
    );
  }

  if (typeof plan.terms_accepted !== "boolean" || !plan.terms_accepted) {
    addError(
      errors,
      "body.installment_plan.terms_accepted",
      "The customer must accept the installment terms.",
      "INSTALLMENT_TERMS_REQUIRED"
    );
  }

  const customDatesFromText =
    typeof plan.custom_due_dates_text === "string"
      ? plan.custom_due_dates_text
          .split(/[\n,]+/)
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  const rawCustomDates = Array.isArray(plan.custom_due_dates)
    ? plan.custom_due_dates
    : customDatesFromText;

  const customDueDates = rawCustomDates.map(parseDateOnly);
  if (rawCustomDates.some((value, index) => !customDueDates[index])) {
    addError(
      errors,
      "body.installment_plan.custom_due_dates",
      "Every custom due date must use YYYY-MM-DD format.",
      "INVALID_CUSTOM_DUE_DATE"
    );
  }

  if (
    frequency === "custom" &&
    installmentCount !== null &&
    customDueDates.length !== installmentCount
  ) {
    addError(
      errors,
      "body.installment_plan.custom_due_dates",
      "Custom schedules require one due date for every installment.",
      "CUSTOM_DUE_DATE_COUNT_MISMATCH"
    );
  }

  if (
    frequency === "custom" &&
    new Set(customDueDates.filter(Boolean)).size !==
      customDueDates.filter(Boolean).length
  ) {
    addError(
      errors,
      "body.installment_plan.custom_due_dates",
      "Custom due dates cannot contain duplicates.",
      "DUPLICATE_CUSTOM_DUE_DATE"
    );
  }

  const normalizedCustomerPhone = optionalText(
    plan.customer_phone ?? customerPhone,
    {
      field: "body.installment_plan.customer_phone",
      maxLength: 30,
      errors,
    }
  );

  return {
    frequency,
    installment_count: installmentCount,
    first_due_date: firstDueDate,
    grace_days: graceDays,
    delivery_policy: deliveryPolicy,
    late_charge_type: lateChargeType,
    late_charge_value: lateChargeValue,
    guarantor_name: optionalText(plan.guarantor_name, {
      field: "body.installment_plan.guarantor_name",
      maxLength: 150,
      errors,
    }),
    guarantor_phone: optionalText(plan.guarantor_phone, {
      field: "body.installment_plan.guarantor_phone",
      maxLength: 30,
      errors,
    }),
    guarantor_location: optionalText(plan.guarantor_location, {
      field: "body.installment_plan.guarantor_location",
      maxLength: 180,
      errors,
    }),
    terms_accepted: plan.terms_accepted === true,
    notes: optionalText(plan.notes, {
      field: "body.installment_plan.notes",
      maxLength: 2000,
      errors,
    }),
    custom_due_dates: customDueDates.filter(Boolean),
    custom_due_dates_text: optionalText(plan.custom_due_dates_text, {
      field: "body.installment_plan.custom_due_dates_text",
      maxLength: 4000,
      errors,
    }),
    customer_phone: normalizedCustomerPhone,
  };
}

function validateSaleCreateRequest({ body }) {
  const errors = [];

  if (!isPlainObject(body)) {
    addError(
      errors,
      "body",
      "Sale details must be sent as a JSON object.",
      "INVALID_JSON_OBJECT"
    );
    return failure(errors);
  }

  const allowedKeys = new Set([
    "customer_id",
    "customer_name",
    "customer_phone",
    "customer_location",
    "payment_type",
    "amount_tendered",
    "amount_paid",
    "discount_amount",
    "payment_allocations",
    "installment_plan",
    "items",
  ]);
  rejectUnknownKeys(body, allowedKeys, "body", errors);

  const customerId =
    body.customer_id === undefined || body.customer_id === null || body.customer_id === ""
      ? null
      : parsePositiveInteger(body.customer_id);
  if (body.customer_id !== undefined && body.customer_id !== null && body.customer_id !== "" && customerId === null) {
    addError(
      errors,
      "body.customer_id",
      "Customer ID must be a positive whole number.",
      "INVALID_CUSTOMER_ID"
    );
  }

  const customerName = optionalText(body.customer_name, {
    field: "body.customer_name",
    maxLength: 150,
    errors,
  });
  const customerPhone = optionalText(body.customer_phone, {
    field: "body.customer_phone",
    maxLength: 30,
    errors,
  });
  const customerLocation = optionalText(body.customer_location, {
    field: "body.customer_location",
    maxLength: 180,
    errors,
  });

  const paymentType = String(body.payment_type || "")
    .trim()
    .toLowerCase();
  if (!SALE_PAYMENT_TYPES.has(paymentType)) {
    addError(
      errors,
      "body.payment_type",
      "Payment type must be cash, momo, bank, credit, mixed or installment.",
      "INVALID_SALE_PAYMENT_TYPE"
    );
  }

  const discountAmount = parseMoney(body.discount_amount, {
    allowZero: true,
    emptyAsZero: true,
  });
  if (discountAmount === null) {
    addError(
      errors,
      "body.discount_amount",
      "Discount must be non-negative with no more than two decimal places.",
      "INVALID_DISCOUNT_AMOUNT"
    );
  }

  const amountTendered = parseMoney(
    body.amount_tendered ?? body.amount_paid ?? 0,
    { allowZero: true, emptyAsZero: true }
  );
  const amountPaid = parseMoney(
    body.amount_paid ?? body.amount_tendered ?? 0,
    { allowZero: true, emptyAsZero: true }
  );

  if (amountTendered === null) {
    addError(
      errors,
      "body.amount_tendered",
      "Amount tendered must be non-negative with no more than two decimal places.",
      "INVALID_AMOUNT_TENDERED"
    );
  }
  if (amountPaid === null) {
    addError(
      errors,
      "body.amount_paid",
      "Amount paid must be non-negative with no more than two decimal places.",
      "INVALID_AMOUNT_PAID"
    );
  }

  const paymentAllocations = validatePaymentAllocations(
    body.payment_allocations,
    errors
  );

  const items = [];
  const seenProducts = new Set();

  if (!Array.isArray(body.items) || body.items.length === 0) {
    addError(
      errors,
      "body.items",
      "Sale must contain at least one item.",
      "EMPTY_SALE_ITEMS"
    );
  } else if (body.items.length > MAX_ITEMS_PER_SALE) {
    addError(
      errors,
      "body.items",
      `Sale cannot contain more than ${MAX_ITEMS_PER_SALE} items.`,
      "TOO_MANY_SALE_ITEMS"
    );
  } else {
    body.items.forEach((item, index) => {
      const field = `body.items[${index}]`;

      if (!isPlainObject(item)) {
        addError(
          errors,
          field,
          "Each sale item must be an object.",
          "INVALID_SALE_ITEM"
        );
        return;
      }

      rejectUnknownKeys(item, new Set(["product_id", "quantity"]), field, errors);

      const productId = parsePositiveInteger(item.product_id);
      const quantity = parsePositiveInteger(item.quantity);

      if (productId === null) {
        addError(
          errors,
          `${field}.product_id`,
          "Product ID must be a positive whole number.",
          "INVALID_PRODUCT_ID"
        );
      }

      if (quantity === null) {
        addError(
          errors,
          `${field}.quantity`,
          "Quantity must be a positive whole number.",
          "INVALID_QUANTITY"
        );
      }

      if (productId !== null) {
        if (seenProducts.has(productId)) {
          addError(
            errors,
            `${field}.product_id`,
            "The same product cannot appear more than once in one sale.",
            "DUPLICATE_PRODUCT"
          );
        }
        seenProducts.add(productId);
      }

      items.push({ product_id: productId, quantity });
    });
  }

  if (
    ["credit", "mixed", "installment"].includes(paymentType) &&
    !customerName &&
    !customerPhone
  ) {
    addError(
      errors,
      "body.customer_name",
      "Customer name or phone is required for credit, mixed or installment sales.",
      "CUSTOMER_REQUIRED"
    );
  }

  if (paymentType === "installment" && (!customerName || !customerPhone)) {
    addError(
      errors,
      "body.customer_phone",
      "Installment sales require both customer name and phone.",
      "INSTALLMENT_CUSTOMER_REQUIRED"
    );
  }

  const installmentPlan = validateInstallmentPlan(
    body.installment_plan,
    paymentType,
    customerPhone,
    errors
  );

  if (errors.length > 0) {
    return failure(errors);
  }

  return success({
    body: {
      customer_id: customerId,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_location: customerLocation,
      payment_type: paymentType,
      amount_tendered: amountTendered,
      amount_paid: amountPaid,
      discount_amount: discountAmount,
      payment_allocations: paymentAllocations,
      installment_plan: installmentPlan,
      items,
    },
  });
}

function validateReturnCreateRequest({ body }) {
  const errors = [];

  if (!isPlainObject(body)) {
    addError(
      errors,
      "body",
      "Return details must be sent as a JSON object.",
      "INVALID_JSON_OBJECT"
    );
    return failure(errors);
  }

  const allowedKeys = new Set([
    "sale_id",
    "product_id",
    "quantity",
    "reason",
    "return_type",
    "refund_amount",
    "refund_method",
    "refund_reference",
    "approver_username",
    "approver_password",
  ]);
  rejectUnknownKeys(body, allowedKeys, "body", errors);

  const saleId = parsePositiveInteger(body.sale_id);
  const productId = parsePositiveInteger(body.product_id);
  const quantity = parsePositiveInteger(body.quantity);

  if (saleId === null) {
    addError(errors, "body.sale_id", "Sale ID is invalid.", "INVALID_SALE_ID");
  }
  if (productId === null) {
    addError(
      errors,
      "body.product_id",
      "Product ID is invalid.",
      "INVALID_PRODUCT_ID"
    );
  }
  if (quantity === null) {
    addError(
      errors,
      "body.quantity",
      "Return quantity must be a positive whole number.",
      "INVALID_RETURN_QUANTITY"
    );
  }

  const reason = requiredText(body.reason, {
    field: "body.reason",
    maxLength: 500,
    errors,
  });

  const returnType = String(body.return_type || "stock_only")
    .trim()
    .toLowerCase();
  if (!RETURN_TYPES.has(returnType)) {
    addError(
      errors,
      "body.return_type",
      "Return type must be stock_only or refund.",
      "INVALID_RETURN_TYPE"
    );
  }

  const refundAmount = parseMoney(body.refund_amount, {
    allowZero: true,
    emptyAsZero: true,
  });
  if (refundAmount === null) {
    addError(
      errors,
      "body.refund_amount",
      "Refund amount must be non-negative with no more than two decimal places.",
      "INVALID_REFUND_AMOUNT"
    );
  }

  const refundMethod = String(body.refund_method || "none")
    .trim()
    .toLowerCase();
  if (refundMethod !== "none" && !REFUND_METHODS.has(refundMethod)) {
    addError(
      errors,
      "body.refund_method",
      "Refund method must be none, cash, momo, bank or other.",
      "INVALID_REFUND_METHOD"
    );
  }

  const refundReference = optionalText(body.refund_reference, {
    field: "body.refund_reference",
    maxLength: 180,
    errors,
  });
  const approverUsername = optionalText(body.approver_username, {
    field: "body.approver_username",
    maxLength: 150,
    errors,
  });
  const approverPassword = optionalText(body.approver_password, {
    field: "body.approver_password",
    maxLength: 200,
    errors,
    preserveWhitespace: true,
  });

  if (returnType === "refund") {
    if (refundAmount === null || refundAmount <= 0) {
      addError(
        errors,
        "body.refund_amount",
        "A financial refund requires a positive refund amount.",
        "REFUND_AMOUNT_REQUIRED"
      );
    }
    if (!REFUND_METHODS.has(refundMethod)) {
      addError(
        errors,
        "body.refund_method",
        "A financial refund requires cash, momo, bank or other as its method.",
        "REFUND_METHOD_REQUIRED"
      );
    }
    if (
      ["momo", "bank", "other"].includes(refundMethod) &&
      !refundReference
    ) {
      addError(
        errors,
        "body.refund_reference",
        "A transaction or reference number is required for this refund method.",
        "REFUND_REFERENCE_REQUIRED"
      );
    }
    if (!approverUsername || !approverPassword) {
      addError(
        errors,
        "body.approver_username",
        "A different manager or administrator must approve a financial refund.",
        "REFUND_APPROVER_REQUIRED"
      );
    }
  } else {
    if ((refundAmount ?? 0) !== 0) {
      addError(
        errors,
        "body.refund_amount",
        "Stock-only returns cannot contain a refund amount.",
        "UNEXPECTED_REFUND_AMOUNT"
      );
    }
    if (refundMethod !== "none") {
      addError(
        errors,
        "body.refund_method",
        "Stock-only returns must use refund method none.",
        "UNEXPECTED_REFUND_METHOD"
      );
    }
    if (refundReference || approverUsername || approverPassword) {
      addError(
        errors,
        "body.refund_reference",
        "Stock-only returns cannot contain refund approval details.",
        "UNEXPECTED_REFUND_DETAILS"
      );
    }
  }

  if (errors.length > 0) {
    return failure(errors);
  }

  return success({
    body: {
      sale_id: saleId,
      product_id: productId,
      quantity,
      reason,
      return_type: returnType,
      refund_amount: refundAmount,
      refund_method: refundMethod,
      refund_reference: refundReference,
      approver_username: approverUsername,
      approver_password: approverPassword,
    },
  });
}

function validatePurchasePaymentRequest({ params, body }) {
  const errors = [];
  const purchaseId = parsePositiveInteger(params?.id);

  if (purchaseId === null) {
    addError(
      errors,
      "params.id",
      "Purchase ID must be a positive whole number.",
      "INVALID_PURCHASE_ID"
    );
  }

  if (!isPlainObject(body)) {
    addError(
      errors,
      "body",
      "Purchase payment details must be sent as a JSON object.",
      "INVALID_JSON_OBJECT"
    );
    return failure(errors);
  }

  rejectUnknownKeys(
    body,
    new Set(["amount", "payment_method", "notes"]),
    "body",
    errors
  );

  const amount = parseMoney(body.amount);
  if (amount === null) {
    addError(
      errors,
      "body.amount",
      "Payment amount must be greater than zero and contain no more than two decimal places.",
      "INVALID_PAYMENT_AMOUNT"
    );
  }

  const paymentMethod =
    body.payment_method === undefined ||
    body.payment_method === null ||
    body.payment_method === ""
      ? "cash"
      : String(body.payment_method).trim().toLowerCase();

  if (!PURCHASE_PAYMENT_METHODS.has(paymentMethod)) {
    addError(
      errors,
      "body.payment_method",
      "Purchase payment method must be cash, momo, bank, mixed or other.",
      "INVALID_PURCHASE_PAYMENT_METHOD"
    );
  }

  const notes = optionalText(body.notes, {
    field: "body.notes",
    maxLength: 500,
    errors,
  });

  if (errors.length > 0) {
    return failure(errors);
  }

  return success({
    params: { id: purchaseId },
    body: { amount, payment_method: paymentMethod, notes },
  });
}

function validateInstallmentPaymentRequest({ params, body }) {
  const errors = [];
  const agreementId = parsePositiveInteger(params?.agreementId);

  if (agreementId === null) {
    addError(
      errors,
      "params.agreementId",
      "Agreement ID must be a positive whole number.",
      "INVALID_AGREEMENT_ID"
    );
  }

  if (!isPlainObject(body)) {
    addError(
      errors,
      "body",
      "Installment payment details must be sent as a JSON object.",
      "INVALID_JSON_OBJECT"
    );
    return failure(errors);
  }

  rejectUnknownKeys(
    body,
    new Set([
      "amount",
      "payment_method",
      "payment_reference",
      "notes",
      "send_sms",
    ]),
    "body",
    errors
  );

  const amount = parseMoney(body.amount);
  if (amount === null) {
    addError(
      errors,
      "body.amount",
      "Installment payment amount must be greater than zero with no more than two decimal places.",
      "INVALID_INSTALLMENT_PAYMENT_AMOUNT"
    );
  }

  const paymentMethod = String(body.payment_method || "")
    .trim()
    .toLowerCase();
  if (!INSTALLMENT_PAYMENT_METHODS.has(paymentMethod)) {
    addError(
      errors,
      "body.payment_method",
      "Installment payment method must be cash, momo, bank or other.",
      "INVALID_INSTALLMENT_PAYMENT_METHOD"
    );
  }

  const paymentReference = optionalText(body.payment_reference, {
    field: "body.payment_reference",
    maxLength: 150,
    errors,
  });
  const notes = optionalText(body.notes, {
    field: "body.notes",
    maxLength: 500,
    errors,
  });

  let sendSms = true;
  if (body.send_sms !== undefined) {
    if (typeof body.send_sms !== "boolean") {
      addError(
        errors,
        "body.send_sms",
        "send_sms must be true or false.",
        "INVALID_SEND_SMS"
      );
    } else {
      sendSms = body.send_sms;
    }
  }

  if (errors.length > 0) {
    return failure(errors);
  }

  return success({
    params: { agreementId },
    body: {
      amount,
      payment_method: paymentMethod,
      payment_reference: paymentReference,
      notes,
      send_sms: sendSms,
    },
  });
}

module.exports = {
  MAX_AMOUNT,
  MAX_ITEMS_PER_SALE,
  parseDateOnly,
  parseMoney,
  parsePositiveInteger,
  validateInstallmentPaymentRequest,
  validatePurchasePaymentRequest,
  validateReturnCreateRequest,
  validateSaleCreateRequest,
};
