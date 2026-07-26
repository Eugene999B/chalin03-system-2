const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const server = read("backend/server.js");
const boundary = read(
  "backend/middleware/equipmentCatalogueIntegrityMiddleware.js"
);
const schemaService = read("backend/services/equipmentSalesSchemaService.js");
const salesRoutes = read("backend/routes/equipmentSalesRoutes.js");
const finalizationRoutes = read(
  "backend/routes/equipmentSalesFinalizationRoutes.js"
);
const workspacePage = read(
  "frontend/src/pages/EquipmentSalesWorkspacePage.jsx"
);
const reportsPage = read("frontend/src/pages/EquipmentSalesReportsPage.jsx");

test("Equipment Sales remains reachable through the protected catalogue router chain", () => {
  assert.match(
    server,
    /app\.use\(\s*["']\/api\/equipment-catalogue["'][\s\S]*requireAuth[\s\S]*hireBoundary[\s\S]*enforceEquipmentCatalogueWriteIntegrity[\s\S]*equipmentCatalogueRoutes/
  );
  assert.doesNotMatch(
    server,
    /require\(["']\.\/routes\/equipmentSalesRoutes["']\)/
  );
  assert.match(
    boundary,
    /const equipmentSalesRoutes = require\(["']\.\.\/routes\/equipmentSalesRoutes["']\)/
  );
  assert.match(boundary, /function isEquipmentSalesRequest/);
  assert.match(boundary, /\^\\\/sales/);
  assert.match(boundary, /function dispatchEquipmentSalesRouter/);
  assert.match(boundary, /req\.url = req\.url\.replace/);
  assert.match(boundary, /return equipmentSalesRoutes\(req, res/);
});

test("Equipment Sales finalization routes remain attached exactly once", () => {
  assert.match(
    schemaService,
    /const equipmentSalesRoutes = require\(["']\.\.\/routes\/equipmentSalesRoutes["']\)/
  );
  assert.match(
    schemaService,
    /const equipmentSalesFinalizationRoutes = require\(["']\.\.\/routes\/equipmentSalesFinalizationRoutes["']\)/
  );
  assert.match(
    schemaService,
    /if \(!equipmentSalesRoutes\.__chalin03FinalizationMounted\)/
  );
  assert.match(
    schemaService,
    /equipmentSalesRoutes\.use\(equipmentSalesFinalizationRoutes\)/
  );
  assert.match(salesRoutes, /router\.get\(["']\/summary["']/);
  assert.match(salesRoutes, /router\.post\(["']\/agreements["']/);
  assert.match(
    finalizationRoutes,
    /["']\/agreements\/:id\/documents\/:type\.pdf["']/
  );
  assert.match(finalizationRoutes, /["']\/reports\/management["']/);
});

test("frontend Equipment Sales pages use the protected catalogue sales path", () => {
  assert.match(
    workspacePage,
    /const API = ["']\/equipment-catalogue\/sales["']/
  );
  assert.match(
    reportsPage,
    /const API = ["']\/equipment-catalogue\/sales["']/
  );
});
