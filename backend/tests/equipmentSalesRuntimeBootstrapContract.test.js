const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "../services/equipmentSalesSchemaService.js"),
  "utf8"
);

test("Equipment Sales recovery starts after Railway boot without blocking other workspaces", () => {
  assert.match(source, /RUNTIME_BOOT_DELAY_MS = 15 \* 1000/);
  assert.match(source, /RUNTIME_RETRY_DELAY_MS = 5 \* 60 \* 1000/);
  assert.match(source, /scheduleEquipmentSalesRuntimeBootstrap/);
  assert.match(source, /scheduleEquipmentSalesRuntimeBootstrap\(\);/);
  assert.match(source, /await ensureEquipmentSalesSchema\(\)/);
  assert.match(source, /runtimeBootstrapReady = Boolean\(status\?\.core_ready\)/);
  assert.match(source, /existing workspaces remain available/);
  assert.match(source, /DISABLE_EQUIPMENT_SALES_RUNTIME_BOOTSTRAP/);
  assert.match(source, /NODE_ENV/);
  assert.match(source, /runtimeBootstrapTimer\.unref/);
  assert.match(source, /startEquipmentSalesReminderScheduler/);
  assert.match(source, /if \(!status\?\.full_ready\)/);
  assert.match(source, /scheduleEquipmentSalesRuntimeBootstrap\(RUNTIME_RETRY_DELAY_MS\)/);
});
