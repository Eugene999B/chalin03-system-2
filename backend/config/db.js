const mysql = require("mysql2/promise");
require("dotenv").config();

function getEnvValue(primaryName, fallbackName, defaultValue = undefined) {
  return process.env[primaryName] || process.env[fallbackName] || defaultValue;
}

function booleanValue(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function getSslConfig(env = process.env) {
  const dbSsl = String(env.DB_SSL || "").trim().toLowerCase();

  if (dbSsl === "true") {
    const encodedCa = String(env.DB_SSL_CA_BASE64 || "").trim();

    if (encodedCa) {
      return {
        ca: Buffer.from(encodedCa, "base64").toString("utf8"),
        rejectUnauthorized: true,
      };
    }

    return {
      rejectUnauthorized: booleanValue(
        env.DB_SSL_REJECT_UNAUTHORIZED,
        true
      ),
    };
  }

  if (dbSsl === "false") {
    return false;
  }

  return undefined;
}

function isProduction(env = process.env) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function queryText(statement) {
  if (typeof statement === "string") return statement;
  return String(statement?.sql || "");
}

function normalizeEquipmentAssetSaleLockStatement(statement) {
  const sql = queryText(statement);
  if (
    !/\bequipment_asset_sale_locks\s+sale_lock\b/i.test(sql) ||
    !/\bsale_lock\.id\b/i.test(sql)
  ) {
    return statement;
  }

  const normalizedSql = sql.replace(/\bsale_lock\.id\b/gi, "sale_lock.asset_id");
  if (typeof statement === "string") return normalizedSql;
  return { ...statement, sql: normalizedSql };
}

function stripSqlComments(statement) {
  return String(statement || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const RUNTIME_DDL_PATTERN =
  /\b(?:ALTER\s+(?:TABLE|DATABASE|SCHEMA|EVENT)|TRUNCATE(?:\s+TABLE)?|CREATE\s+(?:TABLE|INDEX|TRIGGER|PROCEDURE|FUNCTION|EVENT|DATABASE|SCHEMA)|DROP\s+(?:TABLE|INDEX|TRIGGER|PROCEDURE|FUNCTION|EVENT|DATABASE|SCHEMA)|RENAME\s+TABLE)\b/i;
const IDEMPOTENT_CREATE_TABLE_PATTERN =
  /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i;

function isSingleStatement(sql) {
  const withoutTrailingSemicolon = String(sql || "").replace(/;\s*$/, "");
  return !withoutTrailingSemicolon.includes(";");
}

function runtimeDdlDecision(statement, env = process.env) {
  const sql = stripSqlComments(queryText(statement));
  if (!isProduction(env) || !sql) {
    return { action: "allow", sql };
  }

  if (
    IDEMPOTENT_CREATE_TABLE_PATTERN.test(sql) &&
    isSingleStatement(sql)
  ) {
    return {
      action: "noop",
      sql,
      reason:
        "Legacy compatibility CREATE TABLE probe suppressed; production schema changes require an approved migration.",
    };
  }

  if (RUNTIME_DDL_PATTERN.test(sql)) {
    return {
      action: "block",
      sql,
      reason:
        "Runtime schema mutation is disabled in production. Apply and verify an approved additive migration before deploying code that requires this schema.",
    };
  }

  return { action: "allow", sql };
}

function runtimeDdlBlockedError(decision) {
  const error = new Error(decision.reason);
  error.name = "RuntimeDdlBlockedError";
  error.code = "RUNTIME_DDL_BLOCKED";
  error.sql_operation = decision.sql.slice(0, 180);
  return error;
}

function guardedExecutor(original, receiver) {
  return async function executeWithRuntimeDdlGuard(statement, values) {
    const normalizedStatement = normalizeEquipmentAssetSaleLockStatement(statement);
    const decision = runtimeDdlDecision(normalizedStatement);

    if (decision.action === "block") {
      throw runtimeDdlBlockedError(decision);
    }

    if (decision.action === "noop") {
      return [
        {
          affectedRows: 0,
          changedRows: 0,
          warningStatus: 0,
          runtimeDdlSuppressed: true,
        },
        [],
      ];
    }

    return original.call(receiver, normalizedStatement, values);
  };
}

function protectConnection(connection) {
  if (!connection || connection.__chalin03RuntimeDdlGuardInstalled) {
    return connection;
  }

  if (typeof connection.query === "function") {
    connection.query = guardedExecutor(connection.query, connection);
  }
  if (typeof connection.execute === "function") {
    connection.execute = guardedExecutor(connection.execute, connection);
  }

  Object.defineProperty(connection, "__chalin03RuntimeDdlGuardInstalled", {
    value: true,
    enumerable: false,
  });
  return connection;
}

const pool = mysql.createPool({
  host: getEnvValue("DB_HOST", "MYSQLHOST"),
  port: Number(getEnvValue("DB_PORT", "MYSQLPORT", 3306)),
  user: getEnvValue("DB_USER", "MYSQLUSER"),
  password: getEnvValue("DB_PASSWORD", "MYSQLPASSWORD"),
  database: getEnvValue("DB_NAME", "MYSQLDATABASE"),

  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,

  timezone: "Z",
  ssl: getSslConfig(),
});

const originalPoolQuery = pool.query.bind(pool);
const originalPoolExecute = pool.execute.bind(pool);
const originalGetConnection = pool.getConnection.bind(pool);

pool.query = guardedExecutor(originalPoolQuery, pool);
pool.execute = guardedExecutor(originalPoolExecute, pool);
pool.getConnection = async function getProtectedConnection() {
  return protectConnection(await originalGetConnection());
};

async function testDatabaseConnection() {
  try {
    const connection = await pool.getConnection();

    const [rows] = await connection.query("SELECT DATABASE() AS database_name");

    console.log("✅ MySQL database connected successfully");
    console.log(
      `📦 Database: ${
        rows[0]?.database_name ||
        getEnvValue("DB_NAME", "MYSQLDATABASE", "unknown")
      }`
    );

    connection.release();
  } catch (error) {
    console.error("❌ MySQL database connection failed");
    console.error("Reason:", error.message);

    if (!getEnvValue("DB_HOST", "MYSQLHOST")) {
      console.error("Missing DB_HOST or MYSQLHOST.");
    }

    if (!getEnvValue("DB_USER", "MYSQLUSER")) {
      console.error("Missing DB_USER or MYSQLUSER.");
    }

    if (!getEnvValue("DB_NAME", "MYSQLDATABASE")) {
      console.error("Missing DB_NAME or MYSQLDATABASE.");
    }

    process.exit(1);
  }
}

module.exports = {
  RUNTIME_DDL_PATTERN,
  getSslConfig,
  isProduction,
  normalizeEquipmentAssetSaleLockStatement,
  pool,
  protectConnection,
  runtimeDdlDecision,
  stripSqlComments,
  testDatabaseConnection,
};
