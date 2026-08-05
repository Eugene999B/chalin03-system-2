"use strict";

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  ContentStudioError,
  assertJsonSize,
  booleanValue,
  cleanText,
  insertContentAudit,
  positiveInteger,
  schemaNotReadyError,
} = require("./contentStudioPageService");

const PUBLIC_SETTING_KEYS = Object.freeze([
  "site.name",
  "site.tagline",
  "site.description",
  "site.logo",
  "site.favicon",
  "site.contact",
  "site.social_links",
  "site.brand",
  "site.seo",
  "site.footer",
  "site.legal",
  "site.emergency_banner",
  "site.analytics_public",
  "company.registration",
  "company.certifications",
  "company.safety_commitment",
  "company.quality_commitment",
]);

const SENSITIVE_KEY_FRAGMENTS = Object.freeze([
  "secret",
  "password",
  "token",
  "credential",
  "private_key",
  "api_key",
  "database",
  "jwt",
  "otp",
  "encryption",
  "signing",
  "origin_key",
]);

function normalizeSettingKey(value) {
  const key = cleanText(value, 150).toLowerCase();
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(key) ? key : null;
}

function normalizeSettingGroup(value) {
  const group = cleanText(value, 80).toLowerCase();
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(group)
    ? group
    : "general";
}

function assertPublicSettingAllowed(settingKey, isPublic) {
  if (!isPublic) return true;

  if (SENSITIVE_KEY_FRAGMENTS.some((fragment) => settingKey.includes(fragment))) {
    throw new ContentStudioError(
      "Sensitive configuration keys can never be exposed through the public website.",
      {
        code: "PUBLIC_SETTING_SENSITIVE_KEY_BLOCKED",
        statusCode: 409,
      }
    );
  }

  if (!PUBLIC_SETTING_KEYS.includes(settingKey)) {
    throw new ContentStudioError(
      "This setting key is not approved for anonymous public website access.",
      {
        code: "PUBLIC_SETTING_KEY_NOT_ALLOWLISTED",
        statusCode: 409,
      }
    );
  }

  return true;
}

function parseJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function listSiteSettings({ group, publicOnly = false } = {}) {
  const filters = [];
  const values = [];

  if (group) {
    filters.push("setting_group = ?");
    values.push(normalizeSettingGroup(group));
  }

  if (publicOnly) {
    filters.push("is_public = 1");
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  try {
    const [rows] = await pool.query(
      `SELECT
         id,
         setting_key,
         setting_group,
         value_json,
         description,
         is_public,
         is_active,
         created_by,
         updated_by,
         created_at,
         updated_at
       FROM public_site_settings
       ${where}
       ORDER BY setting_group, setting_key`,
      values
    );

    return rows.map((row) => ({
      ...row,
      value: parseJson(row.value_json, null),
      value_json: undefined,
      is_public: Boolean(Number(row.is_public)),
      is_active: Boolean(Number(row.is_active)),
    }));
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function getSettingForUpdate(connection, settingId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM public_site_settings
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [settingId]
  );

  if (!rows[0]) {
    throw new ContentStudioError("Website setting not found.", {
      code: "CONTENT_SETTING_NOT_FOUND",
      statusCode: 404,
    });
  }

  return rows[0];
}

async function upsertSiteSetting({ settingId, input = {}, user, req }) {
  const existingId = settingId ? positiveInteger(settingId) : null;
  if (settingId && !existingId) {
    throw new ContentStudioError("Invalid website setting ID.", {
      code: "INVALID_CONTENT_SETTING_ID",
      statusCode: 400,
    });
  }

  const settingKey = normalizeSettingKey(input.setting_key || input.key);
  if (!settingKey) {
    throw new ContentStudioError("A safe website setting key is required.", {
      code: "INVALID_CONTENT_SETTING_KEY",
      statusCode: 400,
    });
  }

  const settingGroup = normalizeSettingGroup(input.setting_group || input.group);
  const isPublic = booleanValue(input.is_public, false);
  const isActive = booleanValue(input.is_active, true);
  assertPublicSettingAllowed(settingKey, isPublic);
  const valueJson = assertJsonSize(input.value ?? input.value_json ?? null, "Website setting value");
  const description = cleanText(input.description, 500) || null;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    let before = null;
    let id = existingId;

    if (existingId) {
      const existing = await getSettingForUpdate(connection, existingId);
      before = {
        setting_key: existing.setting_key,
        setting_group: existing.setting_group,
        value: parseJson(existing.value_json, null),
        description: existing.description,
        is_public: Boolean(Number(existing.is_public)),
        is_active: Boolean(Number(existing.is_active)),
      };

      await connection.query(
        `UPDATE public_site_settings
         SET setting_key = ?,
             setting_group = ?,
             value_json = ?,
             description = ?,
             is_public = ?,
             is_active = ?,
             updated_by = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          settingKey,
          settingGroup,
          valueJson,
          description,
          isPublic ? 1 : 0,
          isActive ? 1 : 0,
          user?.id || null,
          existingId,
        ]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO public_site_settings (
           setting_key,
           setting_group,
           value_json,
           description,
           is_public,
           is_active,
           created_by,
           updated_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          settingKey,
          settingGroup,
          valueJson,
          description,
          isPublic ? 1 : 0,
          isActive ? 1 : 0,
          user?.id || null,
          user?.id || null,
        ]
      );
      id = Number(result.insertId);
    }

    const after = {
      setting_key: settingKey,
      setting_group: settingGroup,
      value: parseJson(valueJson, null),
      description,
      is_public: isPublic,
      is_active: isActive,
    };

    await insertContentAudit(connection, {
      entityType: "site_setting",
      entityId: id,
      actionKey: existingId ? "site_setting_updated" : "site_setting_created",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before,
      after,
    });
    await writeAuditEvent({
      connection,
      req,
      action: existingId
        ? "PUBLIC_SITE_SETTING_UPDATED"
        : "PUBLIC_SITE_SETTING_CREATED",
      details: `CHALIN ONE website setting ${settingKey}`,
      entityType: "public_site_setting",
      entityId: id,
      actionType: existingId ? "update" : "create",
      metadata: {
        setting_key: settingKey,
        setting_group: settingGroup,
        is_public: isPublic,
        is_active: isActive,
      },
    });

    await connection.commit();
    const settings = await listSiteSettings();
    return settings.find((setting) => Number(setting.id) === id) || null;
  } catch (error) {
    await connection.rollback();

    if (error instanceof ContentStudioError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new ContentStudioError(
        "A website setting with this key already exists.",
        {
          code: "CONTENT_SETTING_DUPLICATE",
          statusCode: 409,
        }
      );
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function deactivateSiteSetting({ settingId, reason, user, req }) {
  const id = positiveInteger(settingId);
  if (!id) {
    throw new ContentStudioError("Invalid website setting ID.", {
      code: "INVALID_CONTENT_SETTING_ID",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const existing = await getSettingForUpdate(connection, id);

    await connection.query(
      `UPDATE public_site_settings
       SET is_active = 0,
           updated_by = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [user?.id || null, id]
    );

    await insertContentAudit(connection, {
      entityType: "site_setting",
      entityId: id,
      actionKey: "site_setting_deactivated",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: {
        setting_key: existing.setting_key,
        is_active: Boolean(Number(existing.is_active)),
      },
      after: {
        setting_key: existing.setting_key,
        is_active: false,
      },
      metadata: { reason: cleanText(reason, 500) || null },
    });
    await writeAuditEvent({
      connection,
      req,
      action: "PUBLIC_SITE_SETTING_DEACTIVATED",
      details: `CHALIN ONE website setting ${existing.setting_key} deactivated`,
      entityType: "public_site_setting",
      entityId: id,
      actionType: "deactivate",
      metadata: { reason: cleanText(reason, 500) || null },
    });

    await connection.commit();
    return { id, is_active: false };
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  PUBLIC_SETTING_KEYS,
  SENSITIVE_KEY_FRAGMENTS,
  assertPublicSettingAllowed,
  deactivateSiteSetting,
  listSiteSettings,
  normalizeSettingGroup,
  normalizeSettingKey,
  parseJson,
  upsertSiteSetting,
};
