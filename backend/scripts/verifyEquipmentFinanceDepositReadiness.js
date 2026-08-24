const { pool } = require("../config/db");
const { schemaStatus } = require("../routes/equipmentFinanceDepositReservationRoutes");

async function verify() {
  const expected = String(
    process.env.CHALIN03_EXPECTED_DATABASE ||
      process.env.DB_NAME ||
      process.env.MYSQLDATABASE ||
      ""
  ).trim();

  const [[identity]] = await pool.query("SELECT DATABASE() AS database_name");
  const databaseName = String(identity?.database_name || "").trim();

  if (!databaseName || !expected || databaseName !== expected) {
    throw new Error(
      `Finance deposit readiness verification refused: connected database ${databaseName || "(unknown)"} does not match expected production database ${expected || "(unset)"}.`
    );
  }

  const readiness = await schemaStatus(pool);
  if (!readiness.ready) {
    throw new Error(
      JSON.stringify(
        {
          message: "Finance deposit foundation is still incomplete after production migrations.",
          database_name: databaseName,
          missing_columns: readiness.missing_columns,
          missing_triggers: readiness.missing_triggers,
          missing_migrations: readiness.missing_migrations,
        },
        null,
        2
      )
    );
  }

  console.log(
    JSON.stringify(
      {
        verified: true,
        database_name: databaseName,
        message: "Finance deposit and reservation readiness verified successfully.",
        readiness,
      },
      null,
      2
    )
  );
}

verify()
  .catch((error) => {
    console.error("Finance deposit readiness verification failed.");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
