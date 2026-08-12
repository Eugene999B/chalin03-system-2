"use strict";

const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");

const ALLOWED_DATABASE = /^chalin_one_operational_acceptance(?:_[a-z0-9_]+)?$/i;
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const SMOKE_PASSWORD = "ChalinAdminSmoke#2026";

function clean(value) {
  return String(value ?? "").trim();
}

function assertIsolatedSmokeTarget(env = process.env) {
  const nodeEnvironment = clean(env.NODE_ENV).toLowerCase();
  const host = clean(env.DB_HOST || env.MYSQLHOST || env.MYSQL_HOST).toLowerCase();
  const database = clean(env.DB_NAME || env.MYSQLDATABASE || env.MYSQL_DATABASE);

  if (nodeEnvironment !== "test") {
    throw new Error("Authenticated Admin smoke is restricted to NODE_ENV=test.");
  }
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`Authenticated Admin smoke refuses non-local database host: ${host || "missing"}.`);
  }
  if (!ALLOWED_DATABASE.test(database) || /railway|production/i.test(database)) {
    throw new Error(
      `Authenticated Admin smoke requires the isolated operational acceptance database, received: ${database || "missing"}.`
    );
  }

  return Object.freeze({ host, database });
}

async function seedSmokeIdentity() {
  const passwordHash = await bcrypt.hash(SMOKE_PASSWORD, 10);
  const connection = await pool.getConnection();

  try {
    await connection.query(
      `INSERT INTO branches (
         id, code, branch_code, name, location, phone, is_head_office, is_active
       ) VALUES (1, 'ADMIN-SMOKE', 'ADMIN-SMOKE', 'Admin Smoke Store', 'CI only', '0000000000', TRUE, TRUE)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         branch_code = VALUES(branch_code),
         name = VALUES(name),
         location = VALUES(location),
         is_head_office = TRUE,
         is_active = TRUE`
    );

    await connection.query(
      `INSERT INTO business_units (id, code, name, description, is_enabled, display_order)
       VALUES
         (1, 'spare_parts', 'Spare Parts', 'CI Admin smoke business unit', TRUE, 1),
         (2, 'mining', 'Mining Operations', 'CI Admin smoke business unit', TRUE, 2),
         (3, 'equipment_hire', 'Equipment Hire', 'CI Admin smoke business unit', TRUE, 3)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         is_enabled = TRUE,
         display_order = VALUES(display_order)`
    );

    await connection.query(
      `INSERT INTO business_locations (
         id, business_unit_id, code, name, location_type, address, phone, is_active
       ) VALUES (1, 1, 'ADMIN-SMOKE', 'Admin Smoke Store', 'store', 'CI only', '0000000000', TRUE)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         is_active = TRUE`
    );

    await connection.query(
      `INSERT INTO users (
         id, full_name, username, password_hash, role, phone, default_branch_id,
         can_access_all_branches, is_active, must_change_password, token_version,
         primary_workspace_code, category_assignment_status, category_conflict_reason
       ) VALUES (
         1, 'CHALIN ONE Admin Smoke', 'admin', ?, 'admin', NULL, 1,
         TRUE, TRUE, FALSE, 0, '*', 'system_admin', NULL
       )
       ON DUPLICATE KEY UPDATE
         full_name = VALUES(full_name),
         password_hash = VALUES(password_hash),
         role = 'admin',
         default_branch_id = 1,
         can_access_all_branches = TRUE,
         is_active = TRUE,
         must_change_password = FALSE,
         token_version = 0,
         primary_workspace_code = '*',
         category_assignment_status = 'system_admin',
         category_conflict_reason = NULL`,
      [passwordHash]
    );

    await connection.query(
      `INSERT INTO user_branch_access (
         user_id, branch_id, access_role, is_primary, can_access
       ) VALUES (1, 1, 'admin', TRUE, TRUE)
       ON DUPLICATE KEY UPDATE
         access_role = 'admin',
         is_primary = TRUE,
         can_access = TRUE`
    );

    await connection.query(
      `INSERT INTO user_business_access (
         user_id, business_unit_id, access_role, can_access, is_default, created_by
       ) VALUES (1, 1, 'admin', TRUE, TRUE, NULL)
       ON DUPLICATE KEY UPDATE
         access_role = 'admin',
         can_access = TRUE,
         is_default = TRUE`
    );

    await connection.query(
      `INSERT INTO worker_profiles (
         id, employee_number, user_id, full_name, job_title, department,
         employment_type, employment_status, workspace_code, business_unit_id,
         created_by, updated_by
       ) VALUES (
         1, 'CI-ADMIN-SMOKE-001', NULL, 'Admin Smoke Worker', 'Store Assistant', 'Operations',
         'permanent', 'active', 'spare_parts', NULL, 1, 1
       )
       ON DUPLICATE KEY UPDATE
         employee_number = VALUES(employee_number),
         full_name = VALUES(full_name),
         employment_status = 'active',
         workspace_code = 'spare_parts',
         business_unit_id = NULL`
    );
  } finally {
    connection.release();
  }
}

async function startLocalApp() {
  const { app } = require("../server");

  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
    server.once("error", reject);
  });
}

async function requestJson(origin, path, { token = null, method = "GET", body = null } = {}) {
  const headers = {
    Accept: "application/json",
    "User-Agent": "chalin-one-admin-authenticated-smoke",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers["Content-Type"] = "application/json";

  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${path} returned non-JSON HTTP ${response.status}.`);
  }

  if (!response.ok) {
    throw new Error(
      `${method} ${path} failed with HTTP ${response.status}: ${payload?.code || payload?.message || payload?.status || "unknown error"}`
    );
  }

  return payload;
}

function expectArray(payload, key, label) {
  if (!Array.isArray(payload?.[key])) {
    throw new Error(`${label} did not return an array at ${key}.`);
  }
}

function expectObject(payload, key, label) {
  if (!payload?.[key] || typeof payload[key] !== "object" || Array.isArray(payload[key])) {
    throw new Error(`${label} did not return an object at ${key}.`);
  }
}

async function login(origin) {
  const payload = await requestJson(origin, "/api/auth/login", {
    method: "POST",
    body: {
      identifier: "admin",
      password: SMOKE_PASSWORD,
      workspace_code: "spare_parts",
      branch_id: 1,
    },
  });

  if (payload?.status !== "success" || !payload?.token) {
    throw new Error("CI original System Administrator could not establish a real authenticated session.");
  }
  if (Number(payload?.user?.id) !== 1 || payload?.user?.username !== "admin") {
    throw new Error("Authenticated Admin smoke did not resolve the protected original administrator identity.");
  }

  return payload.token;
}

async function runMatrix(origin, token) {
  const matrix = [
    {
      page: "Users & Settings",
      requests: [
        ["/api/branches", (payload) => {
          if (!Array.isArray(payload?.branches) && !Array.isArray(payload)) {
            throw new Error("Branches route did not return a branch collection.");
          }
        }],
        ["/api/users", (payload) => expectArray(payload, "users", "Users page")],
        ["/api/settings", (payload) => expectObject(payload, "settings", "Users settings page")],
      ],
    },
    {
      page: "User Permission Manager",
      requests: [
        ["/api/user-permissions/catalog?workspace_code=spare_parts", (payload) =>
          expectArray(payload, "permissions", "Permission catalog")],
        ["/api/user-permissions/users?workspace_code=spare_parts", (payload) =>
          expectArray(payload, "users", "Permission user list")],
        ["/api/user-permissions/category-conflicts", (payload) => {
          expectArray(payload, "conflicts", "User category conflicts");
          expectArray(payload, "worker_conflicts", "Worker category conflicts");
        }],
        ["/api/user-permissions/users/1?workspace_code=spare_parts", (payload) => {
          if (Number(payload?.user?.id || payload?.id || 0) !== 1) {
            throw new Error("Permission detail did not resolve the selected admin user.");
          }
          if (!Array.isArray(payload?.permission_state?.effective_permissions)) {
            throw new Error("Permission detail did not return permission_state.effective_permissions.");
          }
        }],
      ],
    },
    {
      page: "Activity / Audit Trail",
      requests: [
        ["/api/activity-log?page=1&limit=50", (payload) => {
          expectArray(payload, "logs", "Activity log");
          expectObject(payload, "summary", "Activity log summary");
        }],
      ],
    },
    {
      page: "Security Centre",
      requests: [
        ["/api/release2-final/security/overview", (payload) => {
          if (payload?.status !== "success") throw new Error("Security overview did not report success.");
        }],
        ["/api/release2-final/security/owner-readiness", (payload) => {
          if (payload?.status !== "success") throw new Error("Owner readiness did not report success.");
        }],
        ["/api/release2-final/security/owner-login-history", (payload) =>
          expectArray(payload, "login_history", "Owner login history")],
      ],
    },
    {
      page: "Backup Centre",
      requests: [
        ["/api/release2-final/backups/history", (payload) => {
          if (payload?.status !== "success") throw new Error("Backup history did not report success.");
          expectArray(payload, "backups", "Backup history");
        }],
      ],
    },
    {
      page: "Worker Profiles",
      requests: [
        ["/api/release2-final/workers-expanded", (payload) =>
          expectArray(payload, "workers", "Worker list")],
        ["/api/release2-final/workers-expanded/options", (payload) =>
          expectObject(payload, "options", "Worker options")],
        ["/api/release2-final/workers-expanded/1", (payload) => {
          if (Number(payload?.worker?.profile?.id || 0) !== 1) {
            throw new Error("Worker detail did not resolve the seeded worker profile.");
          }
        }],
      ],
    },
    {
      page: "System Diagnostics",
      requests: [
        ["/api/system/diagnostics", (payload) => {
          if (payload?.status !== "success") throw new Error("System diagnostics did not report success.");
          expectObject(payload, "diagnostics", "System diagnostics");
        }],
      ],
    },
  ];

  const report = [];
  for (const group of matrix) {
    const requests = [];
    for (const [path, assertion] of group.requests) {
      const payload = await requestJson(origin, path, { token });
      assertion(payload);
      requests.push(Object.freeze({ path, status: "success" }));
      console.log(`ADMIN SMOKE PASS [${group.page}] ${path}`);
    }
    report.push(Object.freeze({ page: group.page, requests: Object.freeze(requests) }));
  }

  return Object.freeze(report);
}

async function runChalinOneAdminAuthenticatedSmoke() {
  const safety = assertIsolatedSmokeTarget();
  if (!clean(process.env.JWT_SECRET)) {
    throw new Error("JWT_SECRET is required for the authenticated Admin smoke.");
  }

  await seedSmokeIdentity();
  const { server, origin } = await startLocalApp();

  try {
    const token = await login(origin);
    const matrix = await runMatrix(origin, token);
    const result = Object.freeze({
      status: "success",
      database: safety.database,
      database_host: safety.host,
      server_origin: origin,
      authenticated_as_original_system_administrator: true,
      pages_verified: matrix.length,
      matrix,
      mutation_endpoints_called: false,
      staging_credentials_used: false,
      production_checked: false,
    });
    console.log("CHALIN ONE authenticated Admin smoke matrix passed.");
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  runChalinOneAdminAuthenticatedSmoke().catch(async (error) => {
    console.error(`CHALIN ONE authenticated Admin smoke failed: ${error.message}`);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = {
  ALLOWED_DATABASE,
  ALLOWED_HOSTS,
  SMOKE_PASSWORD,
  assertIsolatedSmokeTarget,
  login,
  requestJson,
  runChalinOneAdminAuthenticatedSmoke,
  runMatrix,
  seedSmokeIdentity,
};
