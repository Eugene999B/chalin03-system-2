const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { createSession } = require("../services/accountSessionService");
const { writeAuditEvent } = require("../services/auditTrailService");
const { resolveEffectivePermissions } = require("../services/permissionOverrideService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { ensurePasskeySchema } = require("../services/passkeySchemaService");
const authRoutes = require("./authRoutes");

const router = express.Router();
const auth = authRoutes.commandGateAuth;

const RP_NAME = "Chalin 03 Company Limited";
const DEFAULT_WORKSPACE_CODE = "spare_parts";
const PASSKEY_CHALLENGE_MINUTES = 5;

let simpleWebAuthnPromise = null;

function getSimpleWebAuthn() {
  if (!simpleWebAuthnPromise) {
    simpleWebAuthnPromise = import("@simplewebauthn/server");
  }

  return simpleWebAuthnPromise;
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function boolValue(value) {
  return value === true || Number(value || 0) === 1;
}

function parseTransports(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item, 32)).filter(Boolean);
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => cleanText(item, 32)).filter(Boolean)
      : [];
  } catch {
    return String(value)
      .split(",")
      .map((item) => cleanText(item, 32))
      .filter(Boolean);
  }
}

function requestIp(req) {
  return String(
    req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || ""
  )
    .split(",")[0]
    .trim()
    .slice(0, 50);
}

function normalizeOrigin(value) {
  return cleanText(value, 300).replace(/\/+$/, "");
}

function getRelyingPartyConfig() {
  const production = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const rpID =
    cleanText(process.env.PASSKEY_RP_ID, 255) ||
    (production ? "chalin03.com" : "localhost");

  const origins = [
    process.env.PASSKEY_ORIGIN,
    process.env.FRONTEND_URL,
    process.env.FRONTEND_URL_ALT,
    production ? "https://chalin03.com" : "http://localhost:5173",
    production ? "https://www.chalin03.com" : "http://localhost:3000",
  ]
    .map(normalizeOrigin)
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);

  return {
    rpID,
    origins,
  };
}

async function cleanupChallenges() {
  await pool.query(
    `DELETE FROM passkey_challenges
     WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY)
        OR used_at < DATE_SUB(NOW(), INTERVAL 1 DAY)`
  );
}

async function createChallenge({ purpose, userId = null, challenge, context = {} }) {
  await ensurePasskeySchema();
  await cleanupChallenges();

  const id = crypto.randomUUID();

  await pool.query(
    `INSERT INTO passkey_challenges
      (id, purpose, user_id, challenge, context_json, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [
      id,
      purpose,
      userId,
      challenge,
      JSON.stringify(context || {}),
      PASSKEY_CHALLENGE_MINUTES,
    ]
  );

  return id;
}

async function consumeChallenge({ id, purpose }) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT id, purpose, user_id, challenge, context_json, expires_at, used_at
       FROM passkey_challenges
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [id]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return null;
    }

    const row = rows[0];
    const expired = new Date(row.expires_at).getTime() <= Date.now();

    if (row.purpose !== purpose || row.used_at || expired) {
      await connection.rollback();
      return null;
    }

    await connection.query(
      `UPDATE passkey_challenges
       SET used_at = NOW()
       WHERE id = ?`,
      [id]
    );

    await connection.commit();

    let context = {};

    try {
      context = row.context_json ? JSON.parse(row.context_json) : {};
    } catch {
      context = {};
    }

    return {
      ...row,
      context,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function loadUserById(userId) {
  const users = await auth.buildUserSelectByWhere("WHERE id = ?", [userId]);
  return users.length > 0 ? users[0] : null;
}

async function listActivePasskeys(userId) {
  await ensurePasskeySchema();

  const [rows] = await pool.query(
    `SELECT
       id,
       user_id,
       webauthn_user_id,
       credential_id,
       public_key,
       counter,
       device_type,
       backed_up,
       transports,
       display_name,
       created_at,
       last_used_at
     FROM user_passkeys
     WHERE user_id = ?
       AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [userId]
  );

  return rows;
}

async function loadCredentialById(credentialId) {
  await ensurePasskeySchema();

  const [rows] = await pool.query(
    `SELECT
       id,
       user_id,
       webauthn_user_id,
       credential_id,
       public_key,
       counter,
       device_type,
       backed_up,
       transports,
       display_name,
       created_at,
       last_used_at
     FROM user_passkeys
     WHERE credential_id = ?
       AND revoked_at IS NULL
     LIMIT 1`,
    [credentialId]
  );

  return rows.length > 0 ? rows[0] : null;
}

async function getBusinessUnitByCode(workspaceCode) {
  const normalizedCode = auth.normalizeWorkspaceCode(workspaceCode);

  if (!normalizedCode) {
    return null;
  }

  const [tables] = await pool.query(
    `SELECT COUNT(*) AS table_count
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = 'business_units'`
  );

  if (!Number(tables[0]?.table_count || 0)) {
    return normalizedCode === DEFAULT_WORKSPACE_CODE
      ? {
          id: null,
          code: DEFAULT_WORKSPACE_CODE,
          name: "Spare Parts",
          is_enabled: true,
        }
      : null;
  }

  const [rows] = await pool.query(
    `SELECT id, code, name, description, is_enabled
     FROM business_units
     WHERE code = ?
     LIMIT 1`,
    [normalizedCode]
  );

  return rows.length > 0 && boolValue(rows[0].is_enabled) ? rows[0] : null;
}

async function buildPasskeyUserResponse(user, branch, workspace) {
  const isSpareParts = workspace?.code === DEFAULT_WORKSPACE_CODE;
  const activeBranch = isSpareParts ? branch : null;
  const workspaceRole =
    user.workspace_role ||
    user.access_role ||
    (isSpareParts ? user.role : null);
  const branchCode =
    activeBranch?.branch_code || activeBranch?.code || null;
  const branchName =
    activeBranch?.name || activeBranch?.branch_name || null;
  const branchLocation =
    activeBranch?.location || activeBranch?.branch_location || null;

  return {
    id: user.id,
    full_name: user.full_name,
    username: user.username,
    role: user.role,
    workspace_role: workspaceRole,
    phone: user.phone,
    login_method: "passkey",
    primary_workspace_code: user.primary_workspace_code || null,
    category_assignment_status: user.category_assignment_status || null,
    category_conflict_reason: user.category_conflict_reason || null,
    is_original_system_administrator: isOriginalSystemAdministrator(user),
    workspace_code: workspace?.code || DEFAULT_WORKSPACE_CODE,
    business_unit_id: workspace?.id || null,
    business_unit_name: workspace?.name || "Spare Parts",
    active_workspace: {
      id: workspace?.id || null,
      code: workspace?.code || DEFAULT_WORKSPACE_CODE,
      name: workspace?.name || "Spare Parts",
    },
    default_branch_id: isSpareParts ? user.default_branch_id : null,
    can_access_all_branches: isSpareParts
      ? boolValue(user.can_access_all_branches)
      : false,
    must_change_password: boolValue(user.must_change_password),
    password_changed_at: user.password_changed_at || null,
    branch_id: activeBranch?.id || null,
    branch_code: branchCode,
    branch_name: branchName,
    branch_location: branchLocation,
    branch_phone: activeBranch?.phone || null,
    effective_permissions: await resolveEffectivePermissions({
      ...user,
      workspace_code: workspace?.code || DEFAULT_WORKSPACE_CODE,
      workspace_role: workspaceRole,
    }),
    selected_branch: activeBranch
      ? {
          id: activeBranch.id,
          branch_id: activeBranch.id,
          code: branchCode,
          branch_code: branchCode,
          name: branchName,
          branch_name: branchName,
          location: branchLocation,
          branch_location: branchLocation,
          phone: activeBranch.phone,
          is_head_office: boolValue(activeBranch.is_head_office),
        }
      : null,
  };
}

async function registerSuccessfulPasskeyLogin({
  req,
  user,
  workspace,
  selectedBranch,
  credential,
}) {
  user.login_method = "passkey";

  const session = await createSession({
    userId: user.id,
    req,
    workspaceCode: workspace.code,
    branchId: selectedBranch?.id || null,
    loginMethod: "passkey",
    deviceEvidence: req.body.device_evidence || {},
  });

  const token = auth.createToken(
    user,
    selectedBranch,
    workspace,
    session.sessionId
  );

  const loginContext = selectedBranch
    ? `${workspace.name} — ${selectedBranch.name}`
    : workspace.name;

  await writeAuditEvent({
    req,
    userId: user.id,
    branchId: selectedBranch?.id || null,
    action:
      session.replacedSessionCount > 0
        ? "PASSKEY_LOGIN_SESSION_REPLACED"
        : "PASSKEY_LOGIN",
    actionType: "auth.passkey.login",
    outcome: "success",
    severity: "info",
    entityType: "user",
    entityId: user.id,
    details:
      session.replacedSessionCount > 0
        ? `${user.username} unlocked ${loginContext} with a passkey and replaced the previous device session.`
        : `${user.username} unlocked ${loginContext} with a passkey.`,
    metadata: {
      credential_id_suffix: String(credential.credential_id || "").slice(-12),
      ip: requestIp(req),
    },
  });

  await auth.recordSuccessfulLogin(req, user);

  return {
    token,
    session,
    user: await buildPasskeyUserResponse(user, selectedBranch, workspace),
  };
}

router.get("/capabilities", async (req, res) => {
  try {
    await ensurePasskeySchema();

    const [rows] = await pool.query(
      `SELECT COUNT(*) AS credential_count
       FROM user_passkeys
       WHERE revoked_at IS NULL`
    );

    const { rpID } = getRelyingPartyConfig();

    return res.json({
      status: "success",
      enabled: true,
      rp_id: rpID,
      registered_credentials: Number(rows[0]?.credential_count || 0),
      user_verification: "required",
    });
  } catch (error) {
    console.error("Passkey capabilities error:", error);
    return res.status(503).json({
      status: "error",
      enabled: false,
      message: "Device unlock is temporarily unavailable.",
    });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const passkeys = await listActivePasskeys(req.user.id);

    return res.json({
      status: "success",
      passkeys: passkeys.map((passkey) => ({
        id: passkey.id,
        display_name: passkey.display_name,
        device_type: passkey.device_type,
        backed_up: boolValue(passkey.backed_up),
        transports: parseTransports(passkey.transports),
        created_at: passkey.created_at,
        last_used_at: passkey.last_used_at,
      })),
    });
  } catch (error) {
    console.error("List passkeys error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not load trusted devices.",
    });
  }
});

router.post("/registration/options", requireAuth, async (req, res) => {
  try {
    await ensurePasskeySchema();

    const currentPassword = String(req.body.current_password || "");
    const displayName =
      cleanText(req.body.display_name, 120) || "Trusted device";

    if (!currentPassword) {
      return res.status(400).json({
        status: "error",
        message: "Enter your current password to register this device.",
      });
    }

    const user = await loadUserById(req.user.id);

    if (!user || !boolValue(user.is_active)) {
      return res.status(403).json({
        status: "error",
        message: "This account is not available.",
      });
    }

    const passwordMatches = await bcrypt.compare(
      currentPassword,
      user.password_hash
    );

    if (!passwordMatches) {
      await writeAuditEvent({
        req,
        userId: user.id,
        branchId: req.user.branch_id || null,
        action: "PASSKEY_REGISTRATION_PASSWORD_FAILED",
        actionType: "auth.passkey.registration_failed",
        outcome: "blocked",
        severity: "warning",
        entityType: "user",
        entityId: user.id,
        details: "Passkey registration was blocked because the current password was incorrect.",
      });

      return res.status(401).json({
        status: "error",
        message: "Current password is incorrect.",
      });
    }

    const passkeys = await listActivePasskeys(user.id);
    const webauthnUserID =
      passkeys[0]?.webauthn_user_id ||
      crypto.randomBytes(32).toString("base64url");

    const { generateRegistrationOptions } = await getSimpleWebAuthn();
    const { rpID } = getRelyingPartyConfig();

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userID: Buffer.from(webauthnUserID, "base64url"),
      userName: user.username,
      userDisplayName: user.full_name || user.username,
      attestationType: "none",
      excludeCredentials: passkeys.map((passkey) => ({
        id: passkey.credential_id,
        transports: parseTransports(passkey.transports),
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      preferredAuthenticatorType: "localDevice",
      supportedAlgorithmIDs: [-7, -257],
    });

    const challengeId = await createChallenge({
      purpose: "registration",
      userId: user.id,
      challenge: options.challenge,
      context: {
        display_name: displayName,
        webauthn_user_id: webauthnUserID,
      },
    });

    return res.json({
      status: "success",
      challenge_id: challengeId,
      options,
    });
  } catch (error) {
    console.error("Passkey registration options error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not prepare device registration.",
    });
  }
});

router.post("/registration/verify", requireAuth, async (req, res) => {
  try {
    const challengeId = cleanText(req.body.challenge_id, 80);
    const response = req.body.response;

    if (!challengeId || !response?.id) {
      return res.status(400).json({
        status: "error",
        message: "Device registration response is incomplete.",
      });
    }

    const challenge = await consumeChallenge({
      id: challengeId,
      purpose: "registration",
    });

    if (!challenge || Number(challenge.user_id) !== Number(req.user.id)) {
      return res.status(400).json({
        status: "error",
        message: "The device registration request expired. Start again.",
      });
    }

    const { verifyRegistrationResponse } = await getSimpleWebAuthn();
    const { rpID, origins } = getRelyingPartyConfig();

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({
        status: "error",
        message: "The device could not be verified.",
      });
    }

    const {
      credential,
      credentialDeviceType,
      credentialBackedUp,
    } = verification.registrationInfo;

    const transports =
      credential.transports || response.response?.transports || [];

    await pool.query(
      `INSERT INTO user_passkeys
        (user_id, webauthn_user_id, credential_id, public_key, counter,
         device_type, backed_up, transports, display_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        cleanText(challenge.context.webauthn_user_id, 128),
        credential.id,
        Buffer.from(credential.publicKey),
        Number(credential.counter || 0),
        cleanText(credentialDeviceType, 32) || null,
        credentialBackedUp ? 1 : 0,
        JSON.stringify(transports),
        cleanText(challenge.context.display_name, 120) || "Trusted device",
      ]
    );

    await writeAuditEvent({
      req,
      userId: req.user.id,
      branchId: req.user.branch_id || null,
      action: "PASSKEY_REGISTERED",
      actionType: "auth.passkey.registered",
      outcome: "success",
      severity: "info",
      entityType: "user",
      entityId: req.user.id,
      details: `A new trusted device was registered as ${
        cleanText(challenge.context.display_name, 120) || "Trusted device"
      }.`,
    });

    return res.status(201).json({
      status: "success",
      verified: true,
      message: "This device can now unlock Chalin 03.",
    });
  } catch (error) {
    console.error("Passkey registration verification error:", error);

    const duplicate =
      error?.code === "ER_DUP_ENTRY" ||
      String(error?.message || "").toLowerCase().includes("duplicate");

    return res.status(duplicate ? 409 : 400).json({
      status: "error",
      message: duplicate
        ? "This passkey is already registered."
        : "The device registration could not be verified.",
    });
  }
});

router.post("/authentication/options", async (req, res) => {
  try {
    await ensurePasskeySchema();

    const workspaceCode = auth.normalizeWorkspaceCode(req.body.workspace_code);
    const branchId = cleanNumber(req.body.branch_id);

    if (!workspaceCode) {
      return res.status(400).json({
        status: "error",
        message: "Choose a valid business workspace.",
      });
    }

    if (workspaceCode === DEFAULT_WORKSPACE_CODE && !branchId) {
      return res.status(400).json({
        status: "error",
        message: "Choose a Spare Parts store before using device unlock.",
      });
    }

    if (workspaceCode !== DEFAULT_WORKSPACE_CODE && branchId) {
      return res.status(400).json({
        status: "error",
        message: "Spare Parts stores cannot be used for this workspace.",
      });
    }

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS credential_count
       FROM user_passkeys
       WHERE revoked_at IS NULL`
    );

    if (!Number(countRows[0]?.credential_count || 0)) {
      return res.status(404).json({
        status: "error",
        code: "NO_PASSKEYS_REGISTERED",
        message:
          "No trusted device has been registered yet. Use password login first.",
      });
    }

    const { generateAuthenticationOptions } = await getSimpleWebAuthn();
    const { rpID } = getRelyingPartyConfig();

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
    });

    const challengeId = await createChallenge({
      purpose: "authentication",
      challenge: options.challenge,
      context: {
        workspace_code: workspaceCode,
        branch_id: workspaceCode === DEFAULT_WORKSPACE_CODE ? branchId : null,
      },
    });

    return res.json({
      status: "success",
      challenge_id: challengeId,
      options,
    });
  } catch (error) {
    console.error("Passkey authentication options error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not prepare device unlock.",
    });
  }
});

router.post("/authentication/verify", async (req, res) => {
  try {
    const challengeId = cleanText(req.body.challenge_id, 80);
    const response = req.body.response;

    if (!challengeId || !response?.id) {
      return res.status(400).json({
        status: "error",
        message: "Device unlock response is incomplete.",
      });
    }

    const challenge = await consumeChallenge({
      id: challengeId,
      purpose: "authentication",
    });

    if (!challenge) {
      return res.status(400).json({
        status: "error",
        message: "The device unlock request expired. Try again.",
      });
    }

    const credential = await loadCredentialById(response.id);

    if (!credential) {
      return res.status(401).json({
        status: "error",
        message: "This trusted device is not registered or has been revoked.",
      });
    }

    const user = await loadUserById(credential.user_id);

    if (!user || !boolValue(user.is_active)) {
      return res.status(403).json({
        status: "error",
        message: "This account is not available.",
      });
    }

    if (auth.isLoginLocked(user)) {
      return res.status(423).json({
        status: "error",
        code: "ACCOUNT_LOCKED",
        message:
          "This account is blocked. Use account recovery or contact the System Administrator.",
      });
    }

    const { verifyAuthenticationResponse } = await getSimpleWebAuthn();
    const { rpID, origins } = getRelyingPartyConfig();

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: credential.credential_id,
        publicKey: new Uint8Array(credential.public_key),
        counter: Number(credential.counter || 0),
        transports: parseTransports(credential.transports),
      },
    });

    if (!verification.verified) {
      return res.status(401).json({
        status: "error",
        message: "Device verification failed.",
      });
    }

    const workspaceResult = await auth.resolveLoginWorkspace(
      user,
      challenge.context.workspace_code
    );

    if (!workspaceResult.ok) {
      return res.status(workspaceResult.statusCode).json({
        status: "error",
        code: workspaceResult.code || "CATEGORY_ACCESS_DENIED",
        message: workspaceResult.message,
      });
    }

    const workspace = workspaceResult.workspace;
    user.workspace_role = workspaceResult.workspaceRole;

    const categoryState = await auth.loadUserCategoryState(user);
    user.primary_workspace_code = categoryState.primary_workspace_code;
    user.category_assignment_status = categoryState.category_assignment_status;
    user.category_conflict_reason = categoryState.conflict_reason;

    let selectedBranch = null;

    if (workspace.code === DEFAULT_WORKSPACE_CODE) {
      const branchResult = await auth.resolveLoginBranch(
        user,
        challenge.context.branch_id
      );

      if (!branchResult.ok) {
        return res.status(branchResult.statusCode).json({
          status: "error",
          message: branchResult.message,
        });
      }

      selectedBranch = branchResult.branch;
    }

    await pool.query(
      `UPDATE user_passkeys
       SET counter = ?,
           last_used_at = NOW()
       WHERE id = ?`,
      [
        Number(verification.authenticationInfo?.newCounter || 0),
        credential.id,
      ]
    );

    const loginResult = await registerSuccessfulPasskeyLogin({
      req,
      user,
      workspace,
      selectedBranch,
      credential,
    });

    return res.json({
      status: "success",
      message: `Command granted. Opening ${workspace.name}.`,
      token: loginResult.token,
      workspace: {
        id: workspace.id || null,
        code: workspace.code,
        name: workspace.name,
      },
      user: loginResult.user,
    });
  } catch (error) {
    console.error("Passkey authentication verification error:", error);
    return res.status(401).json({
      status: "error",
      message: "Device unlock could not be verified.",
    });
  }
});

router.delete("/:passkeyId", requireAuth, async (req, res) => {
  try {
    const passkeyId = cleanNumber(req.params.passkeyId);

    if (!passkeyId) {
      return res.status(400).json({
        status: "error",
        message: "Invalid trusted device.",
      });
    }

    const [result] = await pool.query(
      `UPDATE user_passkeys
       SET revoked_at = NOW()
       WHERE id = ?
         AND user_id = ?
         AND revoked_at IS NULL`,
      [passkeyId, req.user.id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        status: "error",
        message: "Trusted device was not found.",
      });
    }

    await writeAuditEvent({
      req,
      userId: req.user.id,
      branchId: req.user.branch_id || null,
      action: "PASSKEY_REVOKED",
      actionType: "auth.passkey.revoked",
      outcome: "success",
      severity: "warning",
      entityType: "user",
      entityId: req.user.id,
      details: "A trusted device passkey was revoked.",
    });

    return res.json({
      status: "success",
      message: "Trusted device removed.",
    });
  } catch (error) {
    console.error("Revoke passkey error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not remove the trusted device.",
    });
  }
});

module.exports = router;
