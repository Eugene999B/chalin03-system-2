const { pool } = require("../config/db");

function passwordChangeError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function boolValue(value) {
  return value === true || Number(value || 0) === 1;
}

async function changePasswordAtomically({
  userId,
  expectedPasswordHash,
  newPasswordHash,
  userColumns,
  poolRef = pool,
}) {
  const connection = await poolRef.getConnection();

  try {
    await connection.beginTransaction();

    const [users] = await connection.query(
      `SELECT id, password_hash, is_active
       FROM users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [userId]
    );

    if (users.length === 0) {
      throw passwordChangeError(
        "User account not found.",
        404,
        "PASSWORD_CHANGE_USER_NOT_FOUND"
      );
    }

    const lockedUser = users[0];

    if (!boolValue(lockedUser.is_active)) {
      throw passwordChangeError(
        "This account has been disabled.",
        403,
        "PASSWORD_CHANGE_ACCOUNT_DISABLED"
      );
    }

    if (lockedUser.password_hash !== expectedPasswordHash) {
      throw passwordChangeError(
        "The account password changed while this request was being processed. Login again and retry.",
        409,
        "PASSWORD_CHANGED_DURING_REQUEST"
      );
    }

    const updateFields = ["password_hash = ?"];
    const updateParams = [newPasswordHash];

    if (userColumns.has("must_change_password")) {
      updateFields.push("must_change_password = FALSE");
    }

    if (userColumns.has("password_changed_at")) {
      updateFields.push("password_changed_at = CURRENT_TIMESTAMP");
    }

    if (userColumns.has("token_version")) {
      updateFields.push("token_version = token_version + 1");
    }

    const [passwordResult] = await connection.query(
      `UPDATE users
       SET ${updateFields.join(",\n           ")}
       WHERE id = ?
         AND password_hash = ?`,
      [...updateParams, userId, expectedPasswordHash]
    );

    if (Number(passwordResult.affectedRows || 0) !== 1) {
      throw passwordChangeError(
        "The account password changed while this request was being processed. Login again and retry.",
        409,
        "PASSWORD_CHANGED_DURING_REQUEST"
      );
    }

    const [sessionResult] = await connection.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()),
           revocation_reason = COALESCE(revocation_reason, 'password_changed')
       WHERE user_id = ?
         AND revoked_at IS NULL`,
      [userId]
    );

    await connection.commit();

    return {
      userId,
      revokedSessionCount: Number(sessionResult.affectedRows || 0),
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original password-change failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  changePasswordAtomically,
  passwordChangeError,
};
