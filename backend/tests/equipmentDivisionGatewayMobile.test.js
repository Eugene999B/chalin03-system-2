const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("equipment business opening uses a compact protected mobile flow", () => {
  const portal = read(
    "frontend",
    "src",
    "pages",
    "EquipmentHirePortalPage.jsx"
  );
  const gateway = read(
    "frontend",
    "src",
    "pages",
    "EquipmentDivisionGatewayPage.jsx"
  );
  const css = read(
    "frontend",
    "src",
    "styles",
    "equipmentBusinessExperience.css"
  );

  assert.match(portal, /Navigate to="\/login\?workspace=equipment_hire" replace/);
  assert.doesNotMatch(portal, /EquipmentBusinessLandingPage/);
  assert.match(gateway, /Back to Login/);
  assert.match(gateway, /Back to Equipment Login/);
  assert.doesNotMatch(gateway, /\/company\//);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /\.equipment-business-public__division-grid,[\s\S]*\.equipment-command__grid[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.equipment-command__identity[\s\S]*display: none/);
  assert.match(css, /\.equipment-command__footer-actions[\s\S]*flex-direction: column/);
  assert.doesNotMatch(css, /min-width:\s*[7-9]\d\dpx/);
});
