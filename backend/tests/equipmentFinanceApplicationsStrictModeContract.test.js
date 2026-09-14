const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(
  path.join(root, "frontend", "src", "pages", "EquipmentFinanceApplicationsPage.jsx"),
  "utf8"
);

test("newer Finance register and detail reads still cancel stale requests", () => {
  assert.match(source, /const loadList = useCallback\(async \(\) => \{\s*listAbortRef\.current\?\.abort\(\)/);
  assert.match(source, /detailAbortRef\.current\?\.abort\(\);\s*const controller = new AbortController\(\)/);
});

test("React StrictMode cleanup never aborts the initial application reads", () => {
  const listEffectStart = source.indexOf("const timer = window.setTimeout(loadList");
  const detailStart = source.indexOf("const openDetail = useCallback");
  const listEffect = source.slice(listEffectStart, detailStart);
  assert.ok(listEffectStart >= 0 && detailStart > listEffectStart);
  assert.doesNotMatch(listEffect, /listAbortRef\.current\?\.abort\(\)/);
  assert.match(listEffect, /StrictMode replays effect cleanup/);

  const requestedEffectStart = source.indexOf(
    "if (requestedApplicationId) {\n      void openDetail(requestedApplicationId);"
  );
  const closeDetailStart = source.indexOf("function closeDetail()", requestedEffectStart);
  const requestedEffect = source.slice(requestedEffectStart, closeDetailStart);
  assert.ok(requestedEffectStart >= 0 && closeDetailStart > requestedEffectStart);
  assert.doesNotMatch(requestedEffect, /detailAbortRef\.current\?\.abort\(\)/);
  assert.match(requestedEffect, /Do not abort during effect cleanup/);
});
