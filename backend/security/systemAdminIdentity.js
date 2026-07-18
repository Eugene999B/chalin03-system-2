const SYSTEM_ADMIN_ID = Number(process.env.SYSTEM_ADMIN_USER_ID || 1);
const SYSTEM_ADMIN_USERNAME = String(
  process.env.SYSTEM_ADMIN_USERNAME || "admin"
)
  .trim()
  .toLowerCase();

function isOriginalSystemAdministrator(user = {}) {
  return (
    Number(user.id) === SYSTEM_ADMIN_ID &&
    String(user.username || "").trim().toLowerCase() ===
      SYSTEM_ADMIN_USERNAME &&
    String(user.role || "").trim().toLowerCase() === "admin"
  );
}

module.exports = {
  SYSTEM_ADMIN_ID,
  SYSTEM_ADMIN_USERNAME,
  isOriginalSystemAdministrator,
};
