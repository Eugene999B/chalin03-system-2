const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("equipment division gateway uses a compact no-scroll mobile chooser", () => {
  const gateway = read(
    "frontend",
    "src",
    "pages",
    "EquipmentDivisionGatewayPage.jsx"
  );
  const mobileCss = read(
    "frontend",
    "src",
    "styles",
    "equipmentDivisionGateway.mobile.css"
  );

  assert.match(gateway, /equipmentDivisionGateway\.mobile\.css/);
  assert.match(mobileCss, /@media \(max-width: 620px\)/);
  assert.match(mobileCss, /height: 100dvh/);
  assert.match(mobileCss, /grid-template-rows: auto auto minmax\(0, 1fr\)/);
  assert.match(mobileCss, /grid-template-rows: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mobileCss, /\.equipment-gateway__division-card ul[\s\S]*display: none/);
  assert.match(mobileCss, /\.equipment-gateway__shared-strip,[\s\S]*\.equipment-gateway__footer[\s\S]*display: none/);
  assert.match(mobileCss, /@media \(max-width: 620px\) and \(max-height: 680px\)/);
});
