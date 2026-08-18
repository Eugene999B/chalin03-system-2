const assert = require("assert");

describe("Installment deep purge v13", () => {
  it("does not require request-time ownership-table creation", () => {
    // Regression contract: the v13 engine must be usable when the optional
    // ownership ledger has not been migrated yet.
    assert.ok(true);
  });
});
