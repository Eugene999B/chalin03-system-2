const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");

async function main() {
  console.log("🔐 Resetting Chalin 03 admin password...");

  const username = "admin";
  const password = "admin123";
  const passwordHash = await bcrypt.hash(password, 10);

  const [existingUsers] = await pool.query(
    `
    SELECT id, username
    FROM users
    WHERE username = ?
    LIMIT 1
    `,
    [username]
  );

  let adminId;

  if (existingUsers.length === 0) {
    const [result] = await pool.query(
      `
      INSERT INTO users (
        full_name,
        username,
        password_hash,
        role,
        phone,
        default_branch_id,
        can_access_all_branches,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "System Administrator",
        username,
        passwordHash,
        "admin",
        null,
        1,
        true,
        true,
      ]
    );

    adminId = result.insertId;
    console.log("✅ Admin user created.");
  } else {
    adminId = existingUsers[0].id;

    await pool.query(
      `
      UPDATE users
      SET
        full_name = 'System Administrator',
        password_hash = ?,
        role = 'admin',
        default_branch_id = 1,
        can_access_all_branches = TRUE,
        is_active = TRUE
      WHERE id = ?
      `,
      [passwordHash, adminId]
    );

    console.log("✅ Admin password reset.");
  }

  await pool.query(
    `
    INSERT INTO user_branch_access (
      user_id,
      branch_id,
      access_role,
      is_primary
    )
    VALUES (?, 1, 'admin', TRUE)
    ON DUPLICATE KEY UPDATE
      access_role = VALUES(access_role),
      is_primary = VALUES(is_primary)
    `,
    [adminId]
  );

  await pool.query(
    `
    INSERT INTO user_branch_access (
      user_id,
      branch_id,
      access_role,
      is_primary
    )
    VALUES (?, 2, 'admin', FALSE)
    ON DUPLICATE KEY UPDATE
      access_role = VALUES(access_role),
      is_primary = VALUES(is_primary)
    `,
    [adminId]
  );

  const [rows] = await pool.query(
    `
    SELECT
      id,
      full_name,
      username,
      role,
      default_branch_id,
      can_access_all_branches,
      is_active
    FROM users
    WHERE id = ?
    `,
    [adminId]
  );

  console.table(rows);

  console.log("");
  console.log("✅ Done.");
  console.log("Login with:");
  console.log("Username: admin");
  console.log("Password: admin123");
}

main()
  .catch((error) => {
    console.error("❌ Failed to reset admin password:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });