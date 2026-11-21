const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MIGRATION_LOCK_NAME,
} = require("../scripts/runEquipmentFinanceProfessionalRebuildMigration");

test("professional Finance MySQL advisory lock name stays within 64 characters", () => {
  assert.ok(MIGRATION_LOCK_NAME.length > 0);
  assert.ok(
    MIGRATION_LOCK_NAME.length <= 64,
    `MySQL GET_LOCK name is ${MIGRATION_LOCK_NAME.length} characters; maximum is 64.`
  );
  assert.match(MIGRATION_LOCK_NAME, /^chalin03:/);
});
