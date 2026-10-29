"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isRetryableStandaloneRead,
  isTransientDatabaseConnectError,
  retryStandaloneRead,
} = require("../config/db");

test("Only standalone read queries qualify for bounded database wake retry", () => {
  for (const sql of ["SELECT 1", "SHOW TABLES", "DESCRIBE fleet_assets", "EXPLAIN SELECT * FROM fleet_assets"]) {
    assert.equal(isRetryableStandaloneRead(sql), true, sql);
  }
  for (const sql of [
    "INSERT INTO equipment_sale_payments VALUES (1)",
    "UPDATE equipment_credit_applications SET application_status = 'approved'",
    "DELETE FROM equipment_sale_agreements WHERE id = 1",
    "START TRANSACTION",
    "SELECT id FROM fleet_assets FOR UPDATE",
    "SELECT GET_LOCK('finance', 5)",
    "SELECT 1; DELETE FROM fleet_assets",
  ]) assert.equal(isRetryableStandaloneRead(sql), false, sql);
});

test("Wrapped ECONNREFUSED in AggregateError is transient, not a SQL schema error", () => {
  assert.equal(isTransientDatabaseConnectError(new AggregateError([
    Object.assign(new Error("down"), { code: "ECONNREFUSED" }),
  ])), true);
  assert.equal(isTransientDatabaseConnectError({ code: "ER_NO_SUCH_TABLE" }), false);
});

test("Read-only retry recovers once without repeating a write", async () => {
  let calls = 0;
  const wrapper = retryStandaloneRead(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("waking"), { code: "ECONNREFUSED" });
    return [[{ ok: 1 }], []];
  }, { delays: [0], pause: async () => {} });
  const [rows] = await wrapper("SELECT 1");
  assert.equal(rows[0].ok, 1);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(() => wrapper("UPDATE equipment_sale_payments SET amount=100"), /waking/);
  assert.equal(calls, 1);
});

test("No retries for invalid SQL or repeated connectivity failure", async () => {
  let calls = 0;
  const wrapper = retryStandaloneRead(async () => {
    calls += 1;
    throw Object.assign(new Error("table missing"), { code: "ER_NO_SUCH_TABLE" });
  }, { delays: [0, 0], pause: async () => {} });
  await assert.rejects(() => wrapper("SELECT * FROM missing_table"), /table missing/);
  assert.equal(calls, 1);
});
