const { pool } = require("../config/db");

const SAFE_SEQUENCE_CODE = /^[A-Z0-9_]{2,40}$/;
const SAFE_PREFIX = /^[A-Z0-9_-]{1,30}$/;
const SAFE_SEPARATOR = /^[-_/]{1,5}$/;
const SECRET_KEY_PATTERN =
  /(password|secret|credential|private[_-]?key|api[_-]?key|access[_-]?token|jwt)/i;

function appError(message, statusCode = 400, code = "GROUP_CONFIGURATION_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function requestIp(req) {
  return cleanText(
    String(
      req?.headers?.["x-forwarded-for"] ||
        req?.ip ||
        req?.socket?.remoteAddress ||
        ""
    ).split(",")[0],
    50
  );
}

function requestUserAgent(req) {
  return cleanText(req?.headers?.["user-agent"], 500);
}

function booleanValue(value) {
  if (value === true || value === 1 || value === "1") return true;

  const text = cleanText(value, 20).toLowerCase();
  if (["true", "yes", "on", "enabled"].includes(text)) return true;
  if (["false", "no", "off", "disabled", "0", ""].includes(text)) return false;

  throw appError("The setting requires a true or false value.");
}

function normalizeSettingValue(row, inputValue) {
  const type = cleanText(row.value_type, 30).toLowerCase();

  if (SECRET_KEY_PATTERN.test(row.setting_key)) {
    throw appError(
      "Secrets, passwords, credentials and API keys cannot be stored in Group Configuration.",
      403,
      "SECRET_CONFIGURATION_FORBIDDEN"
    );
  }

  if (type === "boolean") {
    return booleanValue(inputValue) ? "1" : "0";
  }

  if (type === "integer") {
    const value = Number(inputValue);

    if (!Number.isInteger(value) || value < 0 || value > 1000000) {
      throw appError("The setting requires a non-negative whole number.");
    }

    return String(value);
  }

  if (type === "decimal") {
    const value = Number(inputValue);

    if (!Number.isFinite(value) || value < 0 || value > 1000000000) {
      throw appError("The setting requires a valid non-negative number.");
    }

    if (
      row.setting_key === "company.tax_rate_percent" &&
      value > 100
    ) {
      throw appError("The default tax rate cannot exceed 100 percent.");
    }

    return String(Number(value.toFixed(4)));
  }

  if (type === "currency") {
    const value = cleanText(inputValue, 3).toUpperCase();

    if (!/^[A-Z]{3}$/.test(value)) {
      throw appError("Currency must use a three-letter code such as GHS.");
    }

    return value;
  }

  if (type === "timezone") {
    const value = cleanText(inputValue, 100);

    if (
      value !== "UTC" &&
      !/^[A-Za-z_+-]+\/[A-Za-z0-9_+\-/]+$/.test(value)
    ) {
      throw appError("Enter a valid timezone such as Africa/Accra.");
    }

    return value;
  }

  if (type === "time") {
    const value = cleanText(inputValue, 8);

    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) {
      throw appError("Enter a valid time using HH:MM.");
    }

    return value.length === 5 ? `${value}:00` : value;
  }

  const value = cleanText(inputValue, 1000);

  if (!value) {
    throw appError(`${row.setting_label} cannot be empty.`);
  }

  return value;
}

function deserializeSettingValue(valueText, valueType) {
  const type = cleanText(valueType, 30).toLowerCase();

  if (type === "boolean") {
    return booleanValue(valueText);
  }

  if (type === "integer") {
    const number = Number(valueText);
    return Number.isInteger(number) ? number : 0;
  }

  if (type === "decimal") {
    const number = Number(valueText);
    return Number.isFinite(number) ? number : 0;
  }

  return valueText ?? "";
}

function publicSetting(row) {
  return {
    setting_key: row.setting_key,
    setting_group: row.setting_group,
    setting_label: row.setting_label,
    setting_description: row.setting_description,
    value_type: row.value_type,
    value: deserializeSettingValue(row.value_text, row.value_type),
    is_editable: Boolean(Number(row.is_editable)),
    sort_order: Number(row.sort_order || 0),
    updated_at: row.updated_at || null,
    updated_by: row.updated_by || null,
    updated_by_name: row.updated_by_name || null,
  };
}

async function ensureConfigurationTables(connection = pool) {
  const requiredTables = [
    "group_configuration",
    "group_configuration_history",
    "document_sequences",
    "document_sequence_history",
  ];

  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (?, ?, ?, ?)`,
    requiredTables
  );

  const existing = new Set(rows.map((row) => row.TABLE_NAME));
  const missing = requiredTables.filter((tableName) => !existing.has(tableName));

  if (missing.length) {
    throw appError(
      `Release 3 Group Configuration migration is required. Missing: ${missing.join(
        ", "
      )}.`,
      503,
      "GROUP_CONFIGURATION_MIGRATION_REQUIRED"
    );
  }
}

async function listConfiguration() {
  await ensureConfigurationTables();

  const [rows] = await pool.query(
    `SELECT
       gc.*,
       u.full_name AS updated_by_name
     FROM group_configuration gc
     LEFT JOIN users u ON u.id = gc.updated_by
     WHERE gc.is_sensitive = FALSE
     ORDER BY gc.setting_group ASC, gc.sort_order ASC, gc.setting_key ASC`
  );

  return rows.map(publicSetting);
}

async function getConfigurationMap() {
  const rows = await listConfiguration();

  return Object.fromEntries(
    rows.map((row) => [row.setting_key, row.value])
  );
}

async function getSetting(settingKey, fallback = null) {
  const key = cleanText(settingKey, 120);

  const [rows] = await pool.query(
    `SELECT *
     FROM group_configuration
     WHERE setting_key = ?
       AND is_sensitive = FALSE
     LIMIT 1`,
    [key]
  );

  if (!rows.length) return fallback;

  return deserializeSettingValue(rows[0].value_text, rows[0].value_type);
}

async function updateSetting({
  settingKey,
  value,
  reason,
  userId,
  req,
}) {
  const key = cleanText(settingKey, 120);
  const cleanReason = cleanText(reason, 500);

  if (!key) {
    throw appError("Setting key is required.");
  }

  if (cleanReason.length < 5) {
    throw appError("Enter a clear change reason of at least 5 characters.");
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await ensureConfigurationTables(connection);

    const [rows] = await connection.query(
      `SELECT *
       FROM group_configuration
       WHERE setting_key = ?
       LIMIT 1
       FOR UPDATE`,
      [key]
    );

    const row = rows[0];

    if (!row) {
      throw appError("The requested configuration setting was not found.", 404);
    }

    if (Boolean(Number(row.is_sensitive))) {
      throw appError(
        "Sensitive configuration cannot be displayed or changed here.",
        403,
        "SENSITIVE_CONFIGURATION_FORBIDDEN"
      );
    }

    if (!Boolean(Number(row.is_editable))) {
      throw appError("This configuration setting is read-only.", 403);
    }

    const normalizedValue = normalizeSettingValue(row, value);
    const oldValue = row.value_text ?? "";

    if (String(oldValue) === String(normalizedValue)) {
      await connection.commit();

      return {
        changed: false,
        setting: publicSetting(row),
      };
    }

    await connection.query(
      `UPDATE group_configuration
       SET value_text = ?,
           updated_by = ?,
           updated_at = NOW()
       WHERE setting_key = ?`,
      [normalizedValue, userId || null, key]
    );

    await connection.query(
      `INSERT INTO group_configuration_history (
         setting_key,
         old_value_text,
         new_value_text,
         change_reason,
         changed_by,
         request_id,
         ip_address,
         user_agent,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        key,
        oldValue,
        normalizedValue,
        cleanReason,
        userId || null,
        req?.requestId || null,
        requestIp(req),
        requestUserAgent(req),
      ]
    );

    await connection.commit();

    const [updatedRows] = await pool.query(
      `SELECT
         gc.*,
         u.full_name AS updated_by_name
       FROM group_configuration gc
       LEFT JOIN users u ON u.id = gc.updated_by
       WHERE gc.setting_key = ?
       LIMIT 1`,
      [key]
    );

    return {
      changed: true,
      old_value: deserializeSettingValue(oldValue, row.value_type),
      setting: publicSetting(updatedRows[0]),
    };
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

async function listConfigurationHistory(limit = 100) {
  await ensureConfigurationTables();

  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 300));

  const [rows] = await pool.query(
    `SELECT
       h.*,
       gc.setting_label,
       gc.setting_group,
       gc.value_type,
       u.full_name AS changed_by_name,
       u.username AS changed_by_username
     FROM group_configuration_history h
     INNER JOIN group_configuration gc
       ON gc.setting_key = h.setting_key
     LEFT JOIN users u
       ON u.id = h.changed_by
     ORDER BY h.id DESC
     LIMIT ?`,
    [safeLimit]
  );

  return rows.map((row) => ({
    id: row.id,
    setting_key: row.setting_key,
    setting_label: row.setting_label,
    setting_group: row.setting_group,
    old_value: deserializeSettingValue(
      row.old_value_text,
      row.value_type
    ),
    new_value: deserializeSettingValue(
      row.new_value_text,
      row.value_type
    ),
    change_reason: row.change_reason,
    changed_by: row.changed_by,
    changed_by_name:
      row.changed_by_name || row.changed_by_username || "System",
    request_id: row.request_id,
    ip_address: row.ip_address,
    created_at: row.created_at,
  }));
}

function publicSequence(row) {
  return {
    sequence_code: row.sequence_code,
    workspace_code: row.workspace_code,
    document_name: row.document_name,
    prefix: row.prefix,
    next_number: Number(row.next_number || 1),
    padding: Number(row.padding || 6),
    reset_policy: row.reset_policy,
    last_reset_key: row.last_reset_key,
    include_year: Boolean(Number(row.include_year)),
    include_month: Boolean(Number(row.include_month)),
    separator: row.number_separator,
    is_active: Boolean(Number(row.is_active)),
    updated_at: row.updated_at || null,
    updated_by_name: row.updated_by_name || null,
  };
}

function sequenceResetKey(sequence, date = new Date()) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");

  if (sequence.reset_policy === "month") return `${year}${month}`;
  if (sequence.reset_policy === "year") return year;

  return null;
}

function formatDocumentNumber(sequence, number, date = new Date()) {
  const separator = sequence.number_separator || sequence.separator || "-";
  const parts = [sequence.prefix];

  if (Boolean(Number(sequence.include_year))) {
    parts.push(String(date.getUTCFullYear()));
  }

  if (Boolean(Number(sequence.include_month))) {
    parts.push(String(date.getUTCMonth() + 1).padStart(2, "0"));
  }

  parts.push(
    String(number).padStart(
      Math.max(2, Math.min(Number(sequence.padding) || 6, 10)),
      "0"
    )
  );

  return parts.join(separator);
}

async function listSequences() {
  await ensureConfigurationTables();

  const [rows] = await pool.query(
    `SELECT
       ds.*,
       u.full_name AS updated_by_name
     FROM document_sequences ds
     LEFT JOIN users u ON u.id = ds.updated_by
     ORDER BY ds.workspace_code ASC, ds.document_name ASC`
  );

  return rows.map((row) => ({
    ...publicSequence(row),
    preview_number: formatDocumentNumber(
      row,
      Number(row.next_number || 1),
      new Date()
    ),
  }));
}

function normalizeSequenceDefinition(current, changes = {}) {
  const prefix = cleanText(changes.prefix ?? current.prefix, 30).toUpperCase();
  const padding = Number(changes.padding ?? current.padding);
  const resetPolicy = cleanText(
    changes.reset_policy ?? current.reset_policy,
    20
  ).toLowerCase();
  const separator = cleanText(
    changes.separator ?? current.number_separator,
    5
  );
  const nextNumber = Number(changes.next_number ?? current.next_number);

  if (!SAFE_PREFIX.test(prefix)) {
    throw appError(
      "Sequence prefix may contain only uppercase letters, numbers, underscores and hyphens."
    );
  }

  if (!Number.isInteger(padding) || padding < 2 || padding > 10) {
    throw appError("Sequence padding must be between 2 and 10.");
  }

  if (!["none", "year", "month"].includes(resetPolicy)) {
    throw appError("Sequence reset policy must be none, year or month.");
  }

  if (!SAFE_SEPARATOR.test(separator)) {
    throw appError("Sequence separator must use -, _ or /.");
  }

  if (!Number.isInteger(nextNumber) || nextNumber < 1) {
    throw appError("The next sequence number must be a positive whole number.");
  }

  return {
    prefix,
    padding,
    reset_policy: resetPolicy,
    separator,
    next_number: nextNumber,
    include_year: booleanValue(
      changes.include_year ?? current.include_year
    ),
    include_month: booleanValue(
      changes.include_month ?? current.include_month
    ),
    is_active: booleanValue(changes.is_active ?? current.is_active),
  };
}

async function updateSequence({
  sequenceCode,
  changes,
  reason,
  userId,
  req,
}) {
  const code = cleanText(sequenceCode, 40).toUpperCase();
  const cleanReason = cleanText(reason, 500);

  if (!SAFE_SEQUENCE_CODE.test(code)) {
    throw appError("Invalid document sequence code.");
  }

  if (cleanReason.length < 5) {
    throw appError("Enter a clear sequence-change reason.");
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await ensureConfigurationTables(connection);

    const [rows] = await connection.query(
      `SELECT *
       FROM document_sequences
       WHERE sequence_code = ?
       LIMIT 1
       FOR UPDATE`,
      [code]
    );

    const current = rows[0];

    if (!current) {
      throw appError("Document sequence not found.", 404);
    }

    const normalized = normalizeSequenceDefinition(current, changes);
    const oldDefinition = publicSequence(current);

    await connection.query(
      `UPDATE document_sequences
       SET prefix = ?,
           next_number = ?,
           padding = ?,
           reset_policy = ?,
           include_year = ?,
           include_month = ?,
           number_separator = ?,
           is_active = ?,
           updated_by = ?,
           updated_at = NOW()
       WHERE sequence_code = ?`,
      [
        normalized.prefix,
        normalized.next_number,
        normalized.padding,
        normalized.reset_policy,
        normalized.include_year,
        normalized.include_month,
        normalized.separator,
        normalized.is_active,
        userId || null,
        code,
      ]
    );

    const [updatedRows] = await connection.query(
      `SELECT *
       FROM document_sequences
       WHERE sequence_code = ?
       LIMIT 1`,
      [code]
    );

    const newDefinition = publicSequence(updatedRows[0]);

    await connection.query(
      `INSERT INTO document_sequence_history (
         sequence_code,
         old_definition_json,
         new_definition_json,
         change_reason,
         changed_by,
         request_id,
         ip_address,
         user_agent,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        code,
        JSON.stringify(oldDefinition),
        JSON.stringify(newDefinition),
        cleanReason,
        userId || null,
        req?.requestId || null,
        requestIp(req),
        requestUserAgent(req),
      ]
    );

    await connection.commit();

    return {
      sequence: {
        ...newDefinition,
        preview_number: formatDocumentNumber(
          updatedRows[0],
          Number(updatedRows[0].next_number || 1),
          new Date()
        ),
      },
    };
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

async function nextDocumentNumber(
  sequenceCode,
  { date = new Date(), userId = null } = {}
) {
  const code = cleanText(sequenceCode, 40).toUpperCase();

  if (!SAFE_SEQUENCE_CODE.test(code)) {
    throw appError("Invalid document sequence code.");
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await ensureConfigurationTables(connection);

    const [rows] = await connection.query(
      `SELECT *
       FROM document_sequences
       WHERE sequence_code = ?
       LIMIT 1
       FOR UPDATE`,
      [code]
    );

    const sequence = rows[0];

    if (!sequence || !Boolean(Number(sequence.is_active))) {
      throw appError("Document sequence is unavailable.", 409);
    }

    const currentResetKey = sequenceResetKey(sequence, date);
    let number = Number(sequence.next_number || 1);

    if (
      currentResetKey &&
      sequence.last_reset_key !== currentResetKey
    ) {
      number = 1;
    }

    const documentNumber = formatDocumentNumber(sequence, number, date);

    await connection.query(
      `UPDATE document_sequences
       SET next_number = ?,
           last_reset_key = ?,
           updated_by = COALESCE(?, updated_by),
           updated_at = NOW()
       WHERE sequence_code = ?`,
      [number + 1, currentResetKey, userId, code]
    );

    await connection.commit();

    return documentNumber;
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

module.exports = {
  ensureConfigurationTables,
  listConfiguration,
  listConfigurationHistory,
  getConfigurationMap,
  getSetting,
  updateSetting,
  listSequences,
  updateSequence,
  nextDocumentNumber,
  formatDocumentNumber,
};