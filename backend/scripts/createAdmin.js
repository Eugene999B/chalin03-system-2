const bcrypt = require("bcryptjs");
require("dotenv").config();

const { pool } = require("../config/db");

async function createOrUpdateAdmin() {
  try {
    const fullName = process.env.ADMIN_FULL_NAME || "System Administrator";
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD;
    const phone = process.env.ADMIN_PHONE || null;

    if (!password) {
      console.error("❌ ADMIN_PASSWORD is missing in your .env file.");
      process.exit(1);
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const [existingUsers] = await pool.query(
      `SELECT id FROM users WHERE username = ? LIMIT 1`,
      [username]
    );

    if (existingUsers.length > 0) {
      await pool.query(
        `UPDATE users
         SET full_name = ?, password_hash = ?, role = 'admin', phone = ?, is_active = TRUE
         WHERE username = ?`,
        [fullName, passwordHash, phone, username]
      );

      console.log(`✅ Admin user "${username}" updated successfully.`);
    } else {
      await pool.query(
        `INSERT INTO users (full_name, username, password_hash, role, phone, is_active)
         VALUES (?, ?, ?, 'admin', ?, TRUE)`,
        [fullName, username, passwordHash, phone]
      );

      console.log(`✅ Admin user "${username}" created successfully.`);
    }

    console.log("✅ You can now login with:");
    console.log(`Username: ${username}`);
    console.log("Password: the ADMIN_PASSWORD you set in .env");

    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to create/update admin user.");
    console.error(error.message);
    process.exit(1);
  }
}

createOrUpdateAdmin();