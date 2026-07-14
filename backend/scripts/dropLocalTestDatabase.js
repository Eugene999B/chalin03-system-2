require("dotenv").config();

const mysql = require("mysql2/promise");

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function assertSafeTarget({ host, database, confirm }) {
  if (!confirm) {
    throw new Error("--confirm is required before dropping a local _test database.");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`Refusing database host '${host}'.`);
  }
  if (/railway/i.test(host) || /railway/i.test(database)) {
    throw new Error("Refusing Railway-like host or database name.");
  }
  if (!/_test$/i.test(database)) {
    throw new Error(`Refusing database '${database}'. Cleanup is allowed only for names ending in _test.`);
  }
}

async function main() {
  const host = argValue("--host", process.env.DB_HOST || process.env.MYSQLHOST || "localhost");
  const database = argValue("--database", "chalin03_full_test");
  const user = argValue("--user", process.env.DB_USER || process.env.MYSQLUSER || "root");
  const password = argValue("--password", process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || "");
  const confirm = hasArg("--confirm");

  assertSafeTarget({ host, database, confirm });

  const connection = await mysql.createConnection({ host, user, password });
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    console.log(`PASS - cleaned local test database ${database} on ${host}.`);
    console.log("PASS - normal chalin03_db was not touched.");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`FAIL - ${error.message}`);
  process.exit(1);
});
