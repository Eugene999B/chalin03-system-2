const mysql = require("mysql2/promise");
require("dotenv").config();

function getSslConfig() {
  const dbSsl = String(process.env.DB_SSL || "").toLowerCase();

  if (dbSsl === "true") {
    return {
      rejectUnauthorized: true,
    };
  }

  if (dbSsl === "false") {
    return false;
  }

  return undefined;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

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
    console.log(`📦 Database: ${rows[0]?.database_name || process.env.DB_NAME}`);

    connection.release();
  } catch (error) {
    console.error("❌ MySQL database connection failed");
    console.error("Reason:", error.message);

    if (!process.env.DB_HOST) {
      console.error("Missing DB_HOST in .env");
    }

    if (!process.env.DB_USER) {
      console.error("Missing DB_USER in .env");
    }

    if (!process.env.DB_NAME) {
      console.error("Missing DB_NAME in .env");
    }

    process.exit(1);
  }
}

module.exports = {
  pool,
  testDatabaseConnection,
};