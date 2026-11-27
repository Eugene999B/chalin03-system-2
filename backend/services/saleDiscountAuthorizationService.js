"use strict";

const { pool } = require("../config/db");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");

const BOSS_NAME = "agyapong charles";

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function hasVerifiedBossIdentity(user, matchingAccounts) {
  if (String(user?.role || "").toLowerCase() !== "admin") return false;
  if (!Number.isSafeInteger(Number(user?.id)) || Number(user?.id) <= 0) return false;
  // Refuse to guess whose account is the boss if names are duplicated.
  if (!Array.isArray(matchingAccounts) || matchingAccounts.length !== 1) return false;
  const account = matchingAccounts[0];
  return Number(account.id) === Number(user.id) &&
    normalizeName(account.full_name) === BOSS_NAME &&
    String(account.role || "").trim().toLowerCase() === "admin" &&
    Number(account.is_active) === 1 &&
    (!process.env.DISCOUNT_BOSS_USER_ID ||
      Number(process.env.DISCOUNT_BOSS_USER_ID) === Number(user.id));
}

/**
 * Only the original protected System Administrator or the unique ACTIVE
 * administrator account belonging to Agyapong Charles can grant sale discounts.
 * Never trust arbitrary JWT full_name claims, request bodies or client role flags.
 */
async function canApplySaleDiscount(user, database = pool) {
  if (isOriginalSystemAdministrator(user)) return true;
  if (String(user?.role || "").trim().toLowerCase() !== "admin") return false;
  const userId = Number(user?.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return false;

  const [rows] = await database.query(
    `SELECT id, full_name, role, is_active FROM users
      WHERE LOWER(TRIM(full_name)) = ? AND is_active = 1
      LIMIT 2`,
    [BOSS_NAME]
  );
  return hasVerifiedBossIdentity(user, rows);
}

function discountApprovalRequired(discountValue) {
  const discount = Number(discountValue);
  return Number.isFinite(discount) && discount > 0;
}

module.exports = {
  BOSS_NAME,
  normalizeName,
  hasVerifiedBossIdentity,
  canApplySaleDiscount,
  discountApprovalRequired,
};
