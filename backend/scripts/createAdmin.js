const bcrypt = require("bcryptjs");
require("dotenv").config();

const { pool } = require("../config/db");

function isProduction() {
  return String(process.env.NODE_ENV || "")
    .trim()
    .toLowerCase() === "production";
}

async function createOrUpdateAdmin() {
  try {
    if (isProduction()) {
      console.error(
        "❌ Refusing to create or reset an administrator while NODE_ENV=production. Use the protected account-recovery workflow instead."
      );
      process.exit(1);
    }

    const fullName = process.env.ADMIN_FULL_NAME || "System Administrator";
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = String(process.env.ADMIN_PASSWORD || "");
    const phone = process.env.ADMIN_PHONE || null;

    if (password.length < 16) {
      console.error(
        "❌ ADMIN_PASSWORD must be supplied through the environment and contain at least 16 characters."
      );
      process.exit(1);
    }

    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const [existingUsers] = await pool.query(
      `SELECT id FROM users WHERE username = ? LIMIT 1`,
      [username]
    );

    if (existingUsers.length > 0) {
      await pool.query(
        `UPDATE users
         SET full_name = ?, password_hash = ?, role = 'admin', phone = ?, is_active = TRUE,
             token_version = COALESCE(token_version, 0) + 1
         WHERE username = ?`,
        [fullName, passwordHash, phone, username]
      );

      await pool.query(
        `UPDATE auth_sessions
         SET revoked_at = COALESCE(revoked_at, NOW()),
             revocation_reason = COALESCE(revocation_reason, 'manual_admin_credential_rotation')
         WHERE user_id = ?
           AND revoked_at IS NULL`,
        [existingUsers[0].id]
      );

      console.log(
        "✅ Administrator credentials updated and existing sessions revoked."
      );
    } else {
      await pool.query(
        `INSERT INTO users (full_name, username, password_hash, role, phone, is_active)
         VALUES (?, ?, ?, 'admin', ?, TRUE)`,
        [fullName, username, passwordHash, phone]
      );

      console.log("✅ Administrator account created successfully.");
    }

    console.log("✅ Environment-supplied credentials were not printed.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to create/update administrator.");
    console.error(error.message);
    process.exit(1);
  }
}

createOrUpdateAdmin();
