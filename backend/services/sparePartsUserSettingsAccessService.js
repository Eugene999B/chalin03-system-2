const { pool } = require("../config/db");

const SYSTEM_ADMIN_ID = Number(process.env.SYSTEM_ADMIN_USER_ID || 1);
const SYSTEM_ADMIN_USERNAME = String(
  process.env.SYSTEM_ADMIN_USERNAME || "admin"
).toLowerCase();
const SPARE_PARTS = "spare_parts";

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function isSparePartsWorkspace(user) {
  const workspace = normalize(
    user?.workspace_code || user?.selected_workspace_code || user?.primary_workspace_code
  );
  return !workspace || workspace === SPARE_PARTS;
}

function isOriginalSystemAdministrator(user) {
  return (
    Number(user?.id) === SYSTEM_ADMIN_ID &&
    normalize(user?.username) === SYSTEM_ADMIN_USERNAME &&
    normalize(user?.role) === "admin"
  );
}

function branchIdForUser(user) {
  const branchId = Number(user?.branch_id || user?.default_branch_id || 1);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : 1;
}

async function getUserSettingsSystemAdminOnly(branchId, connection = pool) {
  try {
    const id = Number(branchId);
    if (!Number.isInteger(id) || id <= 0) return false;

    const [rows] = await connection.query(
      `SELECT user_settings_system_admin_only
         FROM settings
        WHERE branch_id = ?
        ORDER BY id DESC
        LIMIT 1`,
      [id]
    );

    return Boolean(Number(rows[0]?.user_settings_system_admin_only || 0));
  } catch (error) {
    // Fail open only when the additive setting is unavailable. The migration is
    // run before production startup, so this protects older test/local databases
    // without changing existing admin access there.
    if (error?.code === "ER_BAD_FIELD_ERROR" || error?.code === "ER_NO_SUCH_TABLE") {
      return false;
    }
    throw error;
  }
}

async function canAccessSparePartsUserSettings(user, connection = pool) {
  if (!isSparePartsWorkspace(user)) return true;
  if (isOriginalSystemAdministrator(user)) return true;

  const restricted = await getUserSettingsSystemAdminOnly(
    branchIdForUser(user),
    connection
  );
  return !restricted;
}

module.exports = {
  SPARE_PARTS,
  branchIdForUser,
  canAccessSparePartsUserSettings,
  getUserSettingsSystemAdminOnly,
  isOriginalSystemAdministrator,
  isSparePartsWorkspace,
};
