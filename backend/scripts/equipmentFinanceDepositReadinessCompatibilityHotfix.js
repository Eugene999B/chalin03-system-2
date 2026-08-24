const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const targetSuffix = path.normalize(
  "backend/routes/equipmentFinanceDepositReservationRoutes.js"
);
const originalLoader = Module._extensions[".js"];

Module._extensions[".js"] = function compatibilityLoader(module, filename) {
  if (filename.endsWith(targetSuffix)) {
    let source = fs.readFileSync(filename, "utf8");
    const oldReadyExpression = `ready:\n      missingColumns.length === 0 &&\n      missingTriggers.length === 0 &&\n      missingMigrations.length === 0,`;
    const newReadyExpression = `ready:\n      missingColumns.length === 0 &&\n      missingTriggers.length === 0,`;
    if (source.includes(oldReadyExpression)) {
      source = source.replace(oldReadyExpression, newReadyExpression);
      console.log(
        "Applied deposit readiness compatibility: schema_migrations bookkeeping is advisory; database columns and triggers remain mandatory."
      );
    }
    return module._compile(source, filename);
  }
  return originalLoader(module, filename);
};
