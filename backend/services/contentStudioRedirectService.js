"use strict";

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  ContentStudioError,
  cleanText,
  insertContentAudit,
  schemaNotReadyError,
} = require("./contentStudioPageService");
const {
  STATIC_PUBLIC_PATHS,
  pagePublicPath,
} = require("./contentStudioWebsiteControlService");

const REDIRECT_STATUS_CODES = Object.freeze([301, 302, 307, 308]);
const REDIRECT_RULE_STATUSES = Object.freeze([
  "draft",
  "active",
  "inactive",
  "archived",
]);

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizePathname(pathname) {
  let result = String(pathname || "/").replace(/\/{2,}/g, "/");
  if (!result.startsWith("/")) result = `/${result}`;
  if (result.length > 1) result = result.replace(/\/+$/, "");
  return result || "/";
}

function normalizeSourcePath(value) {
  const raw = cleanText(value, 500);
  if (!raw || !/^\/(?!\/)/.test(raw) || /\s/.test(raw)) {
    throw new ContentStudioError(
      "Redirect source must be one exact relative public path beginning with /.",
      { code: "PUBLIC_REDIRECT_SOURCE_INVALID", statusCode: 400 }
    );
  }
  const parsed = new URL(raw, "https://chalin.invalid");
  if (parsed.search || parsed.hash) {
    throw new ContentStudioError(
      "Redirect source paths cannot contain a query string or fragment.",
      { code: "PUBLIC_REDIRECT_SOURCE_QUERY_BLOCKED", statusCode: 400 }
    );
  }
  return normalizePathname(parsed.pathname);
}

function normalizeDestination(value) {
  const raw = cleanText(value, 1000);
  if (!raw || /\s/.test(raw)) {
    throw new ContentStudioError("Redirect destination is required.", {
      code: "PUBLIC_REDIRECT_DESTINATION_INVALID",
      statusCode: 400,
    });
  }

  if (/^\/(?!\/)/.test(raw)) {
    const parsed = new URL(raw, "https://chalin.invalid");
    const pathname = normalizePathname(parsed.pathname);
    return {
      kind: "internal",
      url: `${pathname}${parsed.search}${parsed.hash}`,
      path: pathname,
    };
  }

  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw new Error("unsafe");
    }
    return {
      kind: "external_https",
      url: parsed.toString(),
      path: null,
    };
  } catch {
    throw new ContentStudioError(
      "External redirect destinations must be absolute HTTPS URLs without credentials or fragments.",
      { code: "PUBLIC_REDIRECT_EXTERNAL_HTTPS_REQUIRED", statusCode: 400 }
    );
  }
}

function normalizeRedirectStatus(value) {
  const status = Number(value || 301);
  if (!REDIRECT_STATUS_CODES.includes(status)) {
    throw new ContentStudioError(
      "Redirect status must be 301, 302, 307 or 308.",
      { code: "PUBLIC_REDIRECT_STATUS_INVALID", statusCode: 400 }
    );
  }
  return status;
}

function normalizeDateTime(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ContentStudioError(`${label} must be a valid date and time.`, {
      code: "PUBLIC_REDIRECT_WINDOW_INVALID",
      statusCode: 400,
    });
  }
  return date;
}

function sanitizeRedirectInput(input = {}) {
  const sourcePath = normalizeSourcePath(input.source_path || input.source);
  const destination = normalizeDestination(
    input.destination_url || input.destination
  );
  const redirectStatus = normalizeRedirectStatus(input.redirect_status);
  const activateAt = normalizeDateTime(input.activate_at, "Activation time");
  const expiresAt = normalizeDateTime(input.expires_at, "Expiry time");
  if (expiresAt && activateAt && expiresAt.getTime() <= activateAt.getTime()) {
    throw new ContentStudioError(
      "Redirect expiry must be later than its activation time.",
      { code: "PUBLIC_REDIRECT_WINDOW_ORDER_INVALID", statusCode: 400 }
    );
  }
  if (destination.kind === "internal" && destination.path === sourcePath) {
    throw new ContentStudioError(
      "A redirect cannot point back to its own source path.",
      { code: "PUBLIC_REDIRECT_SELF_LOOP_BLOCKED", statusCode: 409 }
    );
  }
  return {
    source_path: sourcePath,
    destination_url: destination.url,
    destination_kind: destination.kind,
    destination_path: destination.path,
    redirect_status: redirectStatus,
    activate_at: activateAt,
    expires_at: expiresAt,
    reason: cleanText(input.reason, 500) || null,
  };
}

async function listActivePagePaths(connection = pool) {
  const [rows] = await connection.query(
    `SELECT id, slug, is_homepage, publication_status
       FROM public_pages
      WHERE publication_status <> 'archived'`
  );
  return new Map(
    rows
      .map((row) => [pagePublicPath(row), row])
      .filter(([pathname]) => Boolean(pathname))
  );
}

async function loadRedirects(connection = pool, { includeArchived = true } = {}) {
  const [rows] = await connection.query(
    `SELECT r.*,
            creator.full_name AS created_by_name,
            updater.full_name AS updated_by_name,
            activator.full_name AS activated_by_name,
            deactivator.full_name AS deactivated_by_name
       FROM public_redirect_rules r
       LEFT JOIN users creator ON creator.id = r.created_by
       LEFT JOIN users updater ON updater.id = r.updated_by
       LEFT JOIN users activator ON activator.id = r.activated_by
       LEFT JOIN users deactivator ON deactivator.id = r.deactivated_by
      ${includeArchived ? "" : "WHERE r.rule_status <> 'archived'"}
      ORDER BY FIELD(r.rule_status, 'active','draft','inactive','archived'), r.updated_at DESC, r.id DESC`
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    redirect_status: Number(row.redirect_status),
    destination_kind: /^\/(?!\/)/.test(String(row.destination_url || ""))
      ? "internal"
      : "external_https",
  }));
}

async function loadRuleForUpdate(connection, ruleId) {
  const [rows] = await connection.query(
    `SELECT * FROM public_redirect_rules WHERE id = ? LIMIT 1 FOR UPDATE`,
    [ruleId]
  );
  if (!rows[0]) {
    throw new ContentStudioError("Redirect rule not found.", {
      code: "PUBLIC_REDIRECT_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

async function assertRedirectSafety(
  connection,
  snapshot,
  { ruleId = null } = {}
) {
  if (STATIC_PUBLIC_PATHS.has(snapshot.source_path)) {
    throw new ContentStudioError(
      "Redirect source collides with a built-in CHALIN ONE public route.",
      { code: "PUBLIC_REDIRECT_STATIC_ROUTE_COLLISION", statusCode: 409 }
    );
  }

  const pagePaths = await listActivePagePaths(connection);
  if (pagePaths.has(snapshot.source_path)) {
    throw new ContentStudioError(
      "Redirect source collides with an active governed website page.",
      { code: "PUBLIC_REDIRECT_PAGE_COLLISION", statusCode: 409 }
    );
  }

  const [rows] = await connection.query(
    `SELECT id, source_path, destination_url, rule_status
       FROM public_redirect_rules
      WHERE rule_status <> 'archived'
        AND (? IS NULL OR id <> ?)`,
    [ruleId, ruleId]
  );

  for (const row of rows) {
    const existingSource = normalizeSourcePath(row.source_path);
    let existingDestination;
    try {
      existingDestination = normalizeDestination(row.destination_url);
    } catch {
      continue;
    }
    if (
      snapshot.destination_kind === "internal" &&
      snapshot.destination_path === existingSource
    ) {
      throw new ContentStudioError(
        `Redirect destination ${snapshot.destination_path} is already another redirect source. Redirect chains are blocked.`,
        { code: "PUBLIC_REDIRECT_CHAIN_BLOCKED", statusCode: 409 }
      );
    }
    if (
      existingDestination.kind === "internal" &&
      existingDestination.path === snapshot.source_path
    ) {
      throw new ContentStudioError(
        `Another redirect already points to ${snapshot.source_path}. Activating this rule would create a redirect chain.`,
        { code: "PUBLIC_REDIRECT_INBOUND_CHAIN_BLOCKED", statusCode: 409 }
      );
    }
  }

  return true;
}

async function platformAudit(connection, req, action, ruleId, metadata) {
  await writeAuditEvent({
    connection,
    req,
    action,
    details: `CHALIN ONE redirect ${action}`,
    entityType: "public_redirect_rule",
    entityId: ruleId,
    actionType: action,
    metadata,
  });
}

async function createRedirectDraft({ input, user, req }) {
  const snapshot = sanitizeRedirectInput(input);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertRedirectSafety(connection, snapshot);
    const [result] = await connection.query(
      `INSERT INTO public_redirect_rules
         (source_path, destination_url, redirect_status, rule_status,
          activate_at, expires_at, reason, created_by, updated_by)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
      [
        snapshot.source_path,
        snapshot.destination_url,
        snapshot.redirect_status,
        snapshot.activate_at,
        snapshot.expires_at,
        snapshot.reason,
        user?.id || null,
        user?.id || null,
      ]
    );
    const ruleId = Number(result.insertId);
    await insertContentAudit(connection, {
      entityType: "redirect_rule",
      entityId: ruleId,
      actionKey: "redirect_rule_created",
      actorUserId: user?.id,
      requestId: req?.requestId,
      after: snapshot,
    });
    await platformAudit(connection, req, "PUBLIC_REDIRECT_RULE_CREATED", ruleId, snapshot);
    await connection.commit();
    return listRedirectRules();
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new ContentStudioError(
        "A redirect rule already exists for this exact source path.",
        { code: "PUBLIC_REDIRECT_SOURCE_DUPLICATE", statusCode: 409 }
      );
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function updateRedirectDraft({ ruleId, input, user, req }) {
  const id = positiveInteger(ruleId);
  if (!id) {
    throw new ContentStudioError("Invalid redirect rule ID.", {
      code: "PUBLIC_REDIRECT_ID_INVALID",
      statusCode: 400,
    });
  }
  const snapshot = sanitizeRedirectInput(input);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const existing = await loadRuleForUpdate(connection, id);
    if (!['draft', 'inactive'].includes(existing.rule_status)) {
      throw new ContentStudioError(
        "Active redirects must be deactivated before they can be edited.",
        { code: "PUBLIC_REDIRECT_NOT_EDITABLE", statusCode: 409 }
      );
    }
    await assertRedirectSafety(connection, snapshot, { ruleId: id });
    await connection.query(
      `UPDATE public_redirect_rules
          SET source_path = ?, destination_url = ?, redirect_status = ?,
              rule_status = 'draft', activate_at = ?, expires_at = ?, reason = ?,
              updated_by = ?, updated_at = NOW()
        WHERE id = ?`,
      [
        snapshot.source_path,
        snapshot.destination_url,
        snapshot.redirect_status,
        snapshot.activate_at,
        snapshot.expires_at,
        snapshot.reason,
        user?.id || null,
        id,
      ]
    );
    await insertContentAudit(connection, {
      entityType: "redirect_rule",
      entityId: id,
      actionKey: "redirect_rule_updated",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: existing,
      after: snapshot,
    });
    await platformAudit(connection, req, "PUBLIC_REDIRECT_RULE_UPDATED", id, snapshot);
    await connection.commit();
    return listRedirectRules();
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new ContentStudioError(
        "A redirect rule already exists for this exact source path.",
        { code: "PUBLIC_REDIRECT_SOURCE_DUPLICATE", statusCode: 409 }
      );
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function activateRedirectRule({ ruleId, user, req }) {
  const id = positiveInteger(ruleId);
  if (!id) {
    throw new ContentStudioError("Invalid redirect rule ID.", {
      code: "PUBLIC_REDIRECT_ID_INVALID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const existing = await loadRuleForUpdate(connection, id);
    if (!['draft', 'inactive'].includes(existing.rule_status)) {
      throw new ContentStudioError("Only draft or inactive redirects can be activated.", {
        code: "PUBLIC_REDIRECT_ACTIVATION_STATE_INVALID",
        statusCode: 409,
      });
    }
    const snapshot = sanitizeRedirectInput(existing);
    await assertRedirectSafety(connection, snapshot, { ruleId: id });
    if (snapshot.expires_at && snapshot.expires_at.getTime() <= Date.now()) {
      throw new ContentStudioError("An expired redirect cannot be activated.", {
        code: "PUBLIC_REDIRECT_ALREADY_EXPIRED",
        statusCode: 409,
      });
    }
    await connection.query(
      `UPDATE public_redirect_rules
          SET rule_status = 'active', activated_by = ?, activated_at = NOW(),
              deactivated_by = NULL, deactivated_at = NULL,
              updated_by = ?, updated_at = NOW()
        WHERE id = ?`,
      [user?.id || null, user?.id || null, id]
    );
    await insertContentAudit(connection, {
      entityType: "redirect_rule",
      entityId: id,
      actionKey: "redirect_rule_activated",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: { rule_status: existing.rule_status },
      after: { rule_status: "active" },
    });
    await platformAudit(connection, req, "PUBLIC_REDIRECT_RULE_ACTIVATED", id, snapshot);
    await connection.commit();
    return listRedirectRules();
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function deactivateRedirectRule({ ruleId, user, req }) {
  const id = positiveInteger(ruleId);
  if (!id) throw new ContentStudioError("Invalid redirect rule ID.", { code: "PUBLIC_REDIRECT_ID_INVALID", statusCode: 400 });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const existing = await loadRuleForUpdate(connection, id);
    if (existing.rule_status !== "active") {
      throw new ContentStudioError("Only an active redirect can be deactivated.", {
        code: "PUBLIC_REDIRECT_DEACTIVATION_STATE_INVALID",
        statusCode: 409,
      });
    }
    await connection.query(
      `UPDATE public_redirect_rules
          SET rule_status = 'inactive', deactivated_by = ?, deactivated_at = NOW(),
              updated_by = ?, updated_at = NOW()
        WHERE id = ?`,
      [user?.id || null, user?.id || null, id]
    );
    await insertContentAudit(connection, {
      entityType: "redirect_rule",
      entityId: id,
      actionKey: "redirect_rule_deactivated",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: { rule_status: "active" },
      after: { rule_status: "inactive" },
    });
    await platformAudit(connection, req, "PUBLIC_REDIRECT_RULE_DEACTIVATED", id, {});
    await connection.commit();
    return listRedirectRules();
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function archiveRedirectRule({ ruleId, reason, user, req }) {
  const id = positiveInteger(ruleId);
  if (!id) throw new ContentStudioError("Invalid redirect rule ID.", { code: "PUBLIC_REDIRECT_ID_INVALID", statusCode: 400 });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const existing = await loadRuleForUpdate(connection, id);
    if (existing.rule_status === "active") {
      throw new ContentStudioError("Deactivate this redirect before archiving it.", {
        code: "PUBLIC_REDIRECT_ACTIVE_ARCHIVE_BLOCKED",
        statusCode: 409,
      });
    }
    const archiveReason = cleanText(reason, 500) || existing.reason || null;
    await connection.query(
      `UPDATE public_redirect_rules
          SET rule_status = 'archived', reason = ?, updated_by = ?, updated_at = NOW()
        WHERE id = ?`,
      [archiveReason, user?.id || null, id]
    );
    await insertContentAudit(connection, {
      entityType: "redirect_rule",
      entityId: id,
      actionKey: "redirect_rule_archived",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: { rule_status: existing.rule_status },
      after: { rule_status: "archived", reason: archiveReason },
    });
    await platformAudit(connection, req, "PUBLIC_REDIRECT_RULE_ARCHIVED", id, { reason: archiveReason });
    await connection.commit();
    return listRedirectRules();
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function listRedirectRules() {
  try {
    return { items: await loadRedirects(pool, { includeArchived: true }) };
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function resolvePublicRedirect(rawPath) {
  let sourcePath;
  try {
    sourcePath = normalizeSourcePath(rawPath);
  } catch {
    return null;
  }
  try {
    const [rows] = await pool.query(
      `SELECT id, source_path, destination_url, redirect_status
         FROM public_redirect_rules
        WHERE source_path = ?
          AND rule_status = 'active'
          AND (activate_at IS NULL OR activate_at <= UTC_TIMESTAMP())
          AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
        LIMIT 1`,
      [sourcePath]
    );
    const row = rows[0];
    if (!row) return null;
    const destination = normalizeDestination(row.destination_url);
    if (destination.kind === "internal" && destination.path === sourcePath) return null;
    return {
      id: Number(row.id),
      source_path: sourcePath,
      destination_url: destination.url,
      destination_kind: destination.kind,
      redirect_status: Number(row.redirect_status),
    };
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

module.exports = {
  REDIRECT_RULE_STATUSES,
  REDIRECT_STATUS_CODES,
  activateRedirectRule,
  archiveRedirectRule,
  assertRedirectSafety,
  createRedirectDraft,
  deactivateRedirectRule,
  listActivePagePaths,
  listRedirectRules,
  normalizeDestination,
  normalizePathname,
  normalizeRedirectStatus,
  normalizeSourcePath,
  resolvePublicRedirect,
  sanitizeRedirectInput,
  updateRedirectDraft,
};
