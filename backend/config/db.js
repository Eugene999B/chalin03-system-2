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
  getSslConfig,
  pool,
  testDatabaseConnection,
};
