import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const [app, packageJson, help] = await Promise.all([
  read("src/App.jsx"),
  read("package.json"),
  read("src/pages/WorkspaceHelpPage.jsx"),
]);

assert.match(app, /import \{ lazy, Suspense \} from "react"/);
assert.match(app, /<Suspense fallback=\{<RouteLoadingFallback \/>\}>/);
assert.match(app, /role="status"/);

for (const page of [
  "MiningOperationsPage",
  "MiningControlCentrePage",
  "EquipmentHireOperationsPage",
  "HireCommercialControlPage",
  "FleetAssetsPage",
  "WorkspaceAdministrationPage",
]) {
  assert.match(app, new RegExp(`const ${page} = lazy`));
  assert.doesNotMatch(app, new RegExp(`import ${page} from`));
}

assert.match(app, /WorkspaceShell allowedWorkspaces=\{MINING_WORKSPACE\}/);
assert.match(app, /WorkspaceShell allowedWorkspaces=\{EQUIPMENT_HIRE_WORKSPACE\}/);
assert.match(app, /MINING_SECTION_PERMISSIONS\.control/);
assert.match(app, /HIRE_SECTION_PERMISSIONS\.commercial/);
assert.match(packageJson, /workspaceFinalCompletionTests\.mjs/);
assert.match(help, /automatic rule refresh/i);
assert.match(help, /controlled cancellation, adjustment, void or amendment/i);

console.log("Mining and Equipment Hire final frontend checks passed.");
