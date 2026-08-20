const mysql = require("mysql2/promise");
require("dotenv").config();

const REVIEW_DATE = "2026-08-05";
const LOCK_NAME = "chalin03:merge-audit-date-fix:20260805";
const MERGE_ACTION = "MERGE_CUSTOMER_IDENTITIES";

function requiredEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (String(value || "").trim()) return value;
  }
  throw new Error(`Missing required database variable: ${names.join(" or ")}.`);
}

function getSslConfig(env = process.env) {
  if (String(env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const encodedCa = String(env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) {
    return {
      ca: Buffer.from(encodedCa, "base64").toString("utf8"),
      rejectUnauthorized: true,
    };
  }
  return {
    rejectUnauthorized: !["0", "false", "no", "off"].includes(
      String(env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
    ),
  };
}

function connectionOptions() {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST", "MYSQL_HOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER", "MYSQL_USER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD", "MYSQL_PASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE", "MYSQL_DATABASE"),
    ssl: getSslConfig(),
    charset: "utf8mb4",
    multipleStatements: false,
  };
}

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function toMysqlDateTime(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 19).replace("T", " ");
  }

  if (typeof value === "number" || typeof value === "string") {
    const text = String(value).trim();
    if (!text || text === "[object Object]") return null;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 19).replace("T", " ");
  }

  if (typeof value === "object") {
    for (const key of ["created_at", "date", "value", "raw", "iso", "timestamp", "$date"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const normalized = toMysqlDateTime(value[key], depth + 1);
        if (normalized) return normalized;
      }
    }
  }

  return null;
}

function sanitizeMergeMetadata(metadata) {
  const next = metadata && typeof metadata === "object" ? { ...metadata } : {};
  const sources = Array.isArray(next.source_customers) ? next.source_customers : [];
  let changed = false;

  next.source_customers = sources.map((profile) => {
    if (!profile || typeof profile !== "object") return profile;
    const normalized = toMysqlDateTime(profile.created_at);
    const current = profile.created_at ?? null;
    if (normalized !== current) changed = true;
    return { ...profile, created_at: normalized };
  });

  return { metadata: next, changed };
}

async function verifyDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = cleanText(row?.database_name);
  const expected = cleanText(process.env.CHALIN03_EXPECTED_DATABASE);
  if (!databaseName || !expected) {
    throw new Error("Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name.");
  }
  if (databaseName !== expected) {
    throw new Error(`Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`);
  }
  return databaseName;
}

async function runCustomerMergeAuditDateSanitizer20260805() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    console.log("Customer merge audit date sanitizer skipped outside production.");
    return { skipped: true, reason: "non-production" };
  }

  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  let transactionStarted = false;

  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 60) AS acquired", [LOCK_NAME]);
    lockAcquired = Number(lock?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the customer merge audit date sanitizer lock.");

    await connection.beginTransaction();
    transactionStarted = true;

    const [rows] = await connection.query(
      `SELECT id, metadata_json
       FROM activity_log
       WHERE DATE(created_at) = ?
         AND (action = ? OR action_type = ?)
       ORDER BY id
       FOR UPDATE`,
      [REVIEW_DATE, MERGE_ACTION, MERGE_ACTION]
    );

    let updatedAudits = 0;
    let sourceProfilesChecked = 0;
    for (const row of rows) {
      const parsed = parseMetadata(row.metadata_json);
      sourceProfilesChecked += Array.isArray(parsed.source_customers)
        ? parsed.source_customers.length
        : 0;
      const sanitized = sanitizeMergeMetadata(parsed);
      if (!sanitized.changed) continue;
      await connection.query(
        "UPDATE activity_log SET metadata_json = ? WHERE id = ?",
        [JSON.stringify(sanitized.metadata), row.id]
      );
      updatedAudits += 1;
    }

    await connection.commit();
    transactionStarted = false;

    const result = {
      database_name: databaseName,
      merge_audits_checked: rows.length,
      source_profiles_checked: sourceProfilesChecked,
      merge_audits_updated: updatedAudits,
    };
    console.log(`Customer merge audit dates sanitized on ${databaseName}.`);
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {}
    }
    throw error;
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
      } catch {}
    }
    await connection.end();
  }
}

if (require.main === module) {
  runCustomerMergeAuditDateSanitizer20260805().catch((error) => {
    console.error("Customer merge audit date sanitizer failed safely. No audit metadata was partially changed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  LOCK_NAME,
  REVIEW_DATE,
  sanitizeMergeMetadata,
  toMysqlDateTime,
  runCustomerMergeAuditDateSanitizer20260805,
};
