const bcrypt = require("bcryptjs");
require("dotenv").config();

const { pool } = require("../config/db");
const {
  normalizedPhoneForStorage,
} = require("../services/loginIdentityService");
const {
  grantDelegatedAuthority,
} = require("../services/delegatedAdministrationService");
const {
  SYSTEM_ADMIN_ID,
} = require("../security/systemAdminIdentity");

function clean(value) {
  return String(value || "").trim();
}

function enabled(value) {
  return ["1", "true", "yes"].includes(clean(value).toLowerCase());
}

async function activeBranchIds(connection) {
  const [columns] = await connection.query("SHOW COLUMNS FROM branches");
  const names = new Set(columns.map((column) => column.Field));
  const activeColumn = names.has("is_active")
    ? "is_active"
    : names.has("active")
      ? "active"
      : null;
  const where = activeColumn ? `WHERE \`${activeColumn}\` = TRUE` : "";
  const [rows] = await connection.query(
    `SELECT id FROM branches ${where} ORDER BY id ASC`
  );
  return rows.map((row) => Number(row.id)).filter((id) => id > 0);
}

async function bootstrap() {
  if (!enabled(process.env.REQUESTED_SYSTEM_ADMIN_BOOTSTRAP_ENABLED)) {
    console.log("Requested System Administrator bootstrap is disabled.");
    return;
  }

  const fullName = clean(process.env.REQUESTED_SYSTEM_ADMIN_FULL_NAME);
  const username = clean(process.env.REQUESTED_SYSTEM_ADMIN_USERNAME);
  const phone = clean(process.env.REQUESTED_SYSTEM_ADMIN_PHONE);
  const temporaryPassword = String(
    process.env.REQUESTED_SYSTEM_ADMIN_TEMP_PASSWORD || ""
  );
  const normalizedPhone = normalizedPhoneForStorage(phone);

  if (!fullName || !username || !phone || !temporaryPassword) {
    throw new Error(
      "Requested System Administrator bootstrap variables are incomplete."
    );
  }

  if (!normalizedPhone) {
    throw new Error("Requested System Administrator phone is not a valid Ghana phone.");
  }

  if (temporaryPassword.length < 8) {
    throw new Error(
      "Requested System Administrator temporary password must be at least 8 characters."
    );
  }

  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const [phoneOwners] = await connection.query(
      `SELECT id, username, role
       FROM users
       WHERE login_phone_normalized = ?
       FOR UPDATE`,
      [normalizedPhone]
    );

    for (const owner of phoneOwners) {
      const sameRequestedAccount =
        clean(owner.username).toLowerCase() === username.toLowerCase();

      if (sameRequestedAccount) continue;

      if (Number(owner.id) === Number(SYSTEM_ADMIN_ID)) {
        // The user explicitly requested this phone for the new delegated
        // administrator. Keep the original owner login distinct by clearing
        // only the original owner's login-phone identity. Username/password
        // login remains available, and Settings now provides a dedicated field
        // for the owner to add the correct separate login phone.
        await connection.query(
          `UPDATE users
           SET phone = NULL,
               login_phone_normalized = NULL
           WHERE id = ?`,
          [SYSTEM_ADMIN_ID]
        );
        continue;
      }

      throw new Error(
        `Phone ${phone} already belongs to another login account (${owner.username}).`
      );
    }

    const [existingRows] = await connection.query(
      `SELECT id
       FROM users
       WHERE LOWER(username) = LOWER(?)
       LIMIT 1
       FOR UPDATE`,
      [username]
    );

    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const branches = await activeBranchIds(connection);
    const defaultBranchId = branches[0] || 1;
    let userId;

    if (existingRows.length > 0) {
      userId = Number(existingRows[0].id);
      if (userId === Number(SYSTEM_ADMIN_ID)) {
        throw new Error(
          "The requested username resolves to the protected original System Administrator account."
        );
      }

      await connection.query(
        `UPDATE users
         SET full_name = ?,
             username = ?,
             password_hash = ?,
             role = 'admin',
             default_branch_id = ?,
             can_access_all_branches = TRUE,
             phone = ?,
             login_phone_normalized = ?,
             is_active = TRUE,
             must_change_password = TRUE,
             password_changed_at = NULL,
             failed_login_attempts = 0,
             locked_until = NULL,
             is_login_locked = FALSE,
             login_locked_at = NULL,
             login_lock_reason = NULL,
             token_version = COALESCE(token_version, 0) + 1,
             primary_workspace_code = '*',
             category_assignment_status = 'system_admin',
             category_conflict_reason = NULL,
             category_assignment_reviewed_at = NOW(),
             category_assignment_reviewed_by = ?
         WHERE id = ?`,
        [
          fullName,
          username,
          passwordHash,
          defaultBranchId,
          phone,
          normalizedPhone,
          SYSTEM_ADMIN_ID,
          userId,
        ]
      );
    } else {
      const [insertResult] = await connection.query(
        `INSERT INTO users (
           full_name,
           username,
           password_hash,
           role,
           default_branch_id,
           can_access_all_branches,
           phone,
           login_phone_normalized,
           is_active,
           must_change_password,
           password_changed_at,
           failed_login_attempts,
           locked_until,
           is_login_locked,
           token_version,
           primary_workspace_code,
           category_assignment_status,
           category_conflict_reason,
           category_assignment_reviewed_at,
           category_assignment_reviewed_by
         ) VALUES (
           ?, ?, ?, 'admin', ?, TRUE, ?, ?, TRUE, TRUE, NULL,
           0, NULL, FALSE, 0, '*', 'system_admin', NULL, NOW(), ?
         )`,
        [
          fullName,
          username,
          passwordHash,
          defaultBranchId,
          phone,
          normalizedPhone,
          SYSTEM_ADMIN_ID,
        ]
      );
      userId = Number(insertResult.insertId);
    }

    await connection.query(
      "DELETE FROM user_branch_access WHERE user_id = ?",
      [userId]
    );

    for (const branchId of branches.length ? branches : [defaultBranchId]) {
      await connection.query(
        `INSERT INTO user_branch_access (
           user_id,
           branch_id,
           can_access
         ) VALUES (?, ?, TRUE)
         ON DUPLICATE KEY UPDATE
           can_access = TRUE,
           updated_at = CURRENT_TIMESTAMP`,
        [userId, branchId]
      );
    }

    const targetUser = {
      id: userId,
      full_name: fullName,
      username,
      role: "admin",
      phone,
      primary_workspace_code: "*",
      category_assignment_status: "system_admin",
    };

    await grantDelegatedAuthority({
      connection,
      targetUser,
      actorUserId: SYSTEM_ADMIN_ID,
      capabilities: {
        enabled: true,
        manage_users: true,
        manage_permissions: true,
        manage_administrators: true,
        backup_download: true,
        backup_validate: true,
        backup_restore: true,
        audit_view: true,
        system_operations: true,
      },
      reason:
        "Owner-approved full Delegated System Administrator authority for all Chalin03 businesses.",
      expiresAt: null,
    });

    await connection.query(
      `INSERT INTO activity_log (
         branch_id,
         user_id,
         action,
         details
       ) VALUES (?, ?, ?, ?)`,
      [
        defaultBranchId,
        SYSTEM_ADMIN_ID,
        "CREATE_OR_UPDATE_DELEGATED_SYSTEM_ADMINISTRATOR",
        `Provisioned delegated System Administrator "${username}" with all-business and all-store operational authority. Temporary password is never stored in audit text.`,
      ]
    );

    await connection.commit();
    transactionStarted = false;

    console.log(
      `Requested System Administrator bootstrap completed for user ID ${userId} (${username}).`
    );
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }
}

bootstrap()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error(
      "Requested System Administrator bootstrap failed:",
      error.message
    );
    try {
      await pool.end();
    } catch {}
    process.exit(1);
  });
