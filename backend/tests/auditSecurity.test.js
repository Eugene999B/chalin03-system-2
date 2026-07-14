const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const { pool } = require("../config/db");
const activityRoutes = require("../routes/activityRoutes");
const {
  getRequestAuditContext,
  sanitizeMetadata,
} = require("../services/auditTrailService");
const { safeErrorResponseMiddleware } = require("../middleware/errorHandler");

test("audit context assigns shared context id only to active Mining workspace", () => {
  const context = getRequestAuditContext({
    requestId: "req-mining",
    headers: {
      "x-chalin03-context-id": "42",
    },
    user: {
      workspace_code: "mining",
      business_unit_id: 2,
    },
  });

  assert.equal(context.mining_site_id, "42");
  assert.equal(context.hire_location_id, null);
});

test("audit context assigns shared context id only to active Hire workspace", () => {
  const context = getRequestAuditContext({
    requestId: "req-hire",
    headers: {
      "x-chalin03-context-id": "9",
    },
    user: {
      workspace_code: "equipment_hire",
      business_unit_id: 3,
    },
  });

  assert.equal(context.mining_site_id, null);
  assert.equal(context.hire_location_id, "9");
});

test("audit scope restricts Mining auditor to assigned sites", async () => {
  const originalQuery = pool.query;
  pool.query = async (sql, params) => {
    assert.match(sql, /user_mining_site_access/);
    assert.deepEqual(params, [77]);
    return [[{ site_id: 4 }, { site_id: 5 }]];
  };

  try {
    const scope = await activityRoutes.__private.loadUserScope(
      {
        user: {
          id: 77,
          role: "auditor",
          workspace_code: "mining",
        },
      },
      new Set(["workspace_code", "mining_site_id"])
    );

    assert.deepEqual(scope.where, [
      "al.workspace_code = 'mining'",
      "al.mining_site_id IN (?, ?)",
    ]);
    assert.deepEqual(scope.params, [4, 5]);
  } finally {
    pool.query = originalQuery;
  }
});

test("audit scope denies Hire auditor with no assigned locations", async () => {
  const originalQuery = pool.query;
  pool.query = async () => [[]];

  try {
    const scope = await activityRoutes.__private.loadUserScope(
      {
        user: {
          id: 88,
          role: "auditor",
          workspace_code: "equipment_hire",
        },
      },
      new Set(["workspace_code", "hire_location_id"])
    );

    assert.deepEqual(scope.where, ["1 = 0"]);
    assert.deepEqual(scope.params, []);
  } finally {
    pool.query = originalQuery;
  }
});

test("safe error response middleware strips technical fields from legacy route errors", () => {
  const req = { requestId: "req-safe" };
  const res = {
    statusCode: 500,
    sent: null,
    json(payload) {
      this.sent = payload;
      return payload;
    },
  };

  safeErrorResponseMiddleware(req, res, () => {});
  res.json({
    status: "error",
    message: "SQL failed with password token details",
    details: "stack trace and connection string",
    technical_message: "ER_BAD_FIELD_ERROR",
  });

  assert.equal(res.sent.message, "The request could not be completed safely.");
  assert.equal(res.sent.details, undefined);
  assert.equal(res.sent.technical_message, undefined);
  assert.equal(res.sent.request_id, "req-safe");
});

test("metadata redaction removes secret-shaped fields", () => {
  assert.deepEqual(
    sanitizeMetadata({
      username: "staff",
      password: "hidden",
      nested: { api_key: "hidden-too" },
    }),
    {
      username: "staff",
      password: "[REDACTED]",
      nested: { api_key: "[REDACTED]" },
    }
  );
});

test("public sms debug endpoint is not registered in server source", () => {
  const serverSource = readFileSync(join(__dirname, "../server.js"), "utf8");
  assert.doesNotMatch(serverSource, /debug\/sms-env/);
});
