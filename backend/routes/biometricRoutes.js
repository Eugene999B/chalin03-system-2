const express = require("express");
const crypto = require("crypto");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { createSession } = require("../services/accountSessionService");
const { writeAuditEvent } = require("../services/auditTrailService");
const { resolveEffectivePermissions } = require("../services/permissionOverrideService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  ensurePasskeySchema,
  getBiometricGeneration,
} = require("../services/passkeySchemaService");
const authRoutes = require("./authRoutes");

const router = express.Router();
const auth = authRoutes.commandGateAuth;
const RP_NAME = "Chalin 03 Company Limited";
const DEFAULT_WORKSPACE_CODE = "spare_parts";
const CHALLENGE_MINUTES = 5;
const RECENT_PASSWORD_MINUTES = 5;
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
  if (Array.isArray(value)) return value.map((item) => cleanText(item, 32)).filter(Boolean);

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

function normalizeOrigin(value) {
  return cleanText(value, 300).replace(/\/+$/, "");
}

function getRelyingPartyConfig() {
  const production = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const rpID = cleanText(process.env.PASSKEY_RP_ID, 255) || (production ? "chalin03.com" : "localhost");
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

  return { rpID, origins };
}

function bindingHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function requestIp(req) {
  return cleanText(
    String(req.headers["x-forwarded-for"] || req.headers["cf-connecting-ip"] || req.ip || "")
      .split(",")[0],
    50
  );
}

async function createChallenge({ purpose, userId = null, challenge, context = {} }) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO passkey_challenges
      (id, purpose, user_id, challenge, context_json, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [id, purpose, userId, challenge, JSON.stringify(context), CHALLENGE_MINUTES]
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

    if (!rows.length) {
      await connection.rollback();
      return null;
    }

    const row = rows[0];
    const expired = new Date(row.expires_at).getTime() <= Date.now();
    if (row.purpose !== purpose || row.used_at || expired) {
      await connection.rollback();
      return null;
    }

    await connection.query("UPDATE passkey_challenges SET used_at = NOW() WHERE id = ?", [id]);
    await connection.commit();

    let context = {};
    try {
      context = row.context_json ? JSON.parse(row.context_json) : {};
    } catch {
      context = {};
    }

    return { ...row, context };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function loadUserById(userId) {
  const users = await auth.buildUserSelectByWhere("WHERE id = ?", [userId]);
  return users[0] || null;
}

async function loadCredentialByBinding(rawToken) {
  const generation = await getBiometricGeneration();
  const [rows] = await pool.query(
    `SELECT
       up.id, up.user_id, up.webauthn_user_id, up.credential_id,
       up.public_key, up.counter, up.device_type, up.backed_up,
       up.transports, up.display_name, up.created_at, up.last_used_at,
       up.binding_generation, up.authenticator_attachment,
       u.full_name, u.username, u.is_active
     FROM user_passkeys up
     INNER JOIN users u ON u.id = up.user_id
     WHERE up.device_binding_hash = ?
       AND up.binding_generation = ?
       AND up.revoked_at IS NULL
     LIMIT 1`,
    [bindingHash(rawToken), generation]
  );
  return rows[0] || null;
}

async function loadCredentialById(passkeyId) {
  const generation = await getBiometricGeneration();
  const [rows] = await pool.query(
    `SELECT id, user_id, webauthn_user_id, credential_id, public_key,
            counter, device_type, backed_up, transports, display_name,
            binding_generation, authenticator_attachment
     FROM user_passkeys
     WHERE id = ?
       AND binding_generation = ?
       AND revoked_at IS NULL
     LIMIT 1`,
    [passkeyId, generation]
  );
  return rows[0] || null;
}

async function requireRecentPasswordSession(req) {
  const [rows] = await pool.query(
    `SELECT login_method, created_at
     FROM auth_sessions
     WHERE session_id = ?
       AND user_id = ?
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [req.user.session_id, req.user.id]
  );

  if (!rows.length) return false;
  const method = cleanText(rows[0].login_method, 30).toLowerCase();
  const createdAt = new Date(rows[0].created_at).getTime();
  const recent = Number.isFinite(createdAt) && Date.now() - createdAt <= RECENT_PASSWORD_MINUTES * 60 * 1000;
  return method !== "biometric" && method !== "passkey" && recent;
}

async function buildUserResponse(user, branch, workspace) {
  const isSpareParts = workspace.code === DEFAULT_WORKSPACE_CODE;
  const workspaceRole = user.workspace_role || user.access_role || (isSpareParts ? user.role : null);
  const branchCode = branch?.branch_code || branch?.code || null;
  const branchName = branch?.name || branch?.branch_name || null;
  const branchLocation = branch?.location || branch?.branch_location || null;

  return {
    id: user.id,
    full_name: user.full_name,
    username: user.username,
    role: user.role,
    workspace_role: workspaceRole,
    phone: user.phone,
    login_method: "biometric",
    primary_workspace_code: user.primary_workspace_code || null,
    category_assignment_status: user.category_assignment_status || null,
    category_conflict_reason: user.category_conflict_reason || null,
    is_original_system_administrator: isOriginalSystemAdministrator(user),
    workspace_code: workspace.code,
    business_unit_id: workspace.id || null,
    business_unit_name: workspace.name,
    active_workspace: { id: workspace.id || null, code: workspace.code, name: workspace.name },
    default_branch_id: isSpareParts ? user.default_branch_id : null,
    can_access_all_branches: isSpareParts ? boolValue(user.can_access_all_branches) : false,
    must_change_password: boolValue(user.must_change_password),
    password_changed_at: user.password_changed_at || null,
    branch_id: branch?.id || null,
    branch_code: branchCode,
    branch_name: branchName,
    branch_location: branchLocation,
    branch_phone: branch?.phone || null,
    effective_permissions: await resolveEffectivePermissions({
      ...user,
      workspace_code: workspace.code,
      workspace_role: workspaceRole,
    }),
    selected_branch: branch
      ? {
          id: branch.id,
          branch_id: branch.id,
          code: branchCode,
          branch_code: branchCode,
          name: branchName,
          branch_name: branchName,
          location: branchLocation,
          branch_location: branchLocation,
          phone: branch.phone,
          is_head_office: boolValue(branch.is_head_office),
        }
      : null,
  };
}

router.get("/capabilities", async (_req, res) => {
  try {
    await ensurePasskeySchema();
    const { rpID } = getRelyingPartyConfig();
    return res.json({
      status: "success",
      enabled: true,
      rp_id: rpID,
      platform_only: true,
      user_verification: "required",
      label: "Fingerprint or face",
    });
  } catch (error) {
    console.error("Biometric capabilities error:", error);
    return res.status(503).json({ status: "error", enabled: false, message: "Fingerprint and face login are temporarily unavailable." });
  }
});

router.post("/binding/status", async (req, res) => {
  try {
    await ensurePasskeySchema();
    const rawToken = cleanText(req.body.binding_token, 200);
    if (!rawToken) return res.json({ status: "success", valid: false });

    const credential = await loadCredentialByBinding(rawToken);
    if (!credential || !boolValue(credential.is_active)) {
      return res.json({ status: "success", valid: false });
    }

    return res.json({
      status: "success",
      valid: true,
      account: {
        id: credential.user_id,
        full_name: credential.full_name,
        username: credential.username,
      },
      device: {
        display_name: credential.display_name,
        created_at: credential.created_at,
        last_used_at: credential.last_used_at,
      },
    });
  } catch (error) {
    console.error("Biometric binding status error:", error);
    return res.status(503).json({ status: "error", valid: false, message: "Could not verify this device." });
  }
});

router.get("/devices", requireAuth, async (req, res) => {
  try {
    await ensurePasskeySchema();
    const generation = await getBiometricGeneration();
    const [rows] = await pool.query(
      `SELECT id, display_name, created_at, last_used_at
       FROM user_passkeys
       WHERE user_id = ?
         AND binding_generation = ?
         AND device_binding_hash IS NOT NULL
         AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [req.user.id, generation]
    );
    return res.json({ status: "success", devices: rows });
  } catch (error) {
    console.error("List biometric devices error:", error);
    return res.status(500).json({ status: "error", message: "Could not load fingerprint and face devices." });
  }
});

router.post("/registration/options", requireAuth, async (req, res) => {
  try {
    await ensurePasskeySchema();

    if (!(await requireRecentPasswordSession(req))) {
      return res.status(403).json({
        status: "error",
        code: "RECENT_PASSWORD_LOGIN_REQUIRED",
        message: "Sign in with your password again before setting up fingerprint or face login.",
      });
    }

    const user = await loadUserById(req.user.id);
    if (!user || !boolValue(user.is_active)) {
      return res.status(403).json({ status: "error", message: "This account is not available." });
    }

    const generation = await getBiometricGeneration();
    const [passkeys] = await pool.query(
      `SELECT credential_id, transports, webauthn_user_id
       FROM user_passkeys
       WHERE user_id = ?
         AND binding_generation = ?
         AND revoked_at IS NULL`,
      [user.id, generation]
    );
    const webauthnUserID = passkeys[0]?.webauthn_user_id || crypto.randomBytes(32).toString("base64url");
    const rawBindingToken = crypto.randomBytes(32).toString("base64url");
    const displayName = cleanText(req.body.display_name, 120) || "Personal device";
    const { generateRegistrationOptions } = await getSimpleWebAuthn();
    const { rpID } = getRelyingPartyConfig();

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userID: Buffer.from(webauthnUserID, "base64url"),
      userName: user.username,
      userDisplayName: user.full_name || user.username,
      attestationType: "none",
      excludeCredentials: passkeys.map((item) => ({
        id: item.credential_id,
        transports: parseTransports(item.transports),
      })),
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
      preferredAuthenticatorType: "localDevice",
      supportedAlgorithmIDs: [-7, -257],
    });

    const challengeId = await createChallenge({
      purpose: "biometric_registration",
      userId: user.id,
      challenge: options.challenge,
      context: {
        display_name: displayName,
        webauthn_user_id: webauthnUserID,
        device_binding_hash: bindingHash(rawBindingToken),
        binding_generation: generation,
      },
    });

    return res.json({
      status: "success",
      challenge_id: challengeId,
      binding_token: rawBindingToken,
      options,
    });
  } catch (error) {
    console.error("Biometric registration options error:", error);
    return res.status(500).json({ status: "error", message: "Could not prepare fingerprint or face setup." });
  }
});

router.post("/registration/verify", requireAuth, async (req, res) => {
  try {
    const challengeId = cleanText(req.body.challenge_id, 80);
    const response = req.body.response;
    if (!challengeId || !response?.id) {
      return res.status(400).json({ status: "error", message: "Fingerprint or face setup response is incomplete." });
    }

    if (response.authenticatorAttachment && response.authenticatorAttachment !== "platform") {
      return res.status(400).json({
        status: "error",
        code: "LOCAL_BIOMETRIC_REQUIRED",
        message: "Only this device's built-in fingerprint or face verification can be registered.",
      });
    }

    const challenge = await consumeChallenge({ id: challengeId, purpose: "biometric_registration" });
    if (!challenge || Number(challenge.user_id) !== Number(req.user.id)) {
      return res.status(400).json({ status: "error", message: "The fingerprint or face setup request expired. Start again." });
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
      return res.status(400).json({ status: "error", message: "Fingerprint or face verification was not accepted." });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const transports = credential.transports || response.response?.transports || [];

    await pool.query(
      `INSERT INTO user_passkeys
        (user_id, webauthn_user_id, credential_id, public_key, counter,
         device_type, backed_up, transports, display_name, device_binding_hash,
         binding_generation, authenticator_attachment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'platform')`,
      [
        req.user.id,
        cleanText(challenge.context.webauthn_user_id, 128),
        credential.id,
        Buffer.from(credential.publicKey),
        Number(credential.counter || 0),
        cleanText(credentialDeviceType, 32) || null,
        credentialBackedUp ? 1 : 0,
        JSON.stringify(transports),
        cleanText(challenge.context.display_name, 120) || "Personal device",
        cleanText(challenge.context.device_binding_hash, 64),
        Number(challenge.context.binding_generation || 1),
      ]
    );

    await writeAuditEvent({
      req,
      userId: req.user.id,
      branchId: req.user.branch_id || null,
      action: "BIOMETRIC_DEVICE_REGISTERED",
      actionType: "auth.biometric.registered",
      outcome: "success",
      severity: "info",
      entityType: "user",
      entityId: req.user.id,
      details: `Fingerprint or face login was enabled on ${cleanText(challenge.context.display_name, 120) || "a personal device"}.`,
    });

    return res.status(201).json({
      status: "success",
      verified: true,
      message: "Fingerprint or face login is ready on this device.",
      account: { id: req.user.id, full_name: req.user.full_name, username: req.user.username },
    });
  } catch (error) {
    console.error("Biometric registration verification error:", error);
    const duplicate = error?.code === "ER_DUP_ENTRY" || String(error?.message || "").toLowerCase().includes("duplicate");
    return res.status(duplicate ? 409 : 400).json({
      status: "error",
      message: duplicate
        ? "This fingerprint or face device is already linked."
        : "Fingerprint or face setup could not be verified.",
    });
  }
});

router.post("/authentication/options", async (req, res) => {
  try {
    await ensurePasskeySchema();
    const rawToken = cleanText(req.body.binding_token, 200);
    const workspaceCode = auth.normalizeWorkspaceCode(req.body.workspace_code);
    const branchId = cleanNumber(req.body.branch_id);

    if (!rawToken) {
      return res.status(401).json({ status: "error", code: "BIOMETRIC_BINDING_REQUIRED", message: "This browser is not linked to an account." });
    }
    if (!workspaceCode) {
      return res.status(400).json({ status: "error", message: "Choose a valid business workspace." });
    }
    if (workspaceCode === DEFAULT_WORKSPACE_CODE && !branchId) {
      return res.status(400).json({ status: "error", message: "Choose a Spare Parts store before using fingerprint or face login." });
    }
    if (workspaceCode !== DEFAULT_WORKSPACE_CODE && branchId) {
      return res.status(400).json({ status: "error", message: "Spare Parts stores cannot be used for this workspace." });
    }

    const credential = await loadCredentialByBinding(rawToken);
    if (!credential || !boolValue(credential.is_active)) {
      return res.status(401).json({
        status: "error",
        code: "BIOMETRIC_DEVICE_REVOKED",
        message: "This device is new or has been reset. Sign in with your password first.",
      });
    }

    const { generateAuthenticationOptions } = await getSimpleWebAuthn();
    const { rpID } = getRelyingPartyConfig();
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      allowCredentials: [
        {
          id: credential.credential_id,
          transports: parseTransports(credential.transports),
        },
      ],
    });

    const challengeId = await createChallenge({
      purpose: "biometric_authentication",
      userId: credential.user_id,
      challenge: options.challenge,
      context: {
        passkey_id: credential.id,
        binding_hash: bindingHash(rawToken),
        workspace_code: workspaceCode,
        branch_id: workspaceCode === DEFAULT_WORKSPACE_CODE ? branchId : null,
      },
    });

    return res.json({
      status: "success",
      challenge_id: challengeId,
      options,
      account: {
        id: credential.user_id,
        full_name: credential.full_name,
        username: credential.username,
      },
    });
  } catch (error) {
    console.error("Biometric authentication options error:", error);
    return res.status(500).json({ status: "error", message: "Could not prepare fingerprint or face login." });
  }
});

router.post("/authentication/verify", async (req, res) => {
  try {
    const challengeId = cleanText(req.body.challenge_id, 80);
    const response = req.body.response;
    if (!challengeId || !response?.id) {
      return res.status(400).json({ status: "error", message: "Fingerprint or face response is incomplete." });
    }

    const challenge = await consumeChallenge({ id: challengeId, purpose: "biometric_authentication" });
    if (!challenge) {
      return res.status(400).json({ status: "error", message: "The fingerprint or face request expired. Try again." });
    }

    const credential = await loadCredentialById(cleanNumber(challenge.context.passkey_id));
    if (!credential || credential.credential_id !== response.id) {
      return res.status(401).json({ status: "error", message: "This device is not linked to the requested account." });
    }

    const user = await loadUserById(credential.user_id);
    if (!user || !boolValue(user.is_active)) {
      return res.status(403).json({ status: "error", message: "This account is not available." });
    }
    if (auth.isLoginLocked(user)) {
      return res.status(423).json({ status: "error", code: "ACCOUNT_LOCKED", message: "This account is blocked. Use account recovery or contact the System Administrator." });
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
      return res.status(401).json({ status: "error", message: "Fingerprint or face verification failed." });
    }

    const workspaceResult = await auth.resolveLoginWorkspace(user, challenge.context.workspace_code);
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
      const branchResult = await auth.resolveLoginBranch(user, challenge.context.branch_id);
      if (!branchResult.ok) {
        return res.status(branchResult.statusCode).json({ status: "error", message: branchResult.message });
      }
      selectedBranch = branchResult.branch;
    }

    await pool.query(
      `UPDATE user_passkeys
       SET counter = ?, last_used_at = NOW()
       WHERE id = ?`,
      [Number(verification.authenticationInfo?.newCounter || 0), credential.id]
    );

    user.login_method = "biometric";
    const session = await createSession({
      userId: user.id,
      req,
      workspaceCode: workspace.code,
      branchId: selectedBranch?.id || null,
      loginMethod: "biometric",
      deviceEvidence: req.body.device_evidence || {},
    });
    const token = auth.createToken(user, selectedBranch, workspace, session.sessionId);

    await writeAuditEvent({
      req,
      userId: user.id,
      branchId: selectedBranch?.id || null,
      action: "BIOMETRIC_LOGIN",
      actionType: "auth.biometric.login",
      outcome: "success",
      severity: "info",
      entityType: "user",
      entityId: user.id,
      details: `${user.username} signed in with fingerprint or face on the account-bound device.`,
      metadata: { credential_id_suffix: String(credential.credential_id).slice(-12), ip: requestIp(req) },
    });
    await auth.recordSuccessfulLogin(req, user);

    return res.json({
      status: "success",
      message: `Identity verified. Opening ${workspace.name}.`,
      token,
      workspace: { id: workspace.id || null, code: workspace.code, name: workspace.name },
      user: await buildUserResponse(user, selectedBranch, workspace),
    });
  } catch (error) {
    console.error("Biometric authentication verification error:", error);
    return res.status(401).json({ status: "error", message: "Fingerprint or face login could not be verified." });
  }
});

router.delete("/devices/:deviceId", requireAuth, async (req, res) => {
  try {
    const deviceId = cleanNumber(req.params.deviceId);
    if (!deviceId) return res.status(400).json({ status: "error", message: "Invalid biometric device." });

    const [result] = await pool.query(
      `UPDATE user_passkeys
       SET revoked_at = NOW(), revoked_reason = 'user_removed_device'
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      [deviceId, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ status: "error", message: "Fingerprint or face device was not found." });

    await writeAuditEvent({
      req,
      userId: req.user.id,
      branchId: req.user.branch_id || null,
      action: "BIOMETRIC_DEVICE_REVOKED",
      actionType: "auth.biometric.revoked",
      outcome: "success",
      severity: "warning",
      entityType: "user",
      entityId: req.user.id,
      details: "A fingerprint or face device was removed from the account.",
    });

    return res.json({ status: "success", message: "Fingerprint or face login was removed from that device." });
  } catch (error) {
    console.error("Revoke biometric device error:", error);
    return res.status(500).json({ status: "error", message: "Could not remove the fingerprint or face device." });
  }
});

module.exports = router;
