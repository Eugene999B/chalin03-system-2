const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function harness({ status = null, result = { ok: true, status: "submitted" }, throws = false } = {}) {
  let sends = 0;
  let state = status;
  const queries = [];
  const pool = { async query(sql, args = []) {
    queries.push(sql);
    if (sql.includes("information_schema.TABLES")) return [[
      "equipment_finance_phase6_message_log", "equipment_finance_phase6_runtime_state",
      "equipment_finance_phase6_export_log"
    ].map(TABLE_NAME => ({ TABLE_NAME }))];
    if (sql.includes("SELECT payment.id, payment.payment_number")) return [[{
      id: 7, agreement_id: 2, customer_phone: "0240000000", customer_name: "Test",
      amount: 10, payment_date: "2026-10-05", payment_stage: "installment"
    }]];
    if (sql.includes("INSERT IGNORE")) {
      if (state) return [{ affectedRows: 0 }];
      state = "pending"; return [{ affectedRows: 1 }];
    }
    if (sql.includes("attempt_count = attempt_count + 1")) {
      if (!["failed", "skipped"].includes(state)) return [{ affectedRows: 0 }];
      state = "pending"; return [{ affectedRows: 1 }];
    }
    if (sql.includes("SET delivery_status = ?")) { state = args[0]; return [{ affectedRows: 1 }]; }
    if (sql.includes("SET delivery_status = 'delivery_unknown'")) { state = "delivery_unknown"; return [{ affectedRows: 1 }]; }
    if (sql.includes("SELECT payment.id")) return [[]];
    throw new Error("Unexpected test query: " + sql);
  }};
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../services/equipmentFinancePhaseSixService"), "utf8"), {
    module, exports: module.exports, process: { env: { NODE_ENV: "test" } }, console,
    Buffer, Date, setTimeout, setInterval, clearTimeout, clearInterval,
    require(name) {
      if (name === "../config/db") return { pool };
      if (name === "./smsAlertService") return { async sendSmsAlertToPhone() {
        sends++; await Promise.resolve();
        if (throws) throw new Error("connection lost");
        return result;
      }};
      if (name === "./equipmentFinanceProfessionalService") return {
        async getProfessionalSettings() { return { customer_payment_receipt_sms_enabled: true,
          customer_receipt_template: "Receipt {receipt_number}" }; }
      };
      if (name.startsWith("./")) return {};
      return require(name);
    }
  });
  return { api: module.exports, sends: () => sends, state: () => state, queries };
}
test("concurrent receipt attempts submit once and submitted receipts cannot be retried", async () => {
  const h = harness();
  await Promise.all(Array.from({ length: 8 }, () => h.api.sendCustomerPaymentReceipt({ paymentId: 7, retry: true })));
  assert.equal(h.sends(), 1);
  assert.equal(h.state(), "submitted");
  await h.api.sendCustomerPaymentReceipt({ paymentId: 7, retry: true });
  assert.equal(h.sends(), 1);
});
test("explicit retry claims a failed receipt once", async () => {
  const h = harness({ status: "failed" });
  await Promise.all([1, 2].map(() => h.api.sendCustomerPaymentReceipt({ paymentId: 7, retry: true })));
  assert.equal(h.sends(), 1);
});
test("uncertain delivery is recorded and never automatically resent", async () => {
  for (const options of [{ result: { ok: true, status: "delivery_unknown" } }, { throws: true }]) {
    const h = harness(options);
    try { await h.api.sendCustomerPaymentReceipt({ paymentId: 7 }); } catch (error) { assert.match(error.message, /connection lost/); }
    assert.equal(h.state(), "delivery_unknown");
    await h.api.sendCustomerPaymentReceipt({ paymentId: 7, retry: true });
    assert.equal(h.sends(), 1);
  }
});
test("automatic receipt scan requires the migration cutover and excludes historical payments", async () => {
  const h = harness();
  await h.api.syncCustomerPaymentReceipts();
  const query = h.queries.find(sql => sql.includes("SELECT payment.id"));
  assert.match(query, /INNER JOIN equipment_finance_phase6_runtime_state state/);
  assert.match(query, /state.state_key = 'customer_receipt_cutover_at'/);
  assert.match(query, /payment.payment_date >= CAST\(state.state_value AS DATETIME\)/);
  assert.equal(h.sends(), 0);
});
