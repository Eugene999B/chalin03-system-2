const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const routesDirectory = path.join(__dirname, "..", "routes");

function readRoute(filename) {
  return fs.readFileSync(path.join(routesDirectory, filename), "utf8");
}

function routeSection(source, startMarker, endMarker = null) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing route marker: ${startMarker}`);

  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  if (endMarker) {
    assert.notEqual(end, -1, `Missing route boundary: ${endMarker}`);
  }

  return source.slice(start, end);
}

test("operations write routes consume only centralized sanitized request values", () => {
  const purchase = routeSection(
    readRoute("purchaseRoutes.js"),
    "// POST /api/purchases\nrouter.post("
  );
  const expense = routeSection(
    readRoute("expenseRoutes.js"),
    "// POST /api/expenses\nrouter.post("
  );
  const stockAdjustment = routeSection(
    readRoute("productRoutes.js"),
    "// PATCH /api/products/:id/stock-adjustment\nrouter.patch(",
    "// DELETE /api/products/:id"
  );

  for (const [name, source] of [
    ["purchase creation", purchase],
    ["expense creation", expense],
    ["stock adjustment", stockAdjustment],
  ]) {
    assert.match(source, /validateRequest\(/, `${name} must use centralized validation`);
    assert.match(source, /req\.validated\./, `${name} must use sanitized request values`);
    assert.doesNotMatch(source, /req\.body\./, `${name} must not read raw request body fields`);
  }

  assert.doesNotMatch(
    stockAdjustment,
    /req\.params\./,
    "stock adjustment must not read raw route parameters"
  );
});

test("the complete stock-transfer lifecycle uses sanitized IDs, items and notes", () => {
  const source = readRoute("stockTransferRoutes.js");
  const create = routeSection(
    source,
    'router.post(\n  "/",',
    '\nrouter.post(\n  "/:id/approve",'
  );

  assert.match(create, /validateRequest\(validateStockTransferCreateRequest\)/);
  assert.match(create, /req\.validated\.body/);
  assert.doesNotMatch(create, /req\.body\./);

  const actions = ["approve", "reject", "dispatch", "receive", "cancel"];
  for (const action of actions) {
    const startMarker = `router.post(\n  "/:id/${action}",`;
    const actionSection = routeSection(source, startMarker, action === "cancel" ? null : "\nrouter.");

    assert.match(
      actionSection,
      new RegExp(`validateRequest\\(validateStockTransferActionRequest\\("${action}"\\)\\)`),
      `${action} must use its centralized action validator`
    );
    assert.match(actionSection, /req\.validated\.params/);
    assert.match(actionSection, /req\.validated\.body/);
    assert.doesNotMatch(actionSection, /req\.params\./);
    assert.doesNotMatch(actionSection, /req\.body\./);
  }
});
