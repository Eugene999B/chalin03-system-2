const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const MIGRATION_LOCK = "chalin03:equipment-finance:phase5-unified-documents";
const MIGRATION_RECORD =
  "20260803_equipment_finance_phase5_unified_documents";
const MIGRATION_FILE =
  "20260803_equipment_finance_phase5_unified_documents.sql";
const VERIFIER_FILE =
  "20260803_equipment_finance_phase5_unified_documents_verify.sql";
const ENCRYPTION_VERSION = "aes-256-gcm-v1";
const KEY_SALT = Buffer.from(
  "chalin03-equipment-finance-private-documents-v1",
  "utf8"
);
const KEY_INFO = Buffer.from("aes-256-gcm-database-vault", "utf8");
const DOCUMENT_CATEGORIES = new Set([
  "kyc_identity",
  "kyc_address",
  "kyc_income",
  "guarantor_identity",
  "guarantor_undertaking",
  "agreement_attachment",
  "other",
]);

function requiredEnv(primaryName, fallbackName) {
  const value = process.env[primaryName] || process.env[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(
      `Missing required database variable ${primaryName}${
        fallbackName ? ` or ${fallbackName}` : ""
      }.`
    );
  }
  return value;
}

function connectionOptions() {
  const sslEnabled =
    String(process.env.DB_SSL || "").trim().toLowerCase() === "true";
  const encodedCa = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  const rejectUnauthorized = !["0", "false", "no", "off"].includes(
    String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true")
      .trim()
      .toLowerCase()
  );
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: sslEnabled
      ? encodedCa
        ? {
            ca: Buffer.from(encodedCa, "base64").toString("utf8"),
            rejectUnauthorized: true,
          }
        : { rejectUnauthorized }
      : undefined,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function hasExecutableSql(sqlText) {
  return String(sqlText || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:--|#).*$/, ""))
    .join("\n")
    .trim().length > 0;
}

function splitSqlScript(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  for (const line of String(sqlText || "")
    .replace(/\r\n/g, "\n")
    .split("\n")) {
    const delimiterMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimiterMatch) {
      if (hasExecutableSql(buffer)) {
        throw new Error(
          "SQL DELIMITER appeared before the previous statement was complete."
        );
      }
      buffer = "";
      delimiter = delimiterMatch[1];
      continue;
    }
    buffer += `${line}\n`;
    const trimmed = buffer.trimEnd();
    if (!trimmed.endsWith(delimiter)) continue;
    const statement = trimmed.slice(0, -delimiter.length).trim();
    if (statement) statements.push(statement);
    buffer = "";
  }
  if (hasExecutableSql(buffer)) {
    throw new Error("SQL script ended with an incomplete statement.");
  }
  return statements;
}

function readMigrationFile(filename) {
  const filePath = path.resolve(
    __dirname,
    "../../database/migrations",
    filename
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`Approved unified Phase 5 SQL file is missing: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

async function executeStatements(connection, statements, label) {
  const results = [];
  for (let index = 0; index < statements.length; index += 1) {
    try {
      const [rows] = await connection.query(statements[index]);
      results.push(Array.isArray(rows) ? rows : []);
    } catch (error) {
      error.message = `${label} failed at statement ${index + 1} of ${
        statements.length
      }: ${error.message}`;
      throw error;
    }
  }
  return results;
}

async function verifyDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(row?.database_name || "").trim();
  const expected = String(
    process.env.CHALIN03_EXPECTED_DATABASE || ""
  ).trim();
  if (!databaseName || !expected) {
    throw new Error(
      "Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name."
    );
  }
  if (databaseName !== expected) {
    throw new Error(
      `Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`
    );
  }
  return databaseName;
}

async function migrationRecordExists(connection) {
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [MIGRATION_RECORD]
  );
  return Number(row?.applied || 0) === 1;
}

function encryptionKey(env = process.env) {
  const source = String(
    env.CHALIN03_FINANCE_DOCUMENT_KEY || env.JWT_SECRET || ""
  ).trim();
  if (source.length < 32) {
    throw new Error(
      "Set CHALIN03_FINANCE_DOCUMENT_KEY or a JWT_SECRET of at least 32 characters before unified document migration."
    );
  }
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(source, "utf8"),
      KEY_SALT,
      KEY_INFO,
      32
    )
  );
}

function encryptLegacyBuffer(buffer, key = encryptionKey()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return {
    encrypted,
    iv,
    tag: cipher.getAuthTag(),
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function normalizeLegacyCategory(value) {
  const category = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const mapped = {
    buyer_id_front: "kyc_identity",
    buyer_id_back: "kyc_identity",
    buyer_photo: "kyc_identity",
    proof_of_address: "kyc_address",
    income_evidence: "kyc_income",
    guarantor_id: "guarantor_identity",
    signed_agreement: "agreement_attachment",
  }[category];
  if (mapped) return mapped;
  return DOCUMENT_CATEGORIES.has(category) ? category : "other";
}

async function backfillLegacyDocuments(connection) {
  const key = encryptionKey();
  let migrated = 0;
  while (true) {
    const [rows] = await connection.query(
      `SELECT legacy_document.*
         FROM equipment_finance_case_documents legacy_document
         LEFT JOIN equipment_finance_private_documents private_document
           ON private_document.legacy_case_document_id = legacy_document.id
        WHERE private_document.id IS NULL
        ORDER BY legacy_document.id
        LIMIT 50`
    );
    if (!rows.length) break;

    await connection.beginTransaction();
    try {
      for (const row of rows) {
        const applicationId = Number(row.application_id || 0) || null;
        const agreementId = Number(row.agreement_id || 0) || null;
        const assetId = Number(row.asset_id || 0) || null;
        if (!applicationId || !assetId) {
          throw new Error(
            `Legacy Finance document ${row.id} has no valid application or asset link.`
          );
        }
        const buffer = Buffer.from(row.file_content || "");
        if (!buffer.length) {
          throw new Error(`Legacy Finance document ${row.id} is empty.`);
        }
        const encrypted = encryptLegacyBuffer(buffer, key);
        if (
          row.checksum_sha256 &&
          String(row.checksum_sha256).toLowerCase() !== encrypted.checksum
        ) {
          throw new Error(
            `Legacy Finance document ${row.id} failed its stored checksum.`
          );
        }

        const legacyStatus = String(row.document_status || "uploaded");
        const archived = legacyStatus === "superseded";
        const reviewStatus =
          legacyStatus === "verified"
            ? "verified"
            : legacyStatus === "rejected"
              ? "rejected"
              : "pending";
        const approvalStatus =
          reviewStatus === "rejected" ? "rejected" : "pending";
        const documentNumber = `EFD-LEGACY-${String(row.id).padStart(10, "0")}`;
        const [insert] = await connection.query(
          `INSERT INTO equipment_finance_private_documents (
             document_number, application_id, agreement_id, customer_id,
             asset_id, document_stage, replacement_of_document_id,
             version_number, legacy_case_document_id, document_category,
             document_type, original_file_name, mime_type, file_size_bytes,
             content_checksum, encrypted_payload, encryption_iv, encryption_tag,
             encryption_version, document_status, review_status, reviewed_by,
             reviewed_at, review_notes, approval_status, uploaded_by, uploaded_at,
             archived_at, archived_by, archive_reason
           ) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            documentNumber,
            applicationId,
            agreementId,
            Number(row.customer_id || 0) || null,
            assetId,
            agreementId ? "agreement" : "application",
            row.id,
            normalizeLegacyCategory(row.document_category),
            String(row.document_label || "Legacy Finance evidence").slice(0, 120),
            String(row.original_file_name || `legacy-document-${row.id}`).slice(
              0,
              255
            ),
            String(row.stored_mime_type || "application/octet-stream").slice(
              0,
              120
            ),
            buffer.length,
            encrypted.checksum,
            encrypted.encrypted,
            encrypted.iv,
            encrypted.tag,
            ENCRYPTION_VERSION,
            archived ? "archived" : "active",
            reviewStatus,
            Number(row.verified_by || 0) || null,
            row.verified_at || null,
            row.rejected_reason || "Migrated from the preserved operational document store.",
            approvalStatus,
            Number(row.uploaded_by || 0) || null,
            row.created_at || new Date(),
            archived ? row.created_at || new Date() : null,
            archived ? Number(row.verified_by || 0) || null : null,
            archived
              ? "Superseded in the preserved operational document store."
              : null,
          ]
        );

        if (reviewStatus !== "pending") {
          await connection.query(
            `INSERT INTO equipment_finance_document_review_history (
               document_id, agreement_id, application_id, decision_stage,
               decision_value, decision_notes, decided_by, decided_at,
               document_checksum, policy_version
             ) VALUES (?, ?, ?, 'review', ?, ?, ?, ?, ?, 'legacy-backfill-v1')`,
            [
              insert.insertId,
              agreementId,
              applicationId,
              reviewStatus,
              row.rejected_reason ||
                "Preserved review decision from the operational document store.",
              Number(row.verified_by || 0) || null,
              row.verified_at || row.created_at || new Date(),
              encrypted.checksum,
            ]
          );
        }

        await connection.query(
          `INSERT INTO equipment_finance_case_activity (
             activity_number, application_id, agreement_id, document_id,
             action_type, actor_id, actor_role, description, metadata_json
           ) VALUES (?, ?, ?, ?, 'legacy_document_migrated', NULL, 'system',
                     ?, ?)`,
          [
            `EFA-LEGACY-${String(row.id).padStart(10, "0")}`,
            applicationId,
            agreementId,
            insert.insertId,
            `Preserved legacy Finance document ${row.id} in the encrypted document authority.`,
            JSON.stringify({
              legacy_case_document_id: Number(row.id),
              checksum: encrypted.checksum,
              original_status: legacyStatus,
              original_record_preserved: true,
            }),
          ]
        );
        migrated += 1;
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
  return migrated;
}

function validateVerifierResults(results) {
  if (results.length !== 5) {
    throw new Error(
      `Unified Phase 5 verifier returned ${results.length} result sets instead of 5.`
    );
  }
  const [migrationRows, columnRows, nullableRows, unmappedRows, invalidRows] =
    results;
  if (
    migrationRows.length !== 1 ||
    migrationRows[0].migration_name !== MIGRATION_RECORD
  ) {
    throw new Error("The unified Phase 5 migration record was not verified.");
  }
  if (columnRows.length !== 4) {
    throw new Error("The unified Finance document linkage columns are incomplete.");
  }
  if (
    nullableRows.length !== 2 ||
    nullableRows.some((row) => row.IS_NULLABLE !== "YES")
  ) {
    throw new Error(
      "Application-stage documents are still blocked by a required agreement link."
    );
  }
  if (Number(unmappedRows[0]?.unmapped_legacy_documents || 0) !== 0) {
    throw new Error("Legacy Finance documents were not fully mapped.");
  }
  if (Number(invalidRows[0]?.invalid_unified_document_links || 0) !== 0) {
    throw new Error("The unified Finance document authority has invalid case links.");
  }
}

async function runEquipmentFinancePhaseFiveUnifiedDocumentsStartup() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lockRow]] = await connection.query(
      "SELECT GET_LOCK(?, 30) AS acquired",
      [MIGRATION_LOCK]
    );
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the unified Phase 5 migration lock.");
    }

    if (!(await migrationRecordExists(connection))) {
      await executeStatements(
        connection,
        splitSqlScript(readMigrationFile(MIGRATION_FILE)),
        "Equipment Finance unified Phase 5 migration"
      );
      console.log(`Applied ${MIGRATION_RECORD} on ${databaseName}.`);
    }

    const migratedLegacyDocuments = await backfillLegacyDocuments(connection);
    const results = await executeStatements(
      connection,
      splitSqlScript(readMigrationFile(VERIFIER_FILE)),
      "Equipment Finance unified Phase 5 verifier"
    );
    validateVerifierResults(results);
    console.log(
      `Verified ${MIGRATION_RECORD} on ${databaseName}; migrated ${migratedLegacyDocuments} legacy document(s).`
    );
    return {
      applied: true,
      database_name: databaseName,
      migration: MIGRATION_RECORD,
      migrated_legacy_documents: migratedLegacyDocuments,
    };
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]);
      } catch {
        // Closing the connection also releases the advisory lock.
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runEquipmentFinancePhaseFiveUnifiedDocumentsStartup().catch((error) => {
    console.error(
      "Equipment Finance unified Phase 5 Railway startup gate failed."
    );
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  MIGRATION_FILE,
  MIGRATION_LOCK,
  MIGRATION_RECORD,
  VERIFIER_FILE,
  backfillLegacyDocuments,
  encryptLegacyBuffer,
  executeStatements,
  hasExecutableSql,
  normalizeLegacyCategory,
  runEquipmentFinancePhaseFiveUnifiedDocumentsStartup,
  splitSqlScript,
  validateVerifierResults,
  verifyDatabaseIdentity,
};


