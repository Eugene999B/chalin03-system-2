const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertVerificationPassed,
} = require("../scripts/runLocalDatabaseAcceptance");

test("zero-count duplicate summary is accepted", () => {
  assert.doesNotThrow(() =>
    assertVerificationPassed("schema_verify.sql", [
      [{ check_name: "duplicate_usernames", problem_count: 0 }],
    ])
  );
});

test("zero-count multiple-default summary is accepted", () => {
  assert.doesNotThrow(() =>
    assertVerificationPassed("schema_verify.sql", [
      [
        {
          check_name: "multiple_default_branch_assignments",
          problem_count: 0,
        },
      ],
    ])
  );
});

test("positive problem count fails verification", () => {
  assert.throws(
    () =>
      assertVerificationPassed("schema_verify.sql", [
        [{ check_name: "duplicate_usernames", problem_count: 1 }],
      ]),
    /verification failed/
  );
});

test("detail issue rows fail verification", () => {
  assert.throws(
    () =>
      assertVerificationPassed("stage6a_verify.sql", [
        [
          {
            check_name: "user_business_access.invalid_workspace_roles",
            user_id: 22,
            access_role: "cashier",
          },
        ],
      ]),
    /verification failed/
  );
});

test("PASS status and required presence values are accepted", () => {
  assert.doesNotThrow(() =>
    assertVerificationPassed("stage6b_verify.sql", [
      [
        {
          check_name: "stage6b_activity_log_columns",
          present_columns: 12,
          expected_columns: 12,
          result: "PASS",
        },
      ],
      [
        {
          check_name: "required_columns",
          amount_tendered_present: 1,
          change_due_present: 1,
          foreign_key_present: 1,
        },
      ],
    ])
  );
});

test("missing-item detail rows fail verification", () => {
  assert.throws(
    () =>
      assertVerificationPassed("schema_verify.sql", [
        [{ missing_hire_trigger: "trg_hire_payment_location_before_insert" }],
      ]),
    /verification failed/
  );
});
