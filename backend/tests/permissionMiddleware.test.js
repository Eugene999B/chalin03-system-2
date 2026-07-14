const test = require("node:test");
const assert = require("node:assert/strict");

const {
  routePermissionForWorkspace,
  requirePermission,
} = require("../middleware/permissionMiddleware");

function req(method, path, body = {}) {
  return {
    method,
    path,
    body,
    requestId: "test-request",
    user: {
      role: "staff",
      workspace_code: "mining",
      workspace_role: "site_clerk",
    },
  };
}

test("mining route guard maps approvals to approval permissions", () => {
  assert.equal(
    routePermissionForWorkspace("mining", req("PATCH", "/production/7/approve")),
    "mining.production.approve"
  );
  assert.equal(
    routePermissionForWorkspace("mining", req("POST", "/daily-logs")),
    "mining.daily_logs.create"
  );
});

test("hire route guard separates dispatch, payments and closure permissions", () => {
  assert.equal(
    routePermissionForWorkspace("equipment_hire", req("GET", "/availability")),
    "fleet.assets.view"
  );
  assert.equal(
    routePermissionForWorkspace("equipment_hire", req("POST", "/dispatches")),
    "hire.dispatch.manage"
  );
  assert.equal(
    routePermissionForWorkspace("equipment_hire", req("DELETE", "/contract-assets/9")),
    "hire.contracts.manage"
  );
  assert.equal(
    routePermissionForWorkspace("equipment_hire", req("POST", "/payments")),
    "hire.payments.manage"
  );
  assert.equal(
    routePermissionForWorkspace(
      "equipment_hire",
      req("PATCH", "/contracts/4/close", { close_type: "financial" })
    ),
    "hire.contracts.close_financial"
  );
});

test("fleet route guard maps nested asset actions to exact fleet permissions", () => {
  assert.equal(
    routePermissionForWorkspace("fleet", req("GET", "/assets/4")),
    "fleet.assets.view"
  );
  assert.equal(
    routePermissionForWorkspace("fleet", req("POST", "/assets/4/meter-readings")),
    "fleet.meter.manage"
  );
  assert.equal(
    routePermissionForWorkspace("fleet", req("POST", "/assets/4/fuel-logs")),
    "fleet.fuel.manage"
  );
  assert.equal(
    routePermissionForWorkspace("fleet", req("POST", "/assets/4/maintenance")),
    "fleet.maintenance.manage"
  );
  assert.equal(
    routePermissionForWorkspace("fleet", req("POST", "/assets/4/inspections")),
    "fleet.inspections.manage"
  );
});

test("requirePermission denies missing permission with request ID", () => {
  const middleware = requirePermission("mining.production.approve");
  const request = req("PATCH", "/production/7/approve");
  let statusCode = 200;
  let payload = null;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      payload = data;
      return this;
    },
  };

  middleware(request, response, () => {
    throw new Error("middleware should not allow this request");
  });

  assert.equal(statusCode, 403);
  assert.equal(payload.code, "PERMISSION_DENIED");
  assert.equal(payload.request_id, "test-request");
});
