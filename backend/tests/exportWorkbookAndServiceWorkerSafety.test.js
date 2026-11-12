const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("../services/excelJsCompat");

const {
  MAX_WORKSHEET_NAME_LENGTH,
  sanitizeWorksheetName,
} = require("../services/exportWorkbookSafetyBootstrap");

const backendRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(backendRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("all Spare Parts export worksheet names are safe at runtime", async () => {
  const exportSource = read("backend/routes/exportRoutes.js");
  const worksheetNames = Array.from(
    exportSource.matchAll(/addWorksheet\(\s*["'`]([^"'`]+)["'`]/g),
    (match) => match[1]
  );

  assert.ok(worksheetNames.length > 0, "export routes must define worksheets");
  assert.ok(
    worksheetNames.includes("Low Stock / Restock List"),
    "the production low-stock worksheet regression must remain covered"
  );
  assert.equal(
    sanitizeWorksheetName("Low Stock / Restock List"),
    "Low Stock - Restock List"
  );

  for (const originalName of worksheetNames) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(originalName);

    assert.ok(worksheet.name.length > 0, `${originalName} must have a name`);
    assert.ok(
      worksheet.name.length <= MAX_WORKSHEET_NAME_LENGTH,
      `${originalName} must fit Excel's 31-character limit`
    );
    assert.doesNotMatch(
      worksheet.name,
      /[*?:\\/\[\]]/,
      `${originalName} must not retain an invalid Excel worksheet character`
    );
  }

  const lowStockWorkbook = new ExcelJS.Workbook();
  const lowStockSheet = lowStockWorkbook.addWorksheet("Low Stock / Restock List");
  const summarySheet = lowStockWorkbook.addWorksheet("Restock Summary");

  lowStockSheet.columns = [
    { header: "Product Name", key: "name" },
    { header: "Current Quantity", key: "quantity" },
    { header: "Low Stock Level", key: "low_stock_threshold" },
    { header: "Estimated Restock Cost", key: "estimated_restock_cost" },
  ];
  lowStockSheet.addRow({
    name: "Regression Test Product",
    quantity: 1,
    low_stock_threshold: 5,
    estimated_restock_cost: 120,
  });
  summarySheet.addRow(["Metric", "Value"]);
  summarySheet.addRow(["Total low stock items", 1]);

  const buffer = await lowStockWorkbook.xlsx.writeBuffer();

  assert.ok(buffer.length > 0, "low-stock XLSX generation must complete");
  assert.equal(lowStockSheet.name, "Low Stock - Restock List");
});

test("duplicate sanitized worksheet names remain unique", () => {
  const workbook = new ExcelJS.Workbook();
  const first = workbook.addWorksheet("Stock / Summary");
  const second = workbook.addWorksheet("Stock : Summary");

  assert.equal(first.name, "Stock - Summary");
  assert.equal(second.name, "Stock - Summary (2)");
});

test("service-worker network failures always resolve to a Response", () => {
  const serviceWorkerSource = read("frontend/public/sw.js");

  assert.match(serviceWorkerSource, /function offlineShell\(\)/);
  assert.match(serviceWorkerSource, /function failedBuildAsset\(request, status = 410\)/);
  assert.match(serviceWorkerSource, /return new Response\(/);
  assert.match(serviceWorkerSource, /async function networkBuildAsset\(request\)/);
  assert.match(serviceWorkerSource, /return failedBuildAsset\(request, 503\)/);
  assert.match(serviceWorkerSource, /async function networkNavigation\(request\)/);
  assert.match(
    serviceWorkerSource,
    /return \(await cachedShell\(\)\) \|\| offlineShell\(\)/
  );
  assert.match(serviceWorkerSource, /async function networkCoreAsset\(request\)/);
  assert.match(serviceWorkerSource, /status: 503/);
  assert.doesNotMatch(
    serviceWorkerSource,
    /\.catch\(\(\) => caches\.match\(/,
    "a cache miss must not return undefined to FetchEvent.respondWith"
  );
});
