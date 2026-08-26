import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const routePath = path.resolve(process.cwd(), "routes/notificationRoutes.js");
const source = fs.readFileSync(routePath, "utf8");

test("notification rules route bootstraps Spare Parts Business Intelligence audiences", () => {
  assert.match(source, /require\("\.\.\/services\/executiveBusinessReportService"\)/);
  assert.match(source, /await ensureReportRules\(\)/);
  assert.match(source, /workspaceCode\(req\) === "spare_parts"/);
});
