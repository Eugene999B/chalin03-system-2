const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const readModelPath = path.resolve(
  __dirname,
  "../services/equipmentInstallmentReadModelService.js"
);

const source = fs.readFileSync(readModelPath, "utf8");

test("installment read model never selects a past schedule row as next due", () => {
  assert.match(
    source,
    /AS next_schedule_due_date,[\s\S]*?AND eis\.due_date >= CURDATE\(\)/
  );
});

test("overdue history remains separately identified from next due", () => {
  assert.match(source, /AS oldest_overdue_date,[\s\S]*?eis\.due_date < CURDATE\(\)/);
  assert.match(source, /next_due_date: nextDueDate/);
});
