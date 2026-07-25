const bcrypt = require("bcryptjs");

function cleanText(value, maxLength = 180) {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function verifyIndependentBranchApprover(
  connection,
  {
    currentUserId,
    branchId,
    approverUsername,
    approverPassword,
    allowedRoles = ["admin", "manager"],
  }
) {
  const username = cleanText(approverUsername, 80);
  const password = String(approverPassword || "");

  if (!username || !password) {
    return {
      error:
        "Independent approver username and password are required for this protected action.",
    };
  }

  const [rows] = await connection.query(
    `SELECT id, full_name, username, role, password_hash, is_active,
            default_branch_id, can_access_all_branches
     FROM users
     WHERE username = ?
     LIMIT 1
     FOR UPDATE`,
    [username]
  );

  const approver = rows[0];
  if (!approver || Number(approver.is_active || 0) !== 1) {
    return { error: "Independent approver account was not found or is inactive." };
  }

  const role = String(approver.role || "").trim().toLowerCase();
  if (!allowedRoles.includes(role)) {
    return {
      error: `Independent approver must be an active ${allowedRoles.join(" or ")}.`,
    };
  }

  if (Number(approver.id) === Number(currentUserId)) {
    return {
      error: "The person requesting this protected action cannot approve it.",
    };
  }

  if (
    Number(approver.can_access_all_branches || 0) !== 1 &&
    Number(approver.default_branch_id || 0) !== Number(branchId)
  ) {
    const [accessRows] = await connection.query(
      `SELECT 1
       FROM user_branch_access
       WHERE user_id = ?
         AND branch_id = ?
         AND can_access = TRUE
       LIMIT 1`,
      [approver.id, branchId]
    );

    if (accessRows.length === 0) {
      return {
        error: "Independent approver is not authorised for the selected store.",
      };
    }
  }

  const passwordMatches = await bcrypt.compare(password, approver.password_hash);
  if (!passwordMatches) {
    return { error: "Independent approver password is incorrect." };
  }

  return {
    approver: {
      id: Number(approver.id),
      full_name: approver.full_name,
      username: approver.username,
      role,
    },
  };
}

module.exports = {
  verifyIndependentBranchApprover,
};
