const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "routes", "exportRoutes.js"),
  "utf8"
);

test("all main Excel, PDF and Word exports use the vivid reporting period banner", () => {
  assert.match(source, /function getDateRangeMeta\(/);
  assert.match(source, /REPORTING PERIOD: FROM/);
  assert.match(source, /meta\.periodBanner/);
  assert.match(source, /fgColor: \{ argb: "FFE6B91E" \}/);
  assert.match(source, /roundedRect\(left, periodY, width, 30, 4\)/);
  assert.match(source, /class="period-banner"/);
  assert.doesNotMatch(source, /Period: \$\{meta\.periodLabel\} \| Generated:/);
});

test("all-record exports derive earliest and latest dated records", () => {
  assert.match(source, /function deriveWorkbookDateBounds\(/);
  assert.match(source, /parseReportDate\(row\[index\]\)/);
  assert.match(source, /parseReportDate\(from\) \|\| bounds\.earliest/);
  assert.match(source, /parseReportDate\(to\) \|\| bounds\.latest/);
});

test("report filenames carry the authoritative period", () => {
  assert.match(source, /periodFilename/);
  assert.match(source, /filenamePart: `\$\{fromKey\}-to-\$\{toKey\}`/);
  assert.match(source, /safeBase\}\$\{periodFilename\}\.xlsx/);
  assert.match(source, /safeBase\}\$\{periodFilename\}\.pdf/);
  assert.match(source, /safeBase\}\$\{periodFilename\}\.doc/);
});
