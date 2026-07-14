require("dotenv").config();

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const { executeSqlScript } = require("./sqlScriptRunner");

const ROOT = path.resolve(__dirname, "../..");
const TEST_PASSWORD = "LocalPass123!";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function assertSafeTarget({ host, database, confirm }) {
  if (!confirm) {
    throw new Error("--confirm is required before creating or resetting a local _test database.");
  }

  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`Refusing database host '${host}'.`);
  }

  if (/railway/i.test(host) || /railway/i.test(database)) {
    throw new Error("Refusing Railway-like host or database name.");
  }

  if (!/_test$/i.test(database)) {
    throw new Error(`Refusing database '${database}'. Acceptance requires a name ending in _test.`);
  }
}

function readSql(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function orderedSqlFiles() {
  const orderPath = path.join(ROOT, "database/run_final_local_migrations_order.txt");
  const lines = fs.readFileSync(orderPath, "utf8").split(/\r?\n/);
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((relativePath) => {
      const fullPath = path.join(ROOT, relativePath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Listed migration/verification file is missing: ${relativePath}`);
      }
      return relativePath.replace(/\\/g, "/");
    });
}

function isVerificationFile(relativePath) {
  return /(^|\/)(schema_verify|.*_verify)\.sql$/i.test(relativePath);
}

async function executeSqlFile(connection, relativePath) {
  const sql = readSql(relativePath).trim();
  if (!sql) {
    throw new Error(`SQL file is empty: ${relativePath}`);
  }

  const results = await executeSqlScript(connection, sql, relativePath);

  if (isVerificationFile(relativePath)) {
    assertVerificationPassed(relativePath, results);
  }

  if (!isVerificationFile(relativePath)) {
    const migrationName = path.basename(relativePath);
    await connection.query(
      `INSERT INTO schema_migrations (migration_name, description)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE applied_at = CURRENT_TIMESTAMP`,
      [migrationName, `Applied by local acceptance runner from ${relativePath}`]
    );
  }
}

function assertVerificationPassed(relativePath, resultSets) {
  const failures = [];
  const issueDetailPattern =
    /(duplicate|invalid|without_workspace|cashier_in_mining|multiple_default|cross_workspace|orphan)/i;

  for (const rows of resultSets) {
    for (const row of rows) {
      const entries = Object.entries(row);
      let rowFailed = false;

      for (const [key, value] of entries) {
        const normalizedKey = key.toLowerCase();
        const normalizedValue = String(value ?? "").trim().toUpperCase();
        const numericValue = Number(value);

        if (
          ["status", "result"].includes(normalizedKey) &&
          normalizedValue === "FAIL"
        ) {
          rowFailed = true;
        }

        if (
          normalizedValue === "MISSING" &&
          (normalizedKey.includes("found") || normalizedKey.includes("status"))
        ) {
          rowFailed = true;
        }

        if (
          normalizedKey === "problem_count" &&
          Number.isFinite(numericValue) &&
          numericValue > 0
        ) {
          rowFailed = true;
        }

        if (
          (normalizedKey.endsWith("_present") ||
            normalizedKey === "foreign_key_present" ||
            normalizedKey === "table_present") &&
          Number.isFinite(numericValue) &&
          numericValue < 1
        ) {
          rowFailed = true;
        }

        // Missing-item verification queries return rows only when an item is
        // missing. A zero-valued summary field is not treated as a failure.
        if (
          normalizedKey.startsWith("missing_") &&
          value !== null &&
          value !== undefined &&
          value !== "" &&
          !(Number.isFinite(numericValue) && numericValue === 0)
        ) {
          rowFailed = true;
        }
      }

      const checkName = String(row.check_name || "");
      if (checkName && issueDetailPattern.test(checkName)) {
        const countEntries = entries.filter(([key]) =>
          /(problem_count|duplicate_count|default_count|warning_count)$/i.test(key)
        );

        // Detail queries return no rows when clean. If an issue-named row is
        // returned without a zero count summary, it represents a real problem.
        if (
          countEntries.length === 0 ||
          countEntries.some(([, value]) => Number(value || 0) > 0)
        ) {
          rowFailed = true;
        }
      }

      if (rowFailed) {
        failures.push(JSON.stringify(row));
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `${relativePath} verification failed: ${failures.slice(0, 5).join("; ")}`
    );
  }
}

async function countRows(connection, tableName) {
  const [[row]] = await connection.query(`SELECT COUNT(*) AS count FROM \`${tableName}\``);
  return Number(row.count || 0);
}

async function seedFixtures(connection) {
  const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);

  const [branchAResult] = await connection.query(
    `INSERT INTO branches (code, branch_code, name, location)
     VALUES (?, ?, ?, ?)`,
    ["TST-A", "TST-A", "Acceptance Store A", "Local Test"]
  );
  const branchAId = branchAResult.insertId;

  const [branchBResult] = await connection.query(
    `INSERT INTO branches (code, branch_code, name, location)
     VALUES (?, ?, ?, ?)`,
    ["TST-B", "TST-B", "Acceptance Store B", "Local Test"]
  );
  const branchBId = branchBResult.insertId;

  await connection.query(
    `INSERT INTO business_units (code, name, description, is_enabled, display_order)
     VALUES
       ('spare_parts', 'Spare Parts', 'Acceptance Spare Parts workspace', TRUE, 1),
       ('mining', 'Mining Operations', 'Acceptance Mining workspace', TRUE, 2),
       ('equipment_hire', 'Equipment Hire', 'Acceptance Hire workspace', TRUE, 3)
     ON DUPLICATE KEY UPDATE name = VALUES(name), is_enabled = TRUE`
  );

  const [[miningUnit]] = await connection.query(
    "SELECT id FROM business_units WHERE code = 'mining'"
  );
  const [[hireUnit]] = await connection.query(
    "SELECT id FROM business_units WHERE code = 'equipment_hire'"
  );

  const userRows = [
    ["Acceptance Admin", "accept_admin", "admin", branchAId, true],
    ["Acceptance Cashier", "accept_cashier", "cashier", branchAId, false],
    ["Acceptance Mining Operator", "accept_mining_operator", "staff", branchAId, false],
    ["Acceptance Site Supervisor", "accept_site_supervisor", "staff", branchAId, false],
    ["Acceptance Hire Officer", "accept_hire_officer", "staff", branchAId, false],
    ["Acceptance Dispatcher", "accept_dispatcher", "staff", branchAId, false],
    ["Acceptance Fleet Officer", "accept_fleet_officer", "staff", branchAId, false],
    ["Acceptance Hire Accountant", "accept_hire_accountant", "staff", branchAId, false],
    ["Acceptance Auditor", "accept_auditor", "auditor", branchAId, false],
  ];

  const userIds = {};
  for (const [fullName, username, role, defaultBranchId, allBranches] of userRows) {
    const [result] = await connection.query(
      `INSERT INTO users (
         full_name, username, password_hash, role, default_branch_id,
         can_access_all_branches, is_active, must_change_password
       ) VALUES (?, ?, ?, ?, ?, ?, TRUE, FALSE)`,
      [fullName, username, passwordHash, role, defaultBranchId, allBranches]
    );
    userIds[username] = result.insertId;
    await connection.query(
      `INSERT INTO user_branch_access (user_id, branch_id, access_role, is_primary, can_access)
       VALUES (?, ?, ?, TRUE, TRUE)`,
      [result.insertId, defaultBranchId, role]
    );
  }

  await connection.query(
    `INSERT INTO products (
       branch_id, name, size, category, quantity, cost_price, selling_price,
       low_stock_threshold, barcode, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      branchAId,
      "Acceptance Oil Filter",
      "Standard",
      "Filters",
      10,
      50,
      90,
      2,
      "ACCEPT-FIL-001",
      userIds.accept_admin,
    ]
  );

  const [siteResult] = await connection.query(
    `INSERT INTO mining_sites (
       site_code, site_name, location, material_type, production_unit,
       daily_target, manager_name, status, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      "MINE-TST",
      "Acceptance Mining Site",
      "Local Test",
      "Gold Ore",
      "tonnes",
      100,
      "Acceptance Supervisor",
      userIds.accept_admin,
    ]
  );
  const miningSiteId = siteResult.insertId;

  const [locationResult] = await connection.query(
    `INSERT INTO business_locations (
       business_unit_id, code, name, location_type, address, is_active
     ) VALUES (?, ?, ?, ?, ?, TRUE)`,
    [hireUnit.id, "HIRE-TST", "Acceptance Hire Yard", "yard", "Local Test"]
  );
  const hireLocationId = locationResult.insertId;

  const [fleetAssetResult] = await connection.query(
    `INSERT INTO fleet_assets (
       asset_code, asset_name, asset_type, current_status, current_location,
       meter_type, current_meter, fuel_type, created_by
     ) VALUES (?, ?, ?, 'available', 'Acceptance Yard', 'hour_meter', 100, 'diesel', ?)`,
    ["FLT-TST-001", "Acceptance Excavator", "excavator", userIds.accept_admin]
  );
  const fleetAssetId = fleetAssetResult.insertId;

  const businessAccess = [
    [userIds.accept_mining_operator, miningUnit.id, "equipment_operator", true],
    [userIds.accept_site_supervisor, miningUnit.id, "site_supervisor", true],
    [userIds.accept_auditor, miningUnit.id, "auditor", true],
    [userIds.accept_hire_officer, hireUnit.id, "hire_officer", true],
    [userIds.accept_dispatcher, hireUnit.id, "dispatcher", true],
    [userIds.accept_fleet_officer, hireUnit.id, "fleet_officer", true],
    [userIds.accept_hire_accountant, hireUnit.id, "accountant", true],
    // The same auditor is assigned to both workspaces, but Stage 6A permits
    // only one default workspace per user.
    [userIds.accept_auditor, hireUnit.id, "auditor", false],
  ];

  for (const [userId, businessUnitId, accessRole, isDefault] of businessAccess) {
    await connection.query(
      `INSERT INTO user_business_access (
         user_id, business_unit_id, access_role, can_access, is_default, created_by
       ) VALUES (?, ?, ?, TRUE, ?, ?)`,
      [userId, businessUnitId, accessRole, isDefault, userIds.accept_admin]
    );
  }

  for (const username of [
    "accept_mining_operator",
    "accept_site_supervisor",
    "accept_auditor",
  ]) {
    await connection.query(
      `INSERT INTO user_mining_site_access (user_id, site_id, can_access, is_default, created_by)
       VALUES (?, ?, TRUE, TRUE, ?)`,
      [userIds[username], miningSiteId, userIds.accept_admin]
    );
  }

  for (const username of [
    "accept_hire_officer",
    "accept_dispatcher",
    "accept_fleet_officer",
    "accept_hire_accountant",
    "accept_auditor",
  ]) {
    await connection.query(
      `INSERT INTO user_hire_location_access (user_id, location_id, can_access, is_default, created_by)
       VALUES (?, ?, TRUE, TRUE, ?)`,
      [userIds[username], hireLocationId, userIds.accept_admin]
    );
  }

  await connection.query(
    `INSERT INTO activity_log (
       branch_id, user_id, action, details, workspace_code, entity_type,
       entity_id, action_type, outcome, severity, request_id, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      branchAId,
      userIds.accept_admin,
      "LOCAL_ACCEPTANCE_SMOKE",
      "Local database acceptance fixtures were seeded.",
      "spare_parts",
      "acceptance",
      "local-fixtures",
      "LOCAL_ACCEPTANCE_SMOKE",
      "success",
      "info",
      "local-acceptance",
      JSON.stringify({ branchAId, branchBId, miningSiteId, hireLocationId }),
    ]
  );

  return {
    branchAId,
    branchBId,
    miningSiteId,
    hireLocationId,
    fleetAssetId,
  };
}

async function requestJson(baseUrl, method, urlPath, { token = null, body = null, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data };
}

async function login(baseUrl, username, workspaceCode, branchId = null) {
  const { response, data } = await requestJson(baseUrl, "POST", "/api/auth/login", {
    body: {
      username,
      password: TEST_PASSWORD,
      workspace_code: workspaceCode,
      branch_id: workspaceCode === "spare_parts" ? branchId : null,
    },
  });

  if (!response.ok || !data?.token) {
    throw new Error(`Login failed for ${username} in ${workspaceCode}: ${response.status}`);
  }

  return data.token;
}

function assertStatus(result, allowedStatuses, label) {
  const statuses = Array.isArray(allowedStatuses) ? allowedStatuses : [allowedStatuses];
  if (!statuses.includes(result.response.status)) {
    throw new Error(`${label} expected ${statuses.join("/")} but received ${result.response.status}`);
  }
}

async function runApiAcceptance({ database, host, user, password, fixtures }) {
  process.env.DB_HOST = host;
  process.env.DB_NAME = database;
  process.env.DB_USER = user;
  process.env.DB_PASSWORD = password;
  process.env.JWT_SECRET = process.env.JWT_SECRET || "local-acceptance-secret-change-me";
  process.env.NODE_ENV = "test";

  const { app } = require("../server");
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const health = await requestJson(baseUrl, "GET", "/api/health");
    assertStatus(health, 200, "health");
    if (!health.data?.request_id) throw new Error("health did not return request_id");

    const readiness = await requestJson(baseUrl, "GET", "/api/readiness");
    assertStatus(readiness, [200, 503], "readiness");
    if (readiness.data?.database?.database_name || readiness.data?.missing_configuration) {
      throw new Error("public readiness exposed internal database/configuration details");
    }

    const invalidLogin = await requestJson(baseUrl, "POST", "/api/auth/login", {
      body: {
        username: "accept_admin",
        password: "wrong-password",
        workspace_code: "spare_parts",
        branch_id: fixtures.branchAId,
      },
    });
    assertStatus(invalidLogin, 401, "generic invalid login");

    const adminToken = await login(baseUrl, "accept_admin", "spare_parts", fixtures.branchAId);
    const diagnosticsDenied = await requestJson(baseUrl, "GET", "/api/system/diagnostics");
    assertStatus(diagnosticsDenied, 401, "diagnostics without token");
    const diagnostics = await requestJson(baseUrl, "GET", "/api/system/diagnostics", {
      token: adminToken,
    });
    assertStatus(diagnostics, 200, "diagnostics with admin token");

    const cashierToken = await login(baseUrl, "accept_cashier", "spare_parts", fixtures.branchAId);
    assertStatus(
      await requestJson(baseUrl, "GET", "/api/mining/dashboard", { token: cashierToken }),
      403,
      "cashier denied Mining"
    );
    assertStatus(
      await requestJson(baseUrl, "GET", "/api/fleet/assets", { token: cashierToken }),
      403,
      "cashier denied Fleet"
    );

    const operatorToken = await login(baseUrl, "accept_mining_operator", "mining");
    assertStatus(
      await requestJson(baseUrl, "GET", "/api/fleet/assets", { token: operatorToken }),
      200,
      "Mining equipment operator can view Fleet"
    );
    assertStatus(
      await requestJson(baseUrl, "POST", `/api/fleet/assets/${fixtures.fleetAssetId}/meter-readings`, {
        token: operatorToken,
        body: {
          reading_value: 110,
          reading_datetime: new Date().toISOString(),
          source_type: "manual",
        },
      }),
      [200, 201],
      "Mining equipment operator can record meter"
    );
    assertStatus(
      await requestJson(baseUrl, "POST", "/api/fleet/assets", {
        token: operatorToken,
        body: {},
      }),
      403,
      "Mining equipment operator cannot manage assets"
    );

    const hireOfficerToken = await login(baseUrl, "accept_hire_officer", "equipment_hire");
    assertStatus(
      await requestJson(baseUrl, "GET", "/api/equipment-hire/availability", {
        token: hireOfficerToken,
        headers: { "x-chalin03-context-id": String(fixtures.hireLocationId) },
      }),
      200,
      "Hire officer can view availability"
    );
    assertStatus(
      await requestJson(baseUrl, "POST", "/api/equipment-hire/dispatches", {
        token: hireOfficerToken,
        headers: { "x-chalin03-context-id": String(fixtures.hireLocationId) },
        body: {},
      }),
      403,
      "Hire officer cannot dispatch"
    );

    const dispatcherToken = await login(baseUrl, "accept_dispatcher", "equipment_hire");
    assertStatus(
      await requestJson(baseUrl, "POST", "/api/equipment-hire/dispatches", {
        token: dispatcherToken,
        headers: { "x-chalin03-context-id": String(fixtures.hireLocationId) },
        body: {},
      }),
      [400, 404],
      "Dispatcher reaches dispatch validation"
    );
    assertStatus(
      await requestJson(baseUrl, "POST", "/api/equipment-hire/payments", {
        token: dispatcherToken,
        headers: { "x-chalin03-context-id": String(fixtures.hireLocationId) },
        body: {},
      }),
      403,
      "Dispatcher cannot pay"
    );

    const fleetOfficerToken = await login(baseUrl, "accept_fleet_officer", "equipment_hire");
    assertStatus(
      await requestJson(baseUrl, "POST", "/api/fleet/assets", {
        token: fleetOfficerToken,
        body: {
          asset_code: "FLT-TST-002",
          asset_name: "Acceptance Loader",
          asset_type: "wheel_loader",
          current_status: "available",
          current_meter: 1,
          meter_type: "hour_meter",
        },
      }),
      201,
      "Fleet officer can manage Fleet"
    );
    assertStatus(
      await requestJson(baseUrl, "GET", "/api/equipment-hire/payments", {
        token: fleetOfficerToken,
        headers: { "x-chalin03-context-id": String(fixtures.hireLocationId) },
      }),
      403,
      "Fleet officer cannot access Hire finance"
    );

    const accountantToken = await login(baseUrl, "accept_hire_accountant", "equipment_hire");
    assertStatus(
      await requestJson(baseUrl, "POST", "/api/equipment-hire/payments", {
        token: accountantToken,
        headers: { "x-chalin03-context-id": String(fixtures.hireLocationId) },
        body: {},
      }),
      [400, 404],
      "Hire accountant reaches payment validation"
    );
    assertStatus(
      await requestJson(baseUrl, "POST", "/api/equipment-hire/dispatches", {
        token: accountantToken,
        headers: { "x-chalin03-context-id": String(fixtures.hireLocationId) },
        body: {},
      }),
      403,
      "Hire accountant cannot dispatch"
    );

    console.log("PASS - guarded API route acceptance checks completed through Express.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const host = argValue("--host", process.env.DB_HOST || process.env.MYSQLHOST || "localhost");
  const database = argValue("--database", "chalin03_full_test");
  const user = argValue("--user", process.env.DB_USER || process.env.MYSQLUSER || "root");
  const password = argValue("--password", process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || "");
  const confirm = hasArg("--confirm");
  const skipApi = hasArg("--skip-api");

  assertSafeTarget({ host, database, confirm });

  const adminConnection = await mysql.createConnection({
    host,
    user,
    password,
    multipleStatements: true,
  });

  try {
    await adminConnection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await adminConnection.query(`CREATE DATABASE \`${database}\``);
    await adminConnection.changeUser({ database });
    await executeSqlScript(adminConnection, readSql("database/schema.sql"), "database/schema.sql");

    const orderedFiles = orderedSqlFiles();
    const migrationFiles = orderedFiles.filter((file) => !isVerificationFile(file));
    const verificationFiles = orderedFiles.filter((file) => isVerificationFile(file));

    for (const relativePath of migrationFiles) {
      await executeSqlFile(adminConnection, relativePath);
    }

    const [[migrationCount]] = await adminConnection.query(
      `SELECT COUNT(*) AS count
       FROM schema_migrations
       WHERE migration_name IN (${migrationFiles.map(() => "?").join(", ")})`,
      migrationFiles.map((file) => path.basename(file))
    );
    if (Number(migrationCount.count || 0) !== migrationFiles.length) {
      throw new Error("Not every ordered migration was recorded in schema_migrations.");
    }

    // Seed controlled fixtures before data-integrity verification. Stage 6A
    // requires at least one active administrator, which a fresh empty schema
    // intentionally does not contain before fixture seeding.
    const fixtures = await seedFixtures(adminConnection);

    for (const relativePath of verificationFiles) {
      await executeSqlFile(adminConnection, relativePath);
    }

    if ((await countRows(adminConnection, "branches")) < 2) {
      throw new Error("Branch fixtures were not seeded.");
    }
    if ((await countRows(adminConnection, "activity_log")) < 1) {
      throw new Error("Structured audit smoke row was not recorded.");
    }

    if (!skipApi) {
      await adminConnection.end();
      await runApiAcceptance({ database, host, user, password, fixtures });
    }

    console.log("PASS - local _test database schema, ordered SQL files, fixtures and verification completed.");
    console.log("PASS - normal chalin03_db was not touched.");
  } finally {
    try {
      if (adminConnection.connection?._closing !== true) {
        await adminConnection.end();
      }
    } catch {
      // ignore close races after API phase closes it explicitly
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FAIL - ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  assertSafeTarget,
  orderedSqlFiles,
  assertVerificationPassed,
};
