const MOVEMENT_TYPES = Object.freeze({
  QUICK_RESTOCK: "quick_restock",
  CORRECTION_INCREASE: "correction_increase",
  CORRECTION_DECREASE: "correction_decrease",
  DAMAGED: "damaged",
  LOST_MISSING: "lost_missing",
  PHYSICAL_COUNT: "physical_count",
  OPENING_BALANCE: "opening_balance",
  OTHER: "other",
});

const MOVEMENT_LABELS = Object.freeze({
  quick_restock: "Quick Restock",
  correction_increase: "Correction Increase",
  correction_decrease: "Correction Decrease",
  damaged: "Damaged Stock",
  lost_missing: "Lost / Missing Stock",
  physical_count: "Physical Count",
  opening_balance: "Opening Balance",
  other: "Other Stock Movement",
});

function normalizeMovementType(value, fallback = MOVEMENT_TYPES.OTHER) {
  const cleanValue = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  return Object.values(MOVEMENT_TYPES).includes(cleanValue)
    ? cleanValue
    : fallback;
}

function movementLabel(value) {
  const movementType = normalizeMovementType(value);
  return MOVEMENT_LABELS[movementType] || MOVEMENT_LABELS.other;
}

function validateMovementCompatibility(adjustmentType, movementType) {
  const adjustment = String(adjustmentType || "").toLowerCase();
  const movement = normalizeMovementType(movementType);

  const allowed = {
    increase: [MOVEMENT_TYPES.CORRECTION_INCREASE, MOVEMENT_TYPES.OTHER],
    decrease: [
      MOVEMENT_TYPES.CORRECTION_DECREASE,
      MOVEMENT_TYPES.DAMAGED,
      MOVEMENT_TYPES.LOST_MISSING,
      MOVEMENT_TYPES.OTHER,
    ],
    set: [MOVEMENT_TYPES.PHYSICAL_COUNT, MOVEMENT_TYPES.OTHER],
  };

  if (!allowed[adjustment]?.includes(movement)) {
    throw new Error(
      `${movementLabel(movement)} is not valid for a ${adjustment || "stock"} adjustment.`
    );
  }

  return movement;
}

function calculateStockAfter({ currentQuantity, adjustmentType, quantity }) {
  const current = Number(currentQuantity);
  const amount = Number(quantity);

  if (!Number.isInteger(current) || current < 0) {
    throw new Error("Current stock quantity is invalid.");
  }

  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("Quantity must be a whole number and cannot be negative.");
  }

  let next = current;

  if (adjustmentType === "increase") next = current + amount;
  if (adjustmentType === "decrease") next = current - amount;
  if (adjustmentType === "set") next = amount;

  if (next < 0) {
    throw new Error("Stock cannot be less than zero.");
  }

  return next;
}

module.exports = {
  MOVEMENT_LABELS,
  MOVEMENT_TYPES,
  calculateStockAfter,
  movementLabel,
  normalizeMovementType,
  validateMovementCompatibility,
};
