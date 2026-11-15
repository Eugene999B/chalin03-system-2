"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const routePath = path.resolve(__dirname, "../routes/equipmentFinanceReadyCashRoutes.js");
const SYNTHETIC_UUID = ["e95f9365", "6ca0", "44a3", "8661", "f760097c4200"].join("-");

function loadWithFakeLedger(options = {}) {
  const calls = [];
  const state = { began: 0, committed: 0, rolledBack: 0, released: 0, connections: 0 };
  let insertId = 10;
  const simulate = async (statement, args) => {
    const sql = String(statement).replace(/\s+/g, " ").trim();
    calls.push({ sql, args });
    if (options.failOn && sql.includes(options.failOn)) {
      throw new Error("Synthetic database insert failure");
    }
    if (sql.includes("WHERE p.idempotency_key = ? LIMIT 1")) {
      return [options.previous ? [options.previous] : []];
    }
    if (sql.includes("SELECT agreement_id FROM equipment_sale_payments WHERE idempotency_key")) return [[]];
    if (sql.includes("FROM hire_customers WHERE id = ?")) {
      return [[{ id: 17, customer_name: "Synthetic Finance Customer", phone: "0240000000", address: "Test Only" }]];
    }
    if (sql.includes("FROM fleet_assets WHERE id = ? AND is_active")) {
      return [[{
        id: 31, operational_purpose: "sale_only", sale_status: "available",
        asset_code: "TEST-EX-031", asset_name: "Synthetic Excavator", asset_type: "excavator",
        target_selling_price: "100.00", make: "TestMake", model: "TestModel", serial_number: "SYNTHETIC-31",
      }]];
    }
    if (sql.includes("AS active_sale_locks")) {
      return [[{
        active_sale_locks: 0, active_hires: 0, active_finance_applications: 0,
        existing_sales: 0,
      }]];
    }
    if (sql.includes("FROM equipment_sale_agreements") && sql.includes("READY_CASH:%")) {
      return [[{
        id: 22, customer_id: 17, asset_id: 31,
        total_amount: "100.00", amount_paid: "100.00", outstanding_balance: "0.00",
        sale_type: "cash", agreement_notes: "READY_CASH: synthetic",
        created_by: options.createdBy ?? 2, ownership_status: "retained",
      }]];
    }
    if (sql.includes("SELECT id FROM equipment_sale_payments") && sql.includes("payment_category = 'settlement'")) {
      return [[{ id: 44 }]];
    }
    if (sql.includes("net_collected")) return [[{ net_collected: "100.00" }]];
    if (sql.includes("SELECT id FROM equipment_deliveries")) return [[]];
    if (sql.includes("SELECT id, sale_status FROM fleet_assets WHERE id = ?")) {
      return [[{ id: 31, sale_status: "reserved" }]];
    }
    if (sql.includes("SELECT agreement_id, lock_status FROM equipment_asset_sale_locks")) {
      return [[{ agreement_id: 22, lock_status: "reserved" }]];
    }
    if (sql.startsWith("INSERT")) return [{ insertId: ++insertId, affectedRows: 1 }];
    if (sql.startsWith("UPDATE")) return [{ affectedRows: 1 }];
    throw new Error("Synthetic fixture needs query handler: " + sql.slice(0, 140));
  };
  const connection = {
    query: simulate,
    beginTransaction: async () => { state.began++; },
    commit: async () => { state.committed++; },
    rollback: async () => { state.rolledBack++; },
    release: () => { state.released++; },
  };
  const pool = {
    getConnection: async () => { state.connections++; return connection; },
    query: simulate,
  };
  const original = Module._load;
  try {
    Module._load = function mocked(request, parent, isMain) {
      if (parent?.filename === routePath) {
        if (request === "../config/db") return { pool };
        if (request === "../middleware/permissionMiddleware") {
          return { requirePermission: () => (_req, _res, next) => next() };
        }
        if (request === "../services/groupConfigurationService") {
          return { nextDocumentNumber: async (name) => "SYNTHETIC-" + name };
        }
        if (request === "../services/auditTrailService") {
          return { writeAuditEvent: async () => null };
        }
        if (request === "../security/equipmentDivisionAccess") {
          return {
            workspaceRoleFor: () => "finance_manager",
            isEquipmentAdministrator: () => false,
          };
        }
      }
      return original.apply(this, arguments);
    };
    delete require.cache[routePath];
    const router = require(routePath);
    return { router, calls, state };
  } finally {
    Module._load = original;
    delete require.cache[routePath];
  }
}

async function requestRoute(router, routePathValue, body, userId = 2) {
  const match = router.stack.find((layer) =>
    layer.route?.path === routePathValue && layer.route?.methods?.post
  );
  assert.ok(match, "Route missing: " + routePathValue);
  const handler = match.route.stack.at(-1).handle;
  const req = {
    body, user: { id: userId, role: "finance_manager" },
    params: { agreementId: "22" },
  };
  const response = { code: 200, payload: null,
    status(value) { this.code = value; return this; },
    json(value) { this.payload = value; return this; },
  };
  await handler(req, response);
  return response;
}

function checkoutBody(overrides = {}) {
  return {
    sale_option: "ready_cash",
    customer_id: 17,
    asset_id: 31,
    amount: "100.00",
    tax_amount_included: "15.00",
    tax_treatment_reviewed: true,
    full_payment_confirmed: true,
    customer_terms_accepted: true,
    full_payment_reference: "TEST-RECEIPT-NO-MONEY",
    idempotency_key: SYNTHETIC_UUID,
    ...overrides,
  };
}

test("synthetic Ready Cash checkout records one net-and-tax receipt, zero debt and a reserved asset", async () => {
  const { router, state, calls } = loadWithFakeLedger();
  const result = await requestRoute(router, "/ready-cash/checkout", checkoutBody());
  assert.equal(result.code, 201);
  assert.equal(result.payload.paid_in_full, true);
  assert.equal(result.payload.outstanding_balance, 0);
  assert.equal(state.began, 1);
  assert.equal(state.committed, 1);
  assert.equal(state.rolledBack, 0);
  const quote = calls.find((item) => item.sql.includes("INSERT INTO equipment_sales_quotations SET"));
  const payment = calls.find((item) => item.sql.includes("INSERT INTO equipment_sale_payments SET"));
  const agreement = calls.find((item) => item.sql.includes("INSERT INTO equipment_sale_agreements SET"));
  assert.equal(quote.args.subtotal, 85);
  assert.equal(quote.args.tax_amount, 15);
  assert.equal(quote.args.total_amount, 100);
  assert.equal(payment.args.payment_method, "other");
  assert.equal(payment.args.amount, 100);
  assert.equal(agreement.args.financed_amount, 0);
  assert.equal(agreement.args.outstanding_balance, 0);
  assert.equal(calls.filter((item) => item.sql.includes("INSERT INTO equipment_installment_schedule")).length, 0);
});

test("synthetic Ready Cash refuses unknown tax and never initiates a payment", async () => {
  const { router, state, calls } = loadWithFakeLedger();
  const result = await requestRoute(router, "/ready-cash/checkout", checkoutBody({
    tax_amount_included: "", tax_treatment_reviewed: false,
  }));
  assert.equal(result.code, 400);
  assert.equal(result.payload.code, "READY_CASH_TAX_REVIEW_REQUIRED");
  assert.equal(state.connections, 0);
  assert.equal(calls.length, 0);
});

test("synthetic failed payment insert rolls back the whole cash sale", async () => {
  const { router, state, calls } = loadWithFakeLedger({
    failOn: "INSERT INTO equipment_sale_payments SET",
  });
  const oldError = console.error;
  console.error = () => {};
  try {
    const response = await requestRoute(router, "/ready-cash/checkout", checkoutBody());
    assert.equal(response.code, 500);
  } finally {
    console.error = oldError;
  }
  assert.equal(state.began, 1);
  assert.equal(state.committed, 0);
  assert.equal(state.rolledBack, 1);
  assert.equal(state.released, 1);
  assert.ok(calls.some((item) => item.sql.includes("INSERT INTO equipment_sale_agreements SET")));
});

test("synthetic handover blocks the cashier and commits for a different authorized manager", async () => {
  const first = loadWithFakeLedger({ createdBy: 2 });
  const body = {
    receiving_person: "Synthetic Receiver",
    handover_reference: "SIGNED-TEST-001",
    condition_status: "good",
    signed_handover_confirmed: true,
  };
  const denied = await requestRoute(first.router, "/ready-cash/:agreementId/handover", body, 2);
  assert.equal(denied.code, 403);
  assert.equal(denied.payload.code, "READY_CASH_INDEPENDENT_HANDOVER_REQUIRED");
  assert.equal(first.state.committed, 0);
  assert.equal(first.state.rolledBack, 1);

  const second = loadWithFakeLedger({ createdBy: 2 });
  const approved = await requestRoute(second.router, "/ready-cash/:agreementId/handover", body, 9);
  assert.equal(approved.code, 201);
  assert.equal(approved.payload.sold, true);
  assert.equal(second.state.committed, 1);
  assert.ok(second.calls.some((item) =>
    item.sql.includes("INSERT INTO equipment_ownership_transfers SET")
  ));
  assert.ok(second.calls.some((item) =>
    item.sql.includes("UPDATE fleet_assets SET sale_status = 'sold'")
  ));
});
