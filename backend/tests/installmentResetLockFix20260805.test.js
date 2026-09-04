const assert = require("node:assert/strict");
const test = require("node:test");

const {
  RESET_LOCK,
} = require("../scripts/runUserAuthorizedInstallmentRestartReset20260805");
const {
  SAFE_RESET_LOCK,
  assertSafeLockNames,
  withSafeResetLock,
} = require("../scripts/runUserAuthorizedInstallmentRestartResetLockFix20260805");

test("the production reset advisory lock satisfies MySQL's 64-character limit", () => {
  assert.ok(RESET_LOCK.length > 64, "the rejected legacy lock is reproduced");
  assert.ok(SAFE_RESET_LOCK.length <= 64, "replacement lock must fit MySQL");
  assert.doesNotThrow(() => assertSafeLockNames());
});

test("only reset lock and release calls receive the safe lock name", async () => {
  const calls = [];
  const connection = {
    query(sql, values) {
      calls.push({ sql, values });
      return Promise.resolve([[{ acquired: 1 }], []]);
    },
    beginTransaction() {},
  };
  const wrapped = withSafeResetLock(connection);

  await wrapped.query("SELECT GET_LOCK(?, 60) AS acquired", [RESET_LOCK]);
  await wrapped.query("SELECT RELEASE_LOCK(?)", [RESET_LOCK]);
  await wrapped.query("SELECT ? AS ordinary_value", [RESET_LOCK]);

  assert.equal(calls[0].values[0], SAFE_RESET_LOCK);
  assert.equal(calls[1].values[0], SAFE_RESET_LOCK);
  assert.equal(calls[2].values[0], RESET_LOCK);
});
