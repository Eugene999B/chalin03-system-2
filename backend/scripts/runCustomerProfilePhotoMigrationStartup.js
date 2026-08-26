const { pool } = require("../config/db");

const LOCK_NAME = "chalin03.customer_profile_photo.schema";

async function main() {
  let locked = false;
  try {
    await pool.query("SET SESSION lock_wait_timeout = 5");
    const [lockRows] = await pool.query("SELECT GET_LOCK(?, 5) AS acquired", [LOCK_NAME]);
    locked = Number(lockRows?.[0]?.acquired || 0) === 1;
    if (!locked) {
      console.warn("Chalin 03 customer portrait schema check: could not acquire the advisory lock; continuing without blocking startup.");
      return;
    }

    await pool.query("ALTER TABLE hire_customers ADD COLUMN profile_photo_data_url LONGTEXT NULL AFTER risk_notes");
    console.log("Chalin 03 customer portrait schema: profile_photo_data_url column created.");
  } catch (error) {
    if (error?.code === "ER_DUP_FIELDNAME") {
      console.log("Chalin 03 customer portrait schema: profile_photo_data_url already exists.");
      return;
    }
    if (["ER_LOCK_WAIT_TIMEOUT", "ER_LOCK_DEADLOCK", "ER_GET_TEMPORARY_ERRMSG"].includes(error?.code)) {
      console.warn(`Chalin 03 customer portrait schema check skipped safely (${error.code}); the application can retry on the next restart.`);
      return;
    }
    throw error;
  } finally {
    if (locked) {
      try { await pool.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]); } catch {}
    }
    try { await pool.end(); } catch {}
  }
}

main().catch((error) => {
  console.error("Chalin 03 customer portrait schema check failed:", error);
  process.exitCode = 1;
});
