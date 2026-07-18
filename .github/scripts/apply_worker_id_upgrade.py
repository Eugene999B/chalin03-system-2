from __future__ import annotations

import re
import shutil
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Could not locate patch target: {label}")
    return text.replace(old, new, 1)


def replace_regex(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"Could not locate regex patch target: {label} (matches={count})")
    return updated


SERVICE = r'''const { pool } = require("../config/db");

const DEFAULT_VALIDITY_MONTHS = 24;
const DEFAULT_PREFIX = "CH03";
const WORKSPACE_SEGMENTS = Object.freeze({
  spare_parts: "SP",
  mining: "MN",
  equipment_hire: "EH",
});

let schemaPromise = null;

function cleanText(value, maxLength = 80) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeEmployeePrefix(value) {
  const normalized = cleanText(value, 20)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 12);
  return normalized || DEFAULT_PREFIX;
}

function normalizeValidityMonths(value) {
  const months = Number(value);
  return Number.isInteger(months) && months >= 1 && months <= 120
    ? months
    : DEFAULT_VALIDITY_MONTHS;
}

function workspaceSegment(workspaceCode) {
  return WORKSPACE_SEGMENTS[String(workspaceCode || "").trim().toLowerCase()] || "GRP";
}

function dateOnly(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function calculateCardDates(issueValue = new Date(), validityMonths = DEFAULT_VALIDITY_MONTHS) {
  const issueDate = dateOnly(issueValue);
  const issue = new Date(`${issueDate}T00:00:00.000Z`);
  issue.setUTCMonth(issue.getUTCMonth() + normalizeValidityMonths(validityMonths));
  return {
    issueDate,
    expiryDate: issue.toISOString().slice(0, 10),
  };
}

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function ensureWorkerIdentitySchema() {
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    if (!(await columnExists("settings", "worker_id_card_validity_months"))) {
      await pool.query(
        `ALTER TABLE settings
         ADD COLUMN worker_id_card_validity_months INT NOT NULL DEFAULT 24`
      );
    }

    if (!(await columnExists("settings", "worker_employee_number_prefix"))) {
      await pool.query(
        `ALTER TABLE settings
         ADD COLUMN worker_employee_number_prefix VARCHAR(20) NOT NULL DEFAULT 'CH03'`
      );
    }

    await pool.query(
      `CREATE TABLE IF NOT EXISTS worker_identity_sequences (
         workspace_code VARCHAR(50) NOT NULL PRIMARY KEY,
         last_number INT NOT NULL DEFAULT 0,
         updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
       )`
    );

    try {
      await pool.query(
        `INSERT IGNORE INTO schema_migrations (migration_name, description)
         VALUES (
           '20260718_release3fd2_worker_identity_cards',
           'Automatic employee numbers, settings-driven card validity and premium worker ID cards.'
         )`
      );
    } catch (error) {
      if (error.code !== "ER_NO_SUCH_TABLE") throw error;
    }
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

async function loadWorkerIdentitySettings(connection = pool) {
  await ensureWorkerIdentitySchema();
  const [rows] = await connection.query(
    `SELECT
       id,
       business_name,
       business_address,
       business_phone,
       owner_phone,
       worker_id_card_validity_months,
       worker_employee_number_prefix
     FROM settings
     ORDER BY CASE WHEN branch_id = 1 THEN 0 ELSE 1 END, id ASC
     LIMIT 1`
  );

  const settings = rows[0] || {};
  return {
    settingsId: settings.id || null,
    businessName: cleanText(settings.business_name, 150) || "Chalin 03 Company Limited",
    businessAddress: cleanText(settings.business_address, 255) || "Dunkwa Police Barrier, Ghana",
    businessPhone:
      cleanText(settings.business_phone, 80) ||
      cleanText(settings.owner_phone, 80) ||
      "0249469080",
    validityMonths: normalizeValidityMonths(settings.worker_id_card_validity_months),
    employeePrefix: normalizeEmployeePrefix(settings.worker_employee_number_prefix),
  };
}

function formatEmployeeNumber(prefix, workspaceCode, sequenceNumber) {
  return `${normalizeEmployeePrefix(prefix)}-${workspaceSegment(workspaceCode)}-${String(
    Math.max(1, Number(sequenceNumber || 1))
  ).padStart(4, "0")}`;
}

async function allocateWorkerIdentity(connection, workspaceCode, issueValue = new Date()) {
  const settings = await loadWorkerIdentitySettings(connection);
  const workspace = cleanText(workspaceCode, 50).toLowerCase() || "spare_parts";

  await connection.query(
    `INSERT INTO worker_identity_sequences (workspace_code, last_number)
     VALUES (?, 0)
     ON DUPLICATE KEY UPDATE workspace_code = VALUES(workspace_code)`,
    [workspace]
  );

  const [sequenceRows] = await connection.query(
    `SELECT last_number
     FROM worker_identity_sequences
     WHERE workspace_code = ?
     LIMIT 1
     FOR UPDATE`,
    [workspace]
  );

  const nextNumber = Number(sequenceRows[0]?.last_number || 0) + 1;
  await connection.query(
    `UPDATE worker_identity_sequences
     SET last_number = ?
     WHERE workspace_code = ?`,
    [nextNumber, workspace]
  );

  const employeeNumber = formatEmployeeNumber(
    settings.employeePrefix,
    workspace,
    nextNumber
  );
  const dates = calculateCardDates(issueValue, settings.validityMonths);

  return {
    employeeNumber,
    cardSerial: employeeNumber,
    issueDate: dates.issueDate,
    expiryDate: dates.expiryDate,
    validityMonths: settings.validityMonths,
    employeePrefix: settings.employeePrefix,
  };
}

async function cardDatesForReissue(issueValue = new Date()) {
  const settings = await loadWorkerIdentitySettings();
  return {
    ...calculateCardDates(issueValue, settings.validityMonths),
    validityMonths: settings.validityMonths,
  };
}

module.exports = {
  DEFAULT_PREFIX,
  DEFAULT_VALIDITY_MONTHS,
  allocateWorkerIdentity,
  calculateCardDates,
  cardDatesForReissue,
  ensureWorkerIdentitySchema,
  formatEmployeeNumber,
  loadWorkerIdentitySettings,
  normalizeEmployeePrefix,
  normalizeValidityMonths,
  workspaceSegment,
};
'''

MIGRATION = r'''-- CHALIN 03 RELEASE 3F-D2
-- Premium worker identity cards, automatic employee numbering and settings-driven validity.
-- ADDITIVE / IDEMPOTENT ONLY. Existing worker records are preserved.

SET @validity_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'settings'
    AND COLUMN_NAME = 'worker_id_card_validity_months'
);
SET @validity_sql = IF(
  @validity_column_exists = 0,
  'ALTER TABLE settings ADD COLUMN worker_id_card_validity_months INT NOT NULL DEFAULT 24',
  'SELECT 1'
);
PREPARE validity_statement FROM @validity_sql;
EXECUTE validity_statement;
DEALLOCATE PREPARE validity_statement;

SET @prefix_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'settings'
    AND COLUMN_NAME = 'worker_employee_number_prefix'
);
SET @prefix_sql = IF(
  @prefix_column_exists = 0,
  'ALTER TABLE settings ADD COLUMN worker_employee_number_prefix VARCHAR(20) NOT NULL DEFAULT ''CH03''',
  'SELECT 1'
);
PREPARE prefix_statement FROM @prefix_sql;
EXECUTE prefix_statement;
DEALLOCATE PREPARE prefix_statement;

CREATE TABLE IF NOT EXISTS worker_identity_sequences (
  workspace_code VARCHAR(50) NOT NULL PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

UPDATE settings
SET worker_id_card_validity_months = COALESCE(worker_id_card_validity_months, 24),
    worker_employee_number_prefix = COALESCE(NULLIF(worker_employee_number_prefix, ''), 'CH03');

INSERT IGNORE INTO schema_migrations (migration_name, description)
VALUES (
  '20260718_release3fd2_worker_identity_cards',
  'Automatic employee numbers, settings-driven card validity and premium worker ID cards.'
);
'''

TEST = r'''const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  calculateCardDates,
  formatEmployeeNumber,
  normalizeEmployeePrefix,
} = require("../services/workerIdentityService");

const ROOT = path.resolve(__dirname, "..", "..");
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Release 3F-D2 formats automatic employee numbers by workspace", () => {
  assert.equal(formatEmployeeNumber("ch 03", "spare_parts", 1), "CH03-SP-0001");
  assert.equal(formatEmployeeNumber("CH03", "mining", 12), "CH03-MN-0012");
  assert.equal(formatEmployeeNumber("CH03", "equipment_hire", 203), "CH03-EH-0203");
  assert.equal(normalizeEmployeePrefix(" company-03 "), "COMPANY03");
});

test("Release 3F-D2 calculates settings-driven card validity", () => {
  assert.deepEqual(calculateCardDates("2026-07-18", 24), {
    issueDate: "2026-07-18",
    expiryDate: "2028-07-18",
  });
});

test("Release 3F-D2 migration is additive and preserves worker data", () => {
  const migration = read(
    "database/migrations/20260718_release3fd2_worker_identity_cards.sql"
  );
  assert.match(migration, /worker_id_card_validity_months/);
  assert.match(migration, /worker_employee_number_prefix/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS worker_identity_sequences/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM worker_profiles/i);
});

test("Release 3F-D2 worker creation allocates identity and supports reissue", () => {
  const routes = read("backend/routes/workerProfileExpansionRoutes.js");
  assert.match(routes, /allocateWorkerIdentity/);
  assert.match(routes, /reissue-id-card/);
  assert.match(routes, /WORKER_ID_CARD_REISSUED/);
  assert.match(routes, /employee_number_is_automatic/);
});

test("Release 3F-D2 settings expose prefix and card lifespan", () => {
  const routes = read("backend/routes/settingsRoutes.js");
  const page = read("frontend/src/pages/UsersSettingsPage.jsx");
  assert.match(routes, /worker_id_card_validity_months/);
  assert.match(routes, /worker_employee_number_prefix/);
  assert.match(page, /Worker Identity Cards/);
  assert.match(page, /Card lifespan/);
  assert.match(page, /Employee number prefix/);
});

test("Release 3F-D2 PDF uses the backend logo and premium company branding", () => {
  const printRoutes = read("backend/routes/workerPrintRoutes.js");
  assert.match(printRoutes, /backend[\\/]assets|assets[\\/]chalin03-logo\.png|"assets",\s*"chalin03-logo\.png"/);
  assert.match(printRoutes, /OFFICIAL PERSONNEL IDENTIFICATION/);
  assert.match(printRoutes, /data\.company\.name\.toUpperCase\(\)/);
  assert.match(printRoutes, /CHALIN 03/);
});
'''

FRONT_FUNCTION = r'''function drawIdCardFront(
  doc,
  data,
  x,
  y,
  width,
  height
) {
  const profile = data.profile;
  const scale = width / CARD_WIDTH;
  const workspaceLabel = workspaceCardLabel(data);
  const serial = profile.id_card_serial || profile.employee_number;
  const status = titleCase(profile.employment_status || "active");

  doc.save();
  doc.roundedRect(x, y, width, height, 7 * scale).fill(WHITE);

  doc.rect(x, y, width, 46 * scale).fill(NAVY);
  doc.rect(x, y + 46 * scale, width, 2.5 * scale).fill(GOLD);
  doc.rect(x, y, 3.2 * scale, height / 3).fill(GHANA_RED);
  doc.rect(x, y + height / 3, 3.2 * scale, height / 3).fill(GOLD);
  doc.rect(x, y + (height / 3) * 2, 3.2 * scale, height / 3).fill(GHANA_GREEN);

  doc.save();
  doc.opacity(0.04);
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(31 * scale)
    .text("CHALIN 03", x + 82 * scale, y + 95 * scale, {
      width: width - 94 * scale,
      align: "right",
      lineBreak: false,
    });
  doc.restore();

  doc
    .roundedRect(x + 11 * scale, y + 7 * scale, 35 * scale, 35 * scale, 8 * scale)
    .fill(WHITE);
  drawLogo(doc, x + 14 * scale, y + 10 * scale, 29 * scale);

  fitSingleLine(
    doc,
    data.company.name.toUpperCase(),
    x + 53 * scale,
    y + 8 * scale,
    width - 65 * scale,
    10.5 * scale,
    6.2 * scale,
    { font: "Helvetica-Bold", color: WHITE }
  );

  fitSingleLine(
    doc,
    "OFFICIAL PERSONNEL IDENTIFICATION",
    x + 53 * scale,
    y + 24.5 * scale,
    width - 65 * scale,
    5.8 * scale,
    4.1 * scale,
    { font: "Helvetica-Bold", color: GOLD }
  );

  fitSingleLine(
    doc,
    workspaceLabel.toUpperCase(),
    x + 53 * scale,
    y + 35 * scale,
    width - 65 * scale,
    4.7 * scale,
    3.6 * scale,
    { font: "Helvetica-Bold", color: "#cbd5e1" }
  );

  drawPhoto(
    doc,
    profile.photo_data,
    profile.full_name,
    x + 12 * scale,
    y + 56 * scale,
    68 * scale,
    84 * scale,
    { radius: 7 * scale, borderColor: GOLD, background: CARD_SOFT }
  );

  doc
    .roundedRect(x + 88 * scale, y + 55 * scale, width - 100 * scale, 17 * scale, 8.5 * scale)
    .fill("#fff8dc");
  fitSingleLine(
    doc,
    profile.employee_number,
    x + 95 * scale,
    y + 60 * scale,
    width - 114 * scale,
    7.3 * scale,
    4.8 * scale,
    { font: "Helvetica-Bold", color: NAVY, align: "center" }
  );

  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(4.3 * scale)
    .text("EMPLOYEE NAME", x + 90 * scale, y + 79 * scale, {
      width: width - 102 * scale,
      lineBreak: false,
    });

  fitSingleLine(
    doc,
    profile.full_name,
    x + 90 * scale,
    y + 87 * scale,
    width - 102 * scale,
    11.2 * scale,
    6.1 * scale,
    { font: "Helvetica-Bold", color: CARD_INK }
  );

  fitSingleLine(
    doc,
    profile.job_title || "Staff Member",
    x + 90 * scale,
    y + 104 * scale,
    width - 102 * scale,
    6.8 * scale,
    4.5 * scale,
    { font: "Helvetica-Bold", color: NAVY_LIGHT }
  );

  fitSingleLine(
    doc,
    profile.department || "Operations",
    x + 90 * scale,
    y + 116 * scale,
    width - 102 * scale,
    5.2 * scale,
    3.8 * scale,
    { color: MUTED }
  );

  doc
    .roundedRect(x + 88 * scale, y + 128 * scale, width - 100 * scale, 14 * scale, 4 * scale)
    .fill(CARD_SOFT);

  fitSingleLine(
    doc,
    `ISSUED ${formatDate(profile.id_card_issue_date, "NOT SET")}`,
    x + 94 * scale,
    y + 132 * scale,
    59 * scale,
    4.5 * scale,
    3.4 * scale,
    { font: "Helvetica-Bold", color: NAVY }
  );

  fitSingleLine(
    doc,
    `EXPIRES ${formatDate(profile.id_card_expiry_date, "NOT SET")}`,
    x + 155 * scale,
    y + 132 * scale,
    width - 167 * scale,
    4.5 * scale,
    3.4 * scale,
    { font: "Helvetica-Bold", color: NAVY, align: "right" }
  );

  doc
    .roundedRect(x + 12 * scale, y + height - 12.5 * scale, 68 * scale, 8.5 * scale, 4 * scale)
    .fill(NAVY);
  fitSingleLine(
    doc,
    status.toUpperCase(),
    x + 16 * scale,
    y + height - 10.2 * scale,
    60 * scale,
    4.2 * scale,
    3.2 * scale,
    { font: "Helvetica-Bold", color: GOLD, align: "center" }
  );

  fitSingleLine(
    doc,
    `CARD ${serial}`,
    x + 88 * scale,
    y + height - 10.2 * scale,
    width - 100 * scale,
    4.2 * scale,
    3.2 * scale,
    { font: "Helvetica-Bold", color: MUTED, align: "right" }
  );

  doc.restore();
  doc
    .lineWidth(1 * scale)
    .strokeColor(NAVY)
    .roundedRect(x, y, width, height, 7 * scale)
    .stroke();
}
'''

BACK_FUNCTION = r'''function drawIdCardBack(
  doc,
  data,
  x,
  y,
  width,
  height
) {
  const profile = data.profile;
  const scale = width / CARD_WIDTH;
  const emergency = primaryEmergencyContact(data);
  const serial = profile.id_card_serial || profile.employee_number;
  const workspaceLabel = workspaceCardLabel(data);

  doc.save();
  doc.roundedRect(x, y, width, height, 7 * scale).fill(LIGHT);
  doc.rect(x, y, width, 38 * scale).fill(NAVY);
  doc.rect(x, y + 38 * scale, width, 2.4 * scale).fill(GOLD);

  drawLogo(doc, x + 11 * scale, y + 7 * scale, 24 * scale);
  fitSingleLine(
    doc,
    data.company.name.toUpperCase(),
    x + 43 * scale,
    y + 8 * scale,
    width - 55 * scale,
    8.7 * scale,
    5 * scale,
    { font: "Helvetica-Bold", color: WHITE }
  );
  fitSingleLine(
    doc,
    "SECURE WORKER CREDENTIAL • PROPERTY OF THE COMPANY",
    x + 43 * scale,
    y + 23 * scale,
    width - 55 * scale,
    4.7 * scale,
    3.5 * scale,
    { font: "Helvetica-Bold", color: GOLD }
  );

  doc
    .roundedRect(x + 11 * scale, y + 49 * scale, 103 * scale, 58 * scale, 6 * scale)
    .fill(WHITE)
    .strokeColor(BORDER)
    .lineWidth(0.7 * scale)
    .stroke();

  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(5.2 * scale)
    .text("EMERGENCY & SAFETY", x + 17 * scale, y + 55 * scale, {
      width: 91 * scale,
      lineBreak: false,
    });

  fitSingleLine(
    doc,
    emergency?.full_name || "Not recorded",
    x + 17 * scale,
    y + 67 * scale,
    91 * scale,
    6.7 * scale,
    4.3 * scale,
    { font: "Helvetica-Bold", color: TEXT }
  );
  fitSingleLine(
    doc,
    emergency?.primary_phone || "No phone recorded",
    x + 17 * scale,
    y + 80 * scale,
    91 * scale,
    5.6 * scale,
    3.8 * scale,
    { color: TEXT }
  );
  fitSingleLine(
    doc,
    `Blood group: ${profile.blood_group || "Not recorded"}`,
    x + 17 * scale,
    y + 93 * scale,
    91 * scale,
    5.4 * scale,
    3.8 * scale,
    { font: "Helvetica-Bold", color: profile.blood_group ? DANGER : MUTED }
  );

  doc
    .roundedRect(x + 124 * scale, y + 49 * scale, width - 135 * scale, 58 * scale, 6 * scale)
    .fill(WHITE)
    .strokeColor(BORDER)
    .lineWidth(0.7 * scale)
    .stroke();

  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(5.2 * scale)
    .text("CREDENTIAL VERIFICATION", x + 131 * scale, y + 55 * scale, {
      width: width - 149 * scale,
      lineBreak: false,
    });

  [
    ["SERIAL", serial],
    ["EMPLOYEE", profile.employee_number],
    ["CATEGORY", workspaceLabel],
    ["VALID UNTIL", formatDate(profile.id_card_expiry_date, "NOT SET")],
  ].forEach(([label, value], index) => {
    const rowY = y + (67 + index * 8.9) * scale;
    fitSingleLine(doc, `${label}:`, x + 131 * scale, rowY, 39 * scale, 4.2 * scale, 3.2 * scale, {
      font: "Helvetica-Bold",
      color: MUTED,
    });
    fitSingleLine(doc, value, x + 171 * scale, rowY, width - 183 * scale, 4.5 * scale, 3.2 * scale, {
      font: "Helvetica-Bold",
      color: TEXT,
    });
  });

  drawCardSecurityBars(
    doc,
    `${serial}-${profile.employee_number}-${profile.id_card_expiry_date}`,
    x + 131 * scale,
    y + 99 * scale,
    width - 146 * scale,
    7 * scale,
    scale
  );

  doc
    .fillColor(TEXT)
    .font("Helvetica")
    .fontSize(4.8 * scale)
    .text(
      "This card identifies an authorized worker of Chalin 03 Company Limited. It is not a national identity document. Alteration, transfer or unauthorized duplication is prohibited.",
      x + 12 * scale,
      y + 114 * scale,
      { width: width - 24 * scale, align: "center", lineGap: 1.1 * scale }
    );

  doc
    .moveTo(x + 17 * scale, y + 137 * scale)
    .lineTo(x + 103 * scale, y + 137 * scale)
    .strokeColor(MUTED)
    .lineWidth(0.5 * scale)
    .stroke();
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(4.2 * scale)
    .text("Employee Signature", x + 17 * scale, y + 140 * scale, {
      width: 86 * scale,
      align: "center",
    });

  doc
    .moveTo(x + 139 * scale, y + 137 * scale)
    .lineTo(x + width - 17 * scale, y + 137 * scale)
    .strokeColor(MUTED)
    .lineWidth(0.5 * scale)
    .stroke();
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(4.2 * scale)
    .text("Authorized Signature", x + 139 * scale, y + 140 * scale, {
      width: width - 156 * scale,
      align: "center",
    });

  doc.rect(x, y + height - 8.5 * scale, width, 8.5 * scale).fill(NAVY);
  fitSingleLine(
    doc,
    `IF FOUND: ${data.company.address} • ${data.company.phone}`,
    x + 10 * scale,
    y + height - 6.5 * scale,
    width - 20 * scale,
    4 * scale,
    3.1 * scale,
    { font: "Helvetica-Bold", color: WHITE, align: "center" }
  );

  doc.restore();
  doc
    .lineWidth(1 * scale)
    .strokeColor(NAVY)
    .roundedRect(x, y, width, height, 7 * scale)
    .stroke();
}
'''

CREATE_ROUTE = r'''router.post(
  "/workers-expanded",
  requireAuth,
  requirePermission(
    "workers.manage",
    "workers.sensitive.view"
  ),
  asyncHandler(async (req, res) => {
    const payload = profilePayload(req.body);

    if (!payload.full_name) {
      return res.status(400).json({
        status: "error",
        message: "Full legal name is required. Employee number is generated automatically.",
      });
    }

    const workspaceCode = activeWorkerWorkspace(req);
    const businessUnitId = await getBusinessUnitId(workspaceCode);
    await validateWorkerLinks({ payload, workspaceCode });
    await ensureWorkerIdentitySchema();

    const connection = await pool.getConnection();
    let identity = null;

    try {
      await connection.beginTransaction();
      identity = await allocateWorkerIdentity(
        connection,
        workspaceCode,
        payload.employment_start_date || new Date()
      );

      payload.employee_number = identity.employeeNumber;
      payload.id_card_serial = identity.cardSerial;
      payload.id_card_issue_date = identity.issueDate;
      payload.id_card_expiry_date = identity.expiryDate;

      const columns = [
        ...PROFILE_EDIT_COLUMNS,
        "workspace_code",
        "business_unit_id",
        "employment_status",
        "created_by",
        "updated_by",
      ];

      const values = [
        ...PROFILE_EDIT_COLUMNS.map((column) => payload[column]),
        workspaceCode,
        businessUnitId,
        "active",
        req.user.id,
        req.user.id,
      ];

      const [result] = await connection.query(
        `INSERT INTO worker_profiles (
           ${columns.join(", ")}
         )
         VALUES (
           ${columns.map(() => "?").join(", ")}
         )`,
        values
      );

      await connection.query(
        `INSERT INTO worker_profile_change_history (
           worker_id,
           change_type,
           reason,
           before_json,
           after_json,
           changed_by
         )
         VALUES (?, 'profile_created', ?, NULL, ?, ?)`,
        [
          result.insertId,
          cleanText(req.body?.change_reason, 2000) ||
            "Initial worker profile created with automatic employee identity.",
          safeJson({
            ...payload,
            employee_number_is_automatic: true,
            card_validity_months: identity.validityMonths,
          }),
          req.user.id,
        ]
      );

      await connection.commit();

      await writeAuditEvent({
        req,
        action: "EXPANDED_WORKER_PROFILE_CREATED",
        actionType: "workforce.profile.created",
        entityType: "worker",
        entityId: result.insertId,
        severity: "notice",
        details:
          `Expanded worker profile ${payload.employee_number} was created with automatic identity and ${identity.validityMonths}-month card validity.`,
      });

      return res.status(201).json({
        status: "success",
        message:
          `Worker profile created. Employee number ${payload.employee_number} and card expiry ${payload.id_card_expiry_date} were generated automatically.`,
        employee_number_is_automatic: true,
        card_validity_months: identity.validityMonths,
        worker: await loadExpandedWorker(result.insertId, req),
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original error.
      }

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          message:
            "The generated employee number, linked account or another unique value is already assigned.",
        });
      }

      throw error;
    } finally {
      connection.release();
    }
  })
);
'''

REISSUE_ROUTE = r'''router.post(
  "/workers-expanded/:id/reissue-id-card",
  requireAuth,
  requirePermission(
    "workers.manage",
    "workers.sensitive.view"
  ),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const reason = cleanText(req.body?.reason, 1000);

    if (!workerId || !reason) {
      return res.status(400).json({
        status: "error",
        message: "Worker and reissue reason are required.",
      });
    }

    const workspaceCode = activeWorkerWorkspace(req);
    const [beforeRows] = await pool.query(
      `SELECT id, employee_number, id_card_issue_date, id_card_expiry_date, id_card_serial
       FROM worker_profiles
       WHERE id = ? AND workspace_code = ?
       LIMIT 1`,
      [workerId, workspaceCode]
    );

    if (!beforeRows.length) {
      return res.status(404).json({
        status: "error",
        message: "Worker profile not found.",
      });
    }

    const dates = await cardDatesForReissue(new Date());
    const serial = beforeRows[0].id_card_serial || beforeRows[0].employee_number;

    await pool.query(
      `UPDATE worker_profiles
       SET id_card_issue_date = ?,
           id_card_expiry_date = ?,
           id_card_serial = ?,
           updated_by = ?
       WHERE id = ? AND workspace_code = ?`,
      [dates.issueDate, dates.expiryDate, serial, req.user.id, workerId, workspaceCode]
    );

    await pool.query(
      `INSERT INTO worker_profile_change_history (
         worker_id, change_type, reason, before_json, after_json, changed_by
       ) VALUES (?, 'id_card_reissued', ?, ?, ?, ?)`,
      [
        workerId,
        reason,
        safeJson(beforeRows[0]),
        safeJson({
          employee_number: beforeRows[0].employee_number,
          id_card_serial: serial,
          id_card_issue_date: dates.issueDate,
          id_card_expiry_date: dates.expiryDate,
          card_validity_months: dates.validityMonths,
        }),
        req.user.id,
      ]
    );

    await writeAuditEvent({
      req,
      action: "WORKER_ID_CARD_REISSUED",
      actionType: "workforce.id_card.reissued",
      entityType: "worker",
      entityId: workerId,
      severity: "notice",
      details:
        `Worker ID card was reissued until ${dates.expiryDate}. Reason: ${reason}`,
    });

    return res.json({
      status: "success",
      message:
        `ID card reissued successfully. New expiry date: ${dates.expiryDate}.`,
      card_validity_months: dates.validityMonths,
      worker: await loadExpandedWorker(workerId, req),
    });
  })
);

'''

# New files.
write("backend/services/workerIdentityService.js", SERVICE)
write("database/migrations/20260718_release3fd2_worker_identity_cards.sql", MIGRATION)
write("backend/tests/release3fD2WorkerIdentityCard.test.js", TEST)

# Copy the true company logo into the Railway backend package.
logo_source = ROOT / "frontend/public/chalin03-logo.png"
logo_target = ROOT / "backend/assets/chalin03-logo.png"
logo_target.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(logo_source, logo_target)

# Settings API.
settings = read("backend/routes/settingsRoutes.js")
settings = replace_once(
    settings,
    'const { requireRole } = require("../middleware/roleMiddleware");\n',
    'const { requireRole } = require("../middleware/roleMiddleware");\nconst {\n  ensureWorkerIdentitySchema,\n  normalizeEmployeePrefix,\n  normalizeValidityMonths,\n} = require("../services/workerIdentityService");\n',
    "settings service import",
)
settings = replace_once(
    settings,
    "async function createDefaultSettingsForBranch(branchId) {\n",
    "async function createDefaultSettingsForBranch(branchId) {\n  await ensureWorkerIdentitySchema();\n",
    "default settings schema guard",
)
settings = replace_once(
    settings,
    "async function getSettingsForBranch(branchId) {\n",
    "async function getSettingsForBranch(branchId) {\n  await ensureWorkerIdentitySchema();\n",
    "get settings schema guard",
)
settings = replace_once(
    settings,
    "      receipt_prefix,\n    } = req.body;",
    "      receipt_prefix,\n      worker_id_card_validity_months,\n      worker_employee_number_prefix,\n    } = req.body;",
    "settings destructuring",
)
settings = replace_once(
    settings,
    "    const reminderDays = toPositiveInt(Number(debt_reminder_days ?? 7));\n",
    "    const reminderDays = toPositiveInt(Number(debt_reminder_days ?? 7));\n    const cardValidityMonths = normalizeValidityMonths(\n      Number(worker_id_card_validity_months ?? 24)\n    );\n    const employeeNumberPrefix = normalizeEmployeePrefix(\n      worker_employee_number_prefix\n    );\n",
    "settings normalization",
)
settings = replace_once(
    settings,
    "            receipt_footer = ?,\n            receipt_prefix = ?\n",
    "            receipt_footer = ?,\n            receipt_prefix = ?,\n            worker_id_card_validity_months = ?,\n            worker_employee_number_prefix = ?\n",
    "settings update columns",
)
settings = replace_once(
    settings,
    "        nullableText(receipt_footer),\n        nullableText(receipt_prefix),\n        settingsId,",
    "        nullableText(receipt_footer),\n        nullableText(receipt_prefix),\n        cardValidityMonths,\n        employeeNumberPrefix,\n        settingsId,",
    "settings update values",
)
settings = replace_once(
    settings,
    "    /*\n      Keep the store name/address in the branches table close to the settings.",
    "    // Worker identity rules are group-wide so every workspace generates consistent cards.\n    await pool.query(\n      `UPDATE settings\n       SET worker_id_card_validity_months = ?,\n           worker_employee_number_prefix = ?`,\n      [cardValidityMonths, employeeNumberPrefix]\n    );\n\n    /*\n      Keep the store name/address in the branches table close to the settings.",
    "global identity settings update",
)
write("backend/routes/settingsRoutes.js", settings)

# Worker profile API.
worker_routes = read("backend/routes/workerProfileExpansionRoutes.js")
worker_routes = replace_once(
    worker_routes,
    '} = require("../services/categoryIsolationService");\n',
    '} = require("../services/categoryIsolationService");\nconst {\n  allocateWorkerIdentity,\n  cardDatesForReissue,\n  ensureWorkerIdentitySchema,\n} = require("../services/workerIdentityService");\n',
    "worker identity imports",
)
worker_routes = replace_regex(
    worker_routes,
    r'router\.post\(\n  "/workers-expanded",[\s\S]*?\n\);\n\nrouter\.get\(\n  "/workers-expanded/:id",',
    CREATE_ROUTE + '\nrouter.get(\n  "/workers-expanded/:id",',
    "worker create route",
)
worker_routes = replace_once(
    worker_routes,
    "      !workerId ||\n      !payload.employee_number ||\n      !payload.full_name ||\n      !reason",
    "      !workerId ||\n      !payload.full_name ||\n      !reason",
    "worker update validation",
)
worker_routes = replace_once(
    worker_routes,
    '          "Worker, employee number, full legal name and change reason are required.",',
    '          "Worker, full legal name and change reason are required.",',
    "worker update message",
)
worker_routes = replace_once(
    worker_routes,
    "    if (!beforeRows.length) {\n      return res.status(404).json({\n        status: \"error\",\n        message: \"Worker profile not found.\",\n      });\n    }\n\n    try {",
    "    if (!beforeRows.length) {\n      return res.status(404).json({\n        status: \"error\",\n        message: \"Worker profile not found.\",\n      });\n    }\n\n    // Employee number, card serial and validity are controlled by the identity service.\n    payload.employee_number = beforeRows[0].employee_number;\n    payload.id_card_serial = beforeRows[0].id_card_serial;\n    payload.id_card_issue_date = beforeRows[0].id_card_issue_date;\n    payload.id_card_expiry_date = beforeRows[0].id_card_expiry_date;\n\n    try {",
    "preserve automatic identity fields",
)
worker_routes = replace_once(
    worker_routes,
    'router.get(\n  "/workers-expanded/:id/photo",',
    REISSUE_ROUTE + 'router.get(\n  "/workers-expanded/:id/photo",',
    "worker reissue route",
)
write("backend/routes/workerProfileExpansionRoutes.js", worker_routes)

# Worker PDF and logo.
print_routes = read("backend/routes/workerPrintRoutes.js")
print_routes = replace_once(
    print_routes,
    'const {\n  writeAuditEvent,\n} = require("../services/auditTrailService");\n',
    'const {\n  writeAuditEvent,\n} = require("../services/auditTrailService");\nconst {\n  calculateCardDates,\n  ensureWorkerIdentitySchema,\n  loadWorkerIdentitySettings,\n} = require("../services/workerIdentityService");\n',
    "print identity imports",
)
print_routes = replace_once(
    print_routes,
    "async function loadWorkerPrintData(workerId) {\n",
    "async function loadWorkerPrintData(workerId) {\n  await ensureWorkerIdentitySchema();\n  const identitySettings = await loadWorkerIdentitySettings();\n",
    "print schema/settings load",
)
print_routes = replace_once(
    print_routes,
    "  const settings = settingsRows[0] || {};\n\n  return {",
    "  const settings = settingsRows[0] || {};\n  const cardDates = calculateCardDates(\n    profileRows[0].id_card_issue_date ||\n      profileRows[0].employment_start_date ||\n      new Date(),\n    identitySettings.validityMonths\n  );\n\n  profileRows[0].id_card_issue_date =\n    profileRows[0].id_card_issue_date || cardDates.issueDate;\n  profileRows[0].id_card_expiry_date =\n    profileRows[0].id_card_expiry_date || cardDates.expiryDate;\n  profileRows[0].id_card_serial =\n    profileRows[0].id_card_serial || profileRows[0].employee_number;\n\n  return {",
    "print effective card dates",
)
print_routes = replace_regex(
    print_routes,
    r'function drawIdCardFront\([\s\S]*?\n}\n\nfunction drawIdCardBack\(',
    FRONT_FUNCTION + '\nfunction drawIdCardBack(',
    "premium card front",
)
print_routes = replace_regex(
    print_routes,
    r'function drawIdCardBack\([\s\S]*?\n}\n\nfunction drawCutMarks\(',
    BACK_FUNCTION + '\nfunction drawCutMarks(',
    "premium card back",
)
write("backend/routes/workerPrintRoutes.js", print_routes)

# Clean schema for future installs.
schema = read("database/schema.sql")
schema = replace_once(
    schema,
    "    receipt_footer VARCHAR(255) DEFAULT 'Thank You For Coming',\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,",
    "    receipt_footer VARCHAR(255) DEFAULT 'Thank You For Coming',\n    worker_id_card_validity_months INT NOT NULL DEFAULT 24,\n    worker_employee_number_prefix VARCHAR(20) NOT NULL DEFAULT 'CH03',\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,",
    "clean schema settings columns",
)
identity_table = r'''

-- worker_identity_sequences
CREATE TABLE IF NOT EXISTS worker_identity_sequences (
    workspace_code VARCHAR(50) NOT NULL PRIMARY KEY,
    last_number INT NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
'''
if "-- worker_identity_sequences" not in schema:
    schema += identity_table
write("database/schema.sql", schema)

# Users & Settings frontend.
users_page = read("frontend/src/pages/UsersSettingsPage.jsx")
users_page = replace_once(
    users_page,
    '    receipt_footer: "",\n  });',
    '    receipt_footer: "",\n    worker_id_card_validity_months: 24,\n    worker_employee_number_prefix: "CH03",\n  });',
    "settings frontend defaults",
)
users_page = replace_once(
    users_page,
    "        debt_reminder_days: Number(settings.debt_reminder_days || 7),\n",
    "        debt_reminder_days: Number(settings.debt_reminder_days || 7),\n        worker_id_card_validity_months: Number(\n          settings.worker_id_card_validity_months || 24\n        ),\n",
    "settings frontend numeric conversion",
)
users_page = users_page.replace("Store Settings", "Business & ID Settings")
users_page = replace_once(
    users_page,
    "                  <div className=\"users-settings-section\">\n                    <h3>Receipt & Customer Settings</h3>",
    "                  <div className=\"users-settings-section\">\n                    <h3>Worker Identity Cards</h3>\n                    <p style={{ marginTop: 0, color: \"#64748b\", fontWeight: 750 }}>\n                      These group-wide rules automatically control employee numbers and every new or reissued worker ID card across Spare Parts, Mining and Equipment Hire.\n                    </p>\n                    <div className=\"users-form-grid\">\n                      <div className=\"users-field\">\n                        <label>Employee number prefix</label>\n                        <input\n                          name=\"worker_employee_number_prefix\"\n                          value={settings.worker_employee_number_prefix || \"CH03\"}\n                          onChange={handleSettingsChange}\n                          maxLength={12}\n                          placeholder=\"CH03\"\n                        />\n                      </div>\n\n                      <div className=\"users-field\">\n                        <label>Card lifespan (months)</label>\n                        <input\n                          type=\"number\"\n                          name=\"worker_id_card_validity_months\"\n                          min=\"1\"\n                          max=\"120\"\n                          value={settings.worker_id_card_validity_months || 24}\n                          onChange={handleSettingsChange}\n                        />\n                      </div>\n                    </div>\n                  </div>\n\n                  <div className=\"users-settings-section\">\n                    <h3>Receipt & Customer Settings</h3>",
    "worker identity settings section",
)
users_page = users_page.replace("Save Store Settings", "Save Business & ID Settings")
write("frontend/src/pages/UsersSettingsPage.jsx", users_page)

# Worker frontend.
worker_page = read("frontend/src/pages/ExpandedWorkerProfilePage.jsx")
worker_page = worker_page.replace('  employee_number: "",\n', "", 1)
worker_page = worker_page.replace('  ["employee_number", "Employee number"],\n', "")
worker_page = worker_page.replace(
    'required={[\n                    "employee_number",\n                    "full_name",\n                  ].includes(key)}',
    'required={key === "full_name"}',
)
worker_page = worker_page.replace(
    'required={[\n                              "employee_number",\n                              "full_name",\n                            ].includes(key)}',
    'required={key === "full_name"}',
)
worker_page = replace_once(
    worker_page,
    "  async function openPrintPdf(endpoint, loadingKey) {",
    "  async function reissueIdCard() {\n    const reason = window.prompt(\n      \"Enter the reason for reissuing this worker ID card.\"\n    );\n    if (!reason?.trim()) return;\n\n    setSaving(true);\n    setError(\"\");\n    setMessage(\"\");\n\n    try {\n      const response = await axiosClient.post(\n        `/release2-final/workers-expanded/${selectedId}/reissue-id-card`,\n        { reason: reason.trim() }\n      );\n      setDetail(response.data.worker);\n      setMessage(response.data.message);\n      await refreshSelected();\n    } catch (requestError) {\n      setError(\n        errorMessage(\n          requestError,\n          \"Worker ID card could not be reissued.\"\n        )\n      );\n    } finally {\n      setSaving(false);\n    }\n  }\n\n  async function openPrintPdf(endpoint, loadingKey) {",
    "worker reissue frontend action",
)
worker_page = replace_once(
    worker_page,
    "                        >\n                          Print ID Card\n                        </button>\n",
    "                        >\n                          Print ID Card\n                        </button>\n\n                        {canManage ? (\n                          <button\n                            type=\"button\"\n                            className=\"secondary\"\n                            onClick={reissueIdCard}\n                            disabled={saving || Boolean(printLoading)}\n                          >\n                            Reissue ID Card\n                          </button>\n                        ) : null}\n",
    "worker reissue button",
)
worker_page = replace_once(
    worker_page,
    "            <form\n              className=\"expanded-worker-form-grid\"\n              onSubmit={createWorker}\n            >",
    "            <form\n              className=\"expanded-worker-form-grid\"\n              onSubmit={createWorker}\n            >\n              <Notice type=\"info\">\n                Employee number, card serial, issue date and expiry date are generated automatically from Business & ID Settings.\n              </Notice>",
    "automatic identity create notice",
)
worker_page = replace_once(
    worker_page,
    "                        [\n                          \"Active assignments\",",
    "                        [\n                          \"ID card issued\",\n                          formatDate(selectedProfile.id_card_issue_date),\n                        ],\n                        [\n                          \"ID card expires\",\n                          formatDate(selectedProfile.id_card_expiry_date),\n                        ],\n                        [\n                          \"Active assignments\",",
    "worker card dates summary",
)
write("frontend/src/pages/ExpandedWorkerProfilePage.jsx", worker_page)

# Verification workflow should lint the files changed by this release.
workflow_path = ".github/workflows/chalin03-verification.yml"
workflow = read(workflow_path)
workflow = workflow.replace(
    "frontend/src/pages/SystemOperationsPage.jsx frontend/src/pages/BackupPage.jsx",
    "frontend/src/pages/SystemOperationsPage.jsx frontend/src/pages/BackupPage.jsx frontend/src/pages/UsersSettingsPage.jsx frontend/src/pages/ExpandedWorkerProfilePage.jsx",
)
write(workflow_path, workflow)

print("Release 3F-D2 worker identity-card patch applied successfully.")
