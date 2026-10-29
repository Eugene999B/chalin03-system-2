const {
  MOVEMENT_TYPES,
  movementLabel,
} = require("./stockMovementService");

const OPENING_BALANCE_LABEL = movementLabel(MOVEMENT_TYPES.OPENING_BALANCE);

function ledgerNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

function isOpeningBalanceEntry(entry) {
  const source = String(entry?.source || "").trim().toLowerCase();
  const movement = String(entry?.movement_type || "").trim().toLowerCase();

  return (
    source === "stock_adjustments" &&
    (movement === MOVEMENT_TYPES.OPENING_BALANCE ||
      movement === OPENING_BALANCE_LABEL.toLowerCase())
  );
}

function correctStockLedgerSummary(payload) {
  if (
    !payload ||
    payload.status !== "success" ||
    !payload.summary ||
    !Array.isArray(payload.ledger)
  ) {
    return payload;
  }

  const openingEntries = payload.ledger.filter(isOpeningBalanceEntry);

  if (openingEntries.length === 0) {
    return payload;
  }

  let openingNetChange = 0;
  let openingIncrease = 0;
  let openingDecrease = 0;

  openingEntries.forEach((entry) => {
    const change = ledgerNumber(entry.change_quantity);

    openingNetChange += change;

    if (change > 0) {
      openingIncrease += change;
    }

    if (change < 0) {
      openingDecrease += Math.abs(change);
    }
  });

  return {
    ...payload,
    summary: {
      ...payload.summary,
      opening_quantity:
        ledgerNumber(payload.summary.opening_quantity) + openingNetChange,
      total_adjustment_increase_quantity: Math.max(
        0,
        ledgerNumber(payload.summary.total_adjustment_increase_quantity) -
          openingIncrease
      ),
      total_adjustment_decrease_quantity: Math.max(
        0,
        ledgerNumber(payload.summary.total_adjustment_decrease_quantity) -
          openingDecrease
      ),
    },
  };
}

module.exports = {
  OPENING_BALANCE_LABEL,
  correctStockLedgerSummary,
  isOpeningBalanceEntry,
  ledgerNumber,
};
