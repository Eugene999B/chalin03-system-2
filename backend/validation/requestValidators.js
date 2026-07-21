const RESTORE_CONFIRMATION_TEXT = "RESTORE_FULL_SYSTEM_BACKUP";
const PAYMENT_METHODS = new Set(["cash", "momo", "bank"]);
const RESERVED_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_]+$/;
const MONEY_PATTERN = /^\d{1,9}(?:\.\d{1,2})?$/;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_PAYMENT_AMOUNT = 999999999.99;
const MAX_NOTES_LENGTH = 500;
const MAX_BACKUP_TABLES = 500;
const MAX_BACKUP_ROWS = 5000000;

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function addError(errors, field, message, code = "INVALID_VALUE") {
  errors.push({ field, code, message });
}

function success(value) {
  return { ok: true, value, errors: [] };
}

function failure(errors) {
  return { ok: false, value: null, errors };
}

function parsePositiveInteger(value) {
  const normalized = String(value ?? "").trim();

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const number = Number(normalized);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function parseMoney(value) {
  const normalized = String(value ?? "").trim();

  if (!MONEY_PATTERN.test(normalized)) {
    return null;
  }

  const number = Number(normalized);
  if (!Number.isFinite(number) || number <= 0 || number > MAX_PAYMENT_AMOUNT) {
    return null;
  }

  return Number(number.toFixed(2));
}

function unknownKeys(object, allowedKeys) {
  return Object.keys(object).filter((key) => !allowedKeys.has(key));
}

function validateDebtPaymentRequest({ params, body }) {
  const errors = [];
  const debtId = parsePositiveInteger(params?.id);

  if (debtId === null) {
    addError(
      errors,
      "params.id",
      "Debt ID must be a positive whole number.",
      "INVALID_DEBT_ID"
    );
  }

  if (!isPlainObject(body)) {
    addError(
      errors,
      "body",
      "Payment details must be sent as a JSON object.",
      "INVALID_JSON_OBJECT"
    );
    return failure(errors);
  }

  const allowedKeys = new Set(["amount", "payment_method", "notes"]);
  for (const key of unknownKeys(body, allowedKeys)) {
    addError(
      errors,
      `body.${key}`,
      `Unknown payment field: ${key}.`,
      "UNKNOWN_FIELD"
    );
  }

  const amount = parseMoney(body.amount);
  if (amount === null) {
    addError(
      errors,
      "body.amount",
      "Payment amount must be greater than zero and contain no more than two decimal places.",
      "INVALID_PAYMENT_AMOUNT"
    );
  }

  const rawMethod = body.payment_method;
  const paymentMethod =
    rawMethod === undefined || rawMethod === null || rawMethod === ""
      ? "cash"
      : String(rawMethod).trim().toLowerCase();

  if (!PAYMENT_METHODS.has(paymentMethod)) {
    addError(
      errors,
      "body.payment_method",
      "Payment method must be cash, momo or bank.",
      "INVALID_PAYMENT_METHOD"
    );
  }

  let notes = null;
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== "string") {
      addError(
        errors,
        "body.notes",
        "Payment notes must be text.",
        "INVALID_NOTES"
      );
    } else {
      notes = body.notes.trim() || null;
      if (notes && notes.length > MAX_NOTES_LENGTH) {
        addError(
          errors,
          "body.notes",
          `Payment notes cannot exceed ${MAX_NOTES_LENGTH} characters.`,
          "NOTES_TOO_LONG"
        );
      }
    }
  }

  if (errors.length > 0) {
    return failure(errors);
  }

  return success({
    params: { id: debtId },
    body: {
      amount,
      payment_method: paymentMethod,
      notes,
    },
  });
}

function validateIdentifier(value, field, errors) {
  const normalized = String(value ?? "");

  if (
    !SAFE_IDENTIFIER_PATTERN.test(normalized) ||
    RESERVED_OBJECT_KEYS.has(normalized)
  ) {
    addError(
      errors,
      field,
      `${field} contains an unsafe identifier.`,
      "UNSAFE_IDENTIFIER"
    );
    return false;
  }

  return true;
}

function validateBackupShape(backup, errors) {
  if (!isPlainObject(backup)) {
    addError(
      errors,
      "backup",
      "Backup data must be a JSON object.",
      "INVALID_BACKUP_OBJECT"
    );
    return;
  }

  for (const key of Object.keys(backup)) {
    if (RESERVED_OBJECT_KEYS.has(key)) {
      addError(
        errors,
        `backup.${key}`,
        "Backup data contains a reserved object key.",
        "RESERVED_OBJECT_KEY"
      );
    }
  }

  if (backup.backup_type !== "full_system_backup") {
    addError(
      errors,
      "backup.backup_type",
      "Only a Chalin 03 full-system backup can be validated or restored.",
      "INVALID_BACKUP_TYPE"
    );
  }

  if (!isPlainObject(backup.tables)) {
    addError(
      errors,
      "backup.tables",
      "Backup tables must be a JSON object.",
      "INVALID_BACKUP_TABLES"
    );
    return;
  }

  const tableNames = Object.keys(backup.tables);
  if (tableNames.length === 0) {
    addError(
      errors,
      "backup.tables",
      "Backup does not contain any tables.",
      "EMPTY_BACKUP"
    );
  }

  if (tableNames.length > MAX_BACKUP_TABLES) {
    addError(
      errors,
      "backup.tables",
      `Backup cannot contain more than ${MAX_BACKUP_TABLES} tables.`,
      "TOO_MANY_TABLES"
    );
  }

  let totalRows = 0;
  for (const tableName of tableNames) {
    if (!validateIdentifier(tableName, `backup.tables.${tableName}`, errors)) {
      continue;
    }

    const rows = backup.tables[tableName];
    if (!Array.isArray(rows)) {
      addError(
        errors,
        `backup.tables.${tableName}`,
        `Backup table ${tableName} must contain an array of rows.`,
        "INVALID_TABLE_ROWS"
      );
      continue;
    }

    totalRows += rows.length;
    if (totalRows > MAX_BACKUP_ROWS) {
      addError(
        errors,
        "backup.tables",
        `Backup cannot contain more than ${MAX_BACKUP_ROWS} total rows.`,
        "TOO_MANY_ROWS"
      );
      break;
    }

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!isPlainObject(row)) {
        addError(
          errors,
          `backup.tables.${tableName}[${index}]`,
          "Every backup row must be a JSON object.",
          "INVALID_BACKUP_ROW"
        );
        continue;
      }

      for (const columnName of Object.keys(row)) {
        validateIdentifier(
          columnName,
          `backup.tables.${tableName}[${index}].${columnName}`,
          errors
        );
      }
    }
  }

  if (
    backup.checksum_sha256 !== undefined &&
    backup.checksum_sha256 !== null &&
    !CHECKSUM_PATTERN.test(String(backup.checksum_sha256).trim())
  ) {
    addError(
      errors,
      "backup.checksum_sha256",
      "Backup checksum must be a 64-character SHA-256 value.",
      "INVALID_CHECKSUM"
    );
  }

  if (backup.included_tables !== undefined) {
    if (!Array.isArray(backup.included_tables)) {
      addError(
        errors,
        "backup.included_tables",
        "Included tables must be an array.",
        "INVALID_INCLUDED_TABLES"
      );
    } else {
      const seen = new Set();
      for (let index = 0; index < backup.included_tables.length; index += 1) {
        const tableName = backup.included_tables[index];
        validateIdentifier(
          tableName,
          `backup.included_tables[${index}]`,
          errors
        );
        if (seen.has(tableName)) {
          addError(
            errors,
            `backup.included_tables[${index}]`,
            `Duplicate included table: ${tableName}.`,
            "DUPLICATE_TABLE"
          );
        }
        seen.add(tableName);
      }
    }
  }

  if (backup.table_counts !== undefined) {
    if (!isPlainObject(backup.table_counts)) {
      addError(
        errors,
        "backup.table_counts",
        "Backup table counts must be a JSON object.",
        "INVALID_TABLE_COUNTS"
      );
    } else {
      for (const [tableName, value] of Object.entries(backup.table_counts)) {
        validateIdentifier(tableName, `backup.table_counts.${tableName}`, errors);
        const count = Number(value);
        if (!Number.isSafeInteger(count) || count < 0) {
          addError(
            errors,
            `backup.table_counts.${tableName}`,
            "Backup table counts must be non-negative whole numbers.",
            "INVALID_TABLE_COUNT"
          );
        }
      }
    }
  }

  if (backup.total_record_count !== undefined) {
    const totalRecordCount = Number(backup.total_record_count);
    if (!Number.isSafeInteger(totalRecordCount) || totalRecordCount < 0) {
      addError(
        errors,
        "backup.total_record_count",
        "Total record count must be a non-negative whole number.",
        "INVALID_TOTAL_RECORD_COUNT"
      );
    }
  }

  if (
    backup.created_at !== undefined &&
    Number.isNaN(new Date(backup.created_at).getTime())
  ) {
    addError(
      errors,
      "backup.created_at",
      "Backup creation date is invalid.",
      "INVALID_BACKUP_DATE"
    );
  }
}

function validateBackupEnvelope({ body, requireConfirmation }) {
  const errors = [];

  if (!isPlainObject(body)) {
    addError(
      errors,
      "body",
      "Backup request must be sent as a JSON object.",
      "INVALID_JSON_OBJECT"
    );
    return failure(errors);
  }

  const wrapped = hasOwn(body, "backup");
  let backup = body;

  if (wrapped) {
    const allowedEnvelopeKeys = new Set([
      "backup",
      "confirmation",
      "restore_confirmation",
    ]);

    for (const key of unknownKeys(body, allowedEnvelopeKeys)) {
      addError(
        errors,
        `body.${key}`,
        `Unknown backup request field: ${key}.`,
        "UNKNOWN_FIELD"
      );
    }

    backup = body.backup;
  }

  const confirmation = body.confirmation ?? body.restore_confirmation;
  if (
    hasOwn(body, "confirmation") &&
    hasOwn(body, "restore_confirmation") &&
    body.confirmation !== body.restore_confirmation
  ) {
    addError(
      errors,
      "body.confirmation",
      "Restore confirmation fields do not match.",
      "CONFIRMATION_MISMATCH"
    );
  }

  if (requireConfirmation && confirmation !== RESTORE_CONFIRMATION_TEXT) {
    addError(
      errors,
      "body.confirmation",
      "Restore confirmation is required. Type RESTORE_FULL_SYSTEM_BACKUP before restoring.",
      "RESTORE_CONFIRMATION_REQUIRED"
    );
  }

  validateBackupShape(backup, errors);

  if (errors.length > 0) {
    return failure(errors);
  }

  return success({
    backup,
    confirmation: confirmation || null,
  });
}

function validateBackupDryRunRequest({ body }) {
  return validateBackupEnvelope({ body, requireConfirmation: false });
}

function validateBackupRestoreRequest({ body }) {
  return validateBackupEnvelope({ body, requireConfirmation: true });
}

module.exports = {
  MAX_BACKUP_ROWS,
  MAX_BACKUP_TABLES,
  MAX_NOTES_LENGTH,
  MAX_PAYMENT_AMOUNT,
  RESTORE_CONFIRMATION_TEXT,
  isPlainObject,
  parseMoney,
  parsePositiveInteger,
  validateBackupDryRunRequest,
  validateBackupRestoreRequest,
  validateDebtPaymentRequest,
};
