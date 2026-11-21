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

test("generated-document downloads load blank-page protection before the logo-led renderer", () => {
  const guardIndex = routeSource.indexOf(
    'require("../services/equipmentFinancePdfBlankPageGuardService")'
  );
  const rendererIndex = routeSource.indexOf(
    'require("../services/equipmentFinanceDocumentRendererV2Service")'
  );
  assert.ok(guardIndex >= 0);
  assert.ok(rendererIndex > guardIndex);
  assert.match(routeSource, /professional-logo-led-v3/);
  assert.match(routeSource, /manual_page_flow_no_blank_pages: true/);
  assert.match(routeSource, /official_logo_cached_in_backend/);
});
