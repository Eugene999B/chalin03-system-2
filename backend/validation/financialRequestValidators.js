const core = require("./financialRequestValidatorsCore");

// Compatibility note: the legacy sanitized sale contract still owns fields such as
// "customer_id" and remains byte-for-byte authoritative unless physical unit IDs
// are explicitly supplied on one or more sale items.
const INVENTORY_UNIT_CODE_PATTERN = /^[A-Z0-9]{3,12}-[A-HJ-NP-Z2-9]{8}$/;

function unitError(field, message, code) {
  return { field, message, code };
}

function normalizeUnitIds(value, { itemIndex, quantity }) {
  if (value === undefined || value === null) {
    return { ok: true, unit_ids: [], errors: [] };
  }
  const field = `body.items[${itemIndex}].unit_ids`;
  if (!Array.isArray(value)) {
    return {
      ok: false,
      unit_ids: [],
      errors: [
        unitError(
          field,
          "Physical inventory unit IDs must be provided as a list.",
          "INVALID_INVENTORY_UNIT_IDS"
        ),
      ],
    };
  }
  if (value.length > Number(quantity || 0)) {
    return {
      ok: false,
      unit_ids: [],
      errors: [
        unitError(
          field,
          "Physical unit ID count cannot be greater than the sale quantity.",
          "INVENTORY_UNIT_COUNT_EXCEEDS_QUANTITY"
        ),
      ],
    };
  }

  const errors = [];
  const codes = [];
  const seen = new Set();
  value.forEach((entry, unitIndex) => {
    const code = String(entry || "").trim().toUpperCase();
    const unitField = `${field}[${unitIndex}]`;
    if (!INVENTORY_UNIT_CODE_PATTERN.test(code)) {
      errors.push(
        unitError(
          unitField,
          "Inventory unit ID format is invalid.",
          "INVALID_INVENTORY_UNIT_ID"
        )
      );
      return;
    }
    if (seen.has(code)) {
      errors.push(
        unitError(
          unitField,
          `Duplicate physical inventory unit ID: ${code}.`,
          "DUPLICATE_INVENTORY_UNIT_ID"
        )
      );
      return;
    }
    seen.add(code);
    codes.push(code);
  });
  return { ok: errors.length === 0, unit_ids: codes, errors };
}

function validateSaleCreateRequest(context = {}) {
  const body = context.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return core.validateSaleCreateRequest(context);
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const sanitizedItems = rawItems.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const { unit_ids: _unitIds, ...legacyItem } = item;
    return legacyItem;
  });
  const legacyResult = core.validateSaleCreateRequest({
    ...context,
    body: { ...body, items: sanitizedItems },
  });
  if (!legacyResult.ok) return legacyResult;

  const hasPhysicalUnitFields = rawItems.some(
    (item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      Object.prototype.hasOwnProperty.call(item, "unit_ids")
  );
  if (!hasPhysicalUnitFields) {
    return legacyResult;
  }

  const unitErrors = [];
  const normalizedItems = legacyResult.value.body.items.map((item, index) => {
    const rawItem = rawItems[index];
    const hasUnitIds =
      rawItem &&
      typeof rawItem === "object" &&
      !Array.isArray(rawItem) &&
      Object.prototype.hasOwnProperty.call(rawItem, "unit_ids");
    if (!hasUnitIds) return item;

    const normalized = normalizeUnitIds(rawItem.unit_ids, {
      itemIndex: index,
      quantity: item.quantity,
    });
    unitErrors.push(...normalized.errors);
    return { ...item, unit_ids: normalized.unit_ids };
  });
  if (unitErrors.length > 0) {
    return { ok: false, value: null, errors: unitErrors };
  }

  return {
    ...legacyResult,
    value: {
      ...legacyResult.value,
      body: {
        ...legacyResult.value.body,
        items: normalizedItems,
      },
    },
  };
}

module.exports = {
  ...core,
  INVENTORY_UNIT_CODE_PATTERN,
  normalizeUnitIds,
  validateSaleCreateRequest,
};
