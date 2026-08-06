const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const routeSource = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "routes",
    "equipmentFinanceDocumentCompletionRoutes.js"
  ),
  "utf8"
);

test("generated-document downloads load blank-page protection before the premium renderer", () => {
  const guardIndex = routeSource.indexOf(
    'require("../services/equipmentFinancePdfBlankPageGuardService")'
  );
  const rendererIndex = routeSource.indexOf(
    'require("../services/equipmentFinancePremiumDocumentRendererService")'
  );
  assert.ok(guardIndex >= 0);
  assert.ok(rendererIndex > guardIndex);
});
