"use strict";

const { canApplySaleDiscount } = require("../services/saleDiscountAuthorizationService");

/**
 * Defense in depth for Equipment Hire, Equipment Sales and commercial quotes:
 * discounts embedded in line items are subject to the same boss-only policy.
 * Mounted after authentication; no changes to zero-discount transactions.
 */
function hasPositiveDiscountField(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 15) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => hasPositiveDiscountField(entry, depth + 1));
  }
  return Object.entries(value).some(([key, item]) =>
    key === "discount_amount"
      ? Number.isFinite(Number(item)) && Number(item) > 0
      : hasPositiveDiscountField(item, depth + 1)
  );
}

async function requireBossForPositiveDiscount(req, res, next) {
  if (!["POST", "PUT", "PATCH"].includes(String(req.method || "").toUpperCase()) ||
      !hasPositiveDiscountField(req.body)) {
    return next();
  }

  try {
    if (await canApplySaleDiscount(req.user)) return next();
    return res.status(403).json({
      status: "error",
      code: "DISCOUNT_BOSS_ONLY",
      message: "Only Agyapong Charles (Boss) or the original System Administrator may grant discounts.",
    });
  } catch (error) {
    console.error("Discount authorization failed:", error);
    return res.status(503).json({
      status: "error",
      code: "DISCOUNT_PERMISSION_UNAVAILABLE",
      message: "Discount authority could not be verified.",
    });
  }
}

module.exports = { hasPositiveDiscountField, requireBossForPositiveDiscount };
