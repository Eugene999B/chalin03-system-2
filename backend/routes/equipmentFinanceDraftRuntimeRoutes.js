const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  calculateDraftProgress,
} = require("../services/equipmentFinanceOperationalPolishService");

const router = express.Router();
const ROUTE = "/operational-polish/drafts/start-installment";
const DRAFT_KEY = "start-installment";
const CONNECTION_DEADLINE_MS = 7000;
const REQUIRED_DRAFT_COLUMNS = Object.freeze([
  "id",
  "user_id",
  "draft_key",
  "application_id",
  "customer_id",
  "asset_id",
  "payload_json",
  "progress_json",
  "completion_percent",
  "version_no",
  "last_saved_at",
  "submitted_at",
  "archived_at",
  "created_at",
  "updated_at",
]);

class FinanceDraftRuntimeError extends Error {
  constructor(statusCode, message, code, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanText(value, maximum = 120) {
  return String(value ?? "").trim().slice(0, maximum);
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function userId(req) {
  return positiveId(req.user?.id);
}

function publicDraft(row) {
  if (!row) return null;
  return {
    id: row.id,
    draft_key: row.draft_key,
    application_id: row.application_id,
    customer_id: row.customer_id,
    asset_id: row.asset_id,
    payload: parseJson(row.payload_json, {}),
    progress: parseJson(row.progress_json, {}),
    completion_percent: Number(row.completion_percent || 0),
    version: Number(row.version_no || 1),
    last_saved_at: row.last_saved_at,
    created_at: row.created_at,
  };
}

async function acquireConnection(deadlineMs = CONNECTION_DEADLINE_MS) {
  const pendingConnection = pool.getConnection();
  let timedOut = false;
  let timer;

  try {
    return await Promise.race([
      pendingConnection,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(
            new FinanceDraftRuntimeError(
              503,
              "Finance draft storage is busy. The device copy remains protected.",
              "FINANCE_DRAFT_CONNECTION_TIMEOUT"
            )
          );
        }, deadlineMs);
      }),
    ]);
  } catch (error) {
    if (timedOut) {
      pendingConnection
        .then((connection) => connection.release())
        .catch(() => undefined);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function draftSchemaStatus(connection) {
  const [tableRows] = await connection.query(
    `SELECT COUNT(*) AS present
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_finance_case_drafts'`
  );
  const tablePresent = Number(tableRows[0]?.present || 0) === 1;
  if (!tablePresent) {
    return {
      ready: false,
      missing_tables: ["equipment_finance_case_drafts"],
      missing_columns: [],
      migration: "20260731_equipment_finance_operational_polish",
    };
  }

  const [columnRows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_finance_case_drafts'`
  );
  const columns = new Set(columnRows.map((row) => row.COLUMN_NAME));
  const missingColumns = REQUIRED_DRAFT_COLUMNS.filter(
    (column) => !columns.has(column)
  ).map((column) => `equipment_finance_case_drafts.${column}`);

  return {
    ready: missingColumns.length === 0,
    missing_tables: [],
    missing_columns: missingColumns,
    migration: "20260731_equipment_finance_operational_polish",
  };
}

async function getDraftFrom(connection, signedInUserId, draftKey = DRAFT_KEY) {
  const [rows] = await connection.query(
    `SELECT id, user_id, draft_key, application_id, customer_id, asset_id,
            payload_json, progress_json, completion_percent, version_no,
            last_saved_at, created_at
       FROM equipment_finance_case_drafts
      WHERE user_id = ?
        AND draft_key = ?
        AND archived_at IS NULL
      LIMIT 1`,
    [signedInUserId, cleanText(draftKey)]
  );
  return publicDraft(rows[0] || null);
}

function degradedPayload(code, message, details = null) {
  return {
    status: "degraded",
    code,
    message,
    server_draft_available: false,
    server_saved: false,
    device_copy_protected: true,
    ...(details ? { readiness: details } : {}),
  };
}

function sendRuntimeFailure(res, error, fallback) {
  if (error instanceof FinanceDraftRuntimeError && error.statusCode < 500) {
    return res.status(error.statusCode).json({
      status: "error",
      code: error.code,
      message: error.message,
      ...(error.details ? { current_draft: error.details } : {}),
    });
  }

  const foundationError = ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(
    error?.code
  );
  const code = foundationError
    ? "FINANCE_DRAFT_SCHEMA_INCOMPLETE"
    : error?.code || "FINANCE_DRAFT_RUNTIME_UNAVAILABLE";
  const message = foundationError
    ? "Finance server draft storage is incomplete. The device copy remains protected while the approved schema is repaired."
    : error?.message || fallback;

  console.error("Finance draft runtime fallback:", {
    code,
    message: error?.message,
  });

  // Autosave infrastructure must never prevent the staff member from opening
  // or completing the local draft. A truthful degraded response avoids the
  // global 5xx sanitizer hiding the actionable state.
  return res.status(202).json(degradedPayload(code, message));
}

router.get(
  ROUTE,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    const signedInUserId = userId(req);
    if (!signedInUserId) {
      return res.status(401).json({
        status: "error",
        code: "FINANCE_DRAFT_USER_REQUIRED",
        message: "A signed-in Finance user is required.",
      });
    }

    let connection;
    try {
      connection = await acquireConnection();
      const readiness = await draftSchemaStatus(connection);
      if (!readiness.ready) {
        return res.status(200).json(
          degradedPayload(
            "FINANCE_DRAFT_SCHEMA_INCOMPLETE",
            "Server draft recovery is unavailable, but this device can continue the installment draft.",
            readiness
          )
        );
      }

      const draft = await getDraftFrom(connection, signedInUserId);
      return res.json({
        status: "success",
        draft,
        server_draft_available: true,
        server_saved: Boolean(draft),
        device_copy_protected: true,
      });
    } catch (error) {
      return sendRuntimeFailure(
        res,
        error,
        "Server draft recovery is temporarily unavailable. The device copy remains protected."
      );
    } finally {
      connection?.release();
    }
  }
);

router.put(
  ROUTE,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    const signedInUserId = userId(req);
    const payload = req.body?.payload;
    if (
      !signedInUserId ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      return res.status(400).json({
        status: "error",
        code: "FINANCE_DRAFT_PAYLOAD_REQUIRED",
        message: "A valid signed-in installment draft is required.",
      });
    }

    let connection;
    let transactionActive = false;
    try {
      connection = await acquireConnection();
      const readiness = await draftSchemaStatus(connection);
      if (!readiness.ready) {
        return res.status(202).json(
          degradedPayload(
            "FINANCE_DRAFT_SCHEMA_INCOMPLETE",
            "The server could not store this draft yet. The complete device copy remains protected.",
            readiness
          )
        );
      }

      const progress = calculateDraftProgress(payload);
      await connection.beginTransaction();
      transactionActive = true;

      const [rows] = await connection.query(
        `SELECT id, version_no, payload_json, progress_json, last_saved_at
           FROM equipment_finance_case_drafts
          WHERE user_id = ? AND draft_key = ?
          LIMIT 1 FOR UPDATE`,
        [signedInUserId, DRAFT_KEY]
      );
      const current = rows[0] || null;
      const knownVersion = req.body?.known_version;
      if (
        current &&
        knownVersion !== null &&
        knownVersion !== undefined &&
        Number(knownVersion) !== Number(current.version_no)
      ) {
        throw new FinanceDraftRuntimeError(
          409,
          "This draft changed in another session. Review the latest saved version before continuing.",
          "FINANCE_DRAFT_VERSION_CONFLICT",
          {
            id: current.id,
            payload: parseJson(current.payload_json, {}),
            progress: parseJson(current.progress_json, {}),
            version: Number(current.version_no || 1),
            last_saved_at: current.last_saved_at,
          }
        );
      }

      const values = [
        positiveId(payload.application_id),
        positiveId(payload.customer_id),
        positiveId(payload.asset_id),
        safeJson(payload),
        safeJson(progress),
        Number(progress.completion_percent || 0),
      ];

      if (current) {
        await connection.query(
          `UPDATE equipment_finance_case_drafts
              SET application_id = ?, customer_id = ?, asset_id = ?,
                  payload_json = ?, progress_json = ?, completion_percent = ?,
                  version_no = version_no + 1, last_saved_at = NOW(),
                  archived_at = NULL, submitted_at = NULL
            WHERE id = ?`,
          [...values, current.id]
        );
      } else {
        await connection.query(
          `INSERT INTO equipment_finance_case_drafts (
             user_id, draft_key, application_id, customer_id, asset_id,
             payload_json, progress_json, completion_percent, version_no,
             last_saved_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
          [signedInUserId, DRAFT_KEY, ...values]
        );
      }

      await connection.commit();
      transactionActive = false;

      // Critical production fix: read the committed row through the SAME
      // connection. The retired implementation held this connection and asked
      // the pool for a second one, which could deadlock under concurrent saves.
      const draft = await getDraftFrom(connection, signedInUserId);
      return res.json({
        status: "success",
        message: "Installment draft saved securely to the server.",
        draft,
        server_draft_available: true,
        server_saved: true,
        device_copy_protected: true,
      });
    } catch (error) {
      if (transactionActive && connection) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the original failure.
        }
      }
      return sendRuntimeFailure(
        res,
        error,
        "Server autosave is temporarily unavailable. The device copy remains protected."
      );
    } finally {
      connection?.release();
    }
  }
);

router.delete(
  ROUTE,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    const signedInUserId = userId(req);
    if (!signedInUserId) {
      return res.status(401).json({
        status: "error",
        code: "FINANCE_DRAFT_USER_REQUIRED",
        message: "A signed-in Finance user is required.",
      });
    }

    let connection;
    try {
      connection = await acquireConnection();
      const readiness = await draftSchemaStatus(connection);
      if (!readiness.ready) {
        return res.status(202).json(
          degradedPayload(
            "FINANCE_DRAFT_SCHEMA_INCOMPLETE",
            "No server draft could be archived. The device draft can still be cleared locally.",
            readiness
          )
        );
      }
      const submitted = String(req.query.submitted || "").toLowerCase() === "true";
      const [result] = await connection.query(
        `UPDATE equipment_finance_case_drafts
            SET archived_at = NOW(),
                submitted_at = CASE WHEN ? THEN NOW() ELSE submitted_at END
          WHERE user_id = ? AND draft_key = ? AND archived_at IS NULL`,
        [submitted ? 1 : 0, signedInUserId, DRAFT_KEY]
      );
      return res.json({
        status: "success",
        message: Number(result.affectedRows || 0)
          ? "Server draft archived."
          : "No active server draft remained.",
        archived: Number(result.affectedRows || 0) > 0,
        server_draft_available: true,
      });
    } catch (error) {
      return sendRuntimeFailure(
        res,
        error,
        "The server draft could not be archived."
      );
    } finally {
      connection?.release();
    }
  }
);

module.exports = router;
module.exports.acquireConnection = acquireConnection;
module.exports.draftSchemaStatus = draftSchemaStatus;
module.exports.getDraftFrom = getDraftFrom;
module.exports.REQUIRED_DRAFT_COLUMNS = REQUIRED_DRAFT_COLUMNS;
