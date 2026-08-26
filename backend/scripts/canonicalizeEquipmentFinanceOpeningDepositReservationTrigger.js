const mysql = require("mysql2/promise");
require("dotenv").config();

const { finalize } = require("./finalizeEquipmentFinanceOpeningDepositReservationTrigger");

const LOCK_NAME = "chalin03:equipment-finance:opening-deposit-canonicalizer";
const TRIGGER_NAME = "trg_equipment_finance_reservation_gate_before_insert";

function requiredEnv(primary, fallback) {
  const value = process.env[primary] || process.env[fallback];
  if (!String(value || "").trim()) throw new Error(`Missing required database variable ${primary}${fallback ? ` or ${fallback}` : ""}.`);
  return value;
}

function ssl() {
  if (String(process.env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const ca = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  if (ca) return { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true };
  return { rejectUnauthorized: !["0", "false", "no", "off"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()) };
}

function options() {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: ssl(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

async function verifyIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(row?.database_name || "").trim();
  const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || process.env.DB_NAME || process.env.MYSQLDATABASE || "").trim();
  if (!databaseName || !expected || databaseName !== expected) {
    throw new Error(`Connected database ${databaseName || "(unknown)"} does not match expected production database ${expected || "(unset)"}.`);
  }
  return databaseName;
}

async function canonicalize({ createConnection = mysql.createConnection } = {}) {
  await finalize();
  const connection = await createConnection(options());
  let locked = false;
  try {
    const databaseName = await verifyIdentity(connection);
    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK_NAME]);
    locked = Number(lockRow?.acquired || 0) === 1;
    if (!locked) throw new Error("Could not acquire Opening Deposit canonicalizer lock.");

    const [[trigger]] = await connection.query(
      `SELECT ACTION_STATEMENT
         FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()
          AND TRIGGER_NAME = ?`,
      [TRIGGER_NAME]
    );
    if (!trigger?.ACTION_STATEMENT) throw new Error(`Required trigger ${TRIGGER_NAME} was not found after finalization.`);

    let body = String(trigger.ACTION_STATEMENT);
    const statusPattern = /IF NEW\.lock_status <> 'installment_active' THEN\s+SIGNAL SQLSTATE '45000'\s+SET MESSAGE_TEXT = 'Approved-credit Finance reservations must use installment_active status\.';\s+END IF;/i;
    if (statusPattern.test(body)) {
      body = body.replace(
        statusPattern,
        `IF NEW.lock_status = 'installment_active' THEN\n              DO 0;\n          ELSE\n              SIGNAL SQLSTATE '45000'\n                  SET MESSAGE_TEXT = 'Approved-credit Finance reservations must use installment_active status.';\n          END IF;`
      );
    }

    const depositPattern = /v_deposit_received\s*<\s*v_deposit_required/i;
    if (depositPattern.test(body) && !/v_deposit_received\s*\+\s*0\.01\s*<\s*v_deposit_required/i.test(body)) {
      body = body.replace(depositPattern, "v_deposit_received + 0.01 < v_deposit_required");
    }

    await connection.query(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME}`);
    await connection.query(`CREATE TRIGGER ${TRIGGER_NAME}\nBEFORE INSERT ON equipment_asset_sale_locks\nFOR EACH ROW\n${body}`);

    const [[verified]] = await connection.query(
      `SELECT ACTION_STATEMENT
         FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()
          AND TRIGGER_NAME = ?`,
      [TRIGGER_NAME]
    );
    const action = String(verified?.ACTION_STATEMENT || "");
    if (!/NEW\.lock_status\s*=\s*'installment_active'/i.test(action)) {
      throw new Error("Canonical reservation trigger is missing the accepted installment_active status guard.");
    }
    if (!/v_deposit_received\s*\+\s*0\.01\s*<\s*v_deposit_required/i.test(action)) {
      throw new Error("Canonical reservation trigger is missing the approved opening-deposit tolerance guard.");
    }
    if (!/ELSE\s+SIGNAL SQLSTATE '45000'/i.test(action)) {
      throw new Error("Canonical reservation trigger is missing the rejection branch for invalid status.");
    }

    const result = { verified: true, database_name: databaseName, trigger: TRIGGER_NAME, canonicalized: true };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (locked) {
      try { await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]); } catch {}
    }
    await connection.end();
  }
}

if (require.main === module) {
  canonicalize().catch((error) => {
    console.error("Opening Deposit reservation trigger canonicalization failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { canonicalize };
