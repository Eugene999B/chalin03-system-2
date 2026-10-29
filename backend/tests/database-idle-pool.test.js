const { test } = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");

test("production pool releases idle sessions without closing an active lease", {
  skip: process.env.RUN_POOL_COST_TEST !== "1",
  timeout: 90000,
}, async (t) => {
  const { pool } = require("../config/db");
  t.after(() => pool.end());
  const leases = await Promise.all(Array.from({ length: 5 }, () => pool.getConnection()));
  const ids = await Promise.all(leases.map(async (lease) => {
    const [rows] = await lease.query("SELECT CONNECTION_ID() AS id");
    return rows[0].id;
  }));
  const active = leases[0];
  leases.slice(1).forEach(lease => lease.release());
  const remaining = async () => {
    const [rows] = await active.query(
      "SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (" + ids.map(() => "?").join(",") + ")",
      ids
    );
    return rows.map(row => row.ID);
  };
  await delay(2500);
  assert.ok((await remaining()).length <= 2, "Excess idle sessions should close");
  await delay(62000);
  assert.deepEqual(await remaining(), [ids[0]], "An active lease survives; expired idle sessions close");
  const fresh = await pool.getConnection();
  const [rows] = await fresh.query("SELECT 1 AS healthy");
  assert.equal(rows[0].healthy, 1, "The pool reconnects after idle eviction");
  fresh.release();
  active.release();
});
