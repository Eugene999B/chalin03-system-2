const assert = require("node:assert/strict");
const test = require("node:test");

const { validateRequest } = require("../middleware/requestValidationMiddleware");
const {
  validateBackupDryRunRequest,
  validateBackupRestoreRequest,
  validateDebtPaymentRequest,
} = require("../validation/requestValidators");

function validBackup(overrides = {}) {
  return {
    backup_type: "full_system_backup",
    created_at: "2026-07-21T18:00:00.000Z",
    included_tables: ["branches"],
    table_counts: { branches: 1 },
    total_record_count: 1,
    tables: {
      branches: [{ id: 1, name: "Main" }],
    },
    ...overrides,
  };
}

test("debt payment validator sanitizes a valid request", () => {
  const result = validateDebtPaymentRequest({
    params: { id: "17" },
    body: {
      amount: "125.50",
      payment_method: " MoMo ",
      notes: " Customer paid at counter ",
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    params: { id: 17 },
    body: {
      amount: 125.5,
      payment_method: "momo",
      notes: "Customer paid at counter",
    },
  });
});

test("debt payment validator preserves cash as the default", () => {
  const result = validateDebtPaymentRequest({
    params: { id: 2 },
    body: { amount: 10 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.body.payment_method, "cash");
  assert.equal(result.value.body.notes, null);
});

test("debt payment validator rejects invalid methods and unknown fields", () => {
  const result = validateDebtPaymentRequest({
    params: { id: "2" },
    body: {
      amount: "10.00",
      payment_method: "crypto",
      branch_id: 99,
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "INVALID_PAYMENT_METHOD"));
  assert.ok(result.errors.some((error) => error.code === "UNKNOWN_FIELD"));
});

test("debt payment validator rejects exponent notation and invalid IDs", () => {
  const result = validateDebtPaymentRequest({
    params: { id: "1 OR 1=1" },
    body: { amount: "1e3" },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "INVALID_DEBT_ID"));
  assert.ok(result.errors.some((error) => error.code === "INVALID_PAYMENT_AMOUNT"));
});

test("backup dry-run accepts direct and wrapped backups", () => {
  const direct = validateBackupDryRunRequest({ body: validBackup() });
  const wrapped = validateBackupDryRunRequest({ body: { backup: validBackup() } });

  assert.equal(direct.ok, true);
  assert.equal(wrapped.ok, true);
  assert.equal(wrapped.value.backup.backup_type, "full_system_backup");
});

test("backup validator rejects unsafe table identifiers", () => {
  const result = validateBackupDryRunRequest({
    body: validBackup({
      tables: {
        "branches; DROP TABLE users": [{ id: 1 }],
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "UNSAFE_IDENTIFIER"));
});

test("backup validator rejects reserved row keys", () => {
  const row = JSON.parse('{"id":1,"__proto__":"unsafe"}');
  const result = validateBackupDryRunRequest({
    body: validBackup({ tables: { branches: [row] } }),
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "UNSAFE_IDENTIFIER"));
});

test("backup validator rejects non-array rows and invalid checksums", () => {
  const result = validateBackupDryRunRequest({
    body: validBackup({
      checksum_sha256: "not-a-checksum",
      tables: { branches: { id: 1 } },
    }),
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "INVALID_TABLE_ROWS"));
  assert.ok(result.errors.some((error) => error.code === "INVALID_CHECKSUM"));
});

test("restore validator requires the exact confirmation phrase", () => {
  const missing = validateBackupRestoreRequest({
    body: { backup: validBackup() },
  });
  const accepted = validateBackupRestoreRequest({
    body: {
      confirmation: "RESTORE_FULL_SYSTEM_BACKUP",
      backup: validBackup(),
    },
  });

  assert.equal(missing.ok, false);
  assert.ok(
    missing.errors.some((error) => error.code === "RESTORE_CONFIRMATION_REQUIRED")
  );
  assert.equal(accepted.ok, true);
});

test("restore validator rejects conflicting confirmation fields", () => {
  const result = validateBackupRestoreRequest({
    body: {
      confirmation: "RESTORE_FULL_SYSTEM_BACKUP",
      restore_confirmation: "WRONG",
      backup: validBackup(),
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "CONFIRMATION_MISMATCH"));
});

test("request middleware returns 400 and never calls next for invalid data", () => {
  const middleware = validateRequest(validateDebtPaymentRequest);
  const req = {
    params: { id: "bad" },
    query: {},
    body: { amount: -1 },
  };
  let nextCalled = false;
  let statusCode = null;
  let responseBody = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return body;
    },
  };

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 400);
  assert.equal(responseBody.code, "REQUEST_VALIDATION_FAILED");
  assert.ok(responseBody.validation_errors.length >= 2);
});

test("request middleware attaches sanitized values before next", () => {
  const middleware = validateRequest(validateDebtPaymentRequest);
  const req = {
    params: { id: "3" },
    query: {},
    body: { amount: "20.00", payment_method: "BANK" },
  };
  let nextCalled = false;
  const res = {
    status() {
      throw new Error("status should not be called");
    },
  };

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.validated.params.id, 3);
  assert.equal(req.validated.body.amount, 20);
  assert.equal(req.validated.body.payment_method, "bank");
});
