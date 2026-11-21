import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(
  path.join(__dirname, "..", "src", "pages", "ExportsPage.jsx"),
  "utf8"
);

testSelectedPeriodRequestContract();
testSnapshotReportExplanation();
testPeriodAwareFilenameFallback();

function testSelectedPeriodRequestContract() {
  assert.match(source, /\.\.\.\(from \? \{ from \} : \{\}\)/);
  assert.match(source, /\.\.\.\(to \? \{ to \} : \{\}\)/);
  assert.doesNotMatch(
    source,
    /\.\.\.\(report\.dateFilter \? \{ from, to \} : \{\}\)/
  );
  assert.match(source, /function validateDates\(\)/);
}

function testSnapshotReportExplanation() {
  assert.match(
    source,
    /Every download prints the exact selected From and To dates/
  );
  assert.match(source, /Current snapshot • selected period shown/);
  assert.match(source, /Filters rows by selected dates/);
}

function testPeriodAwareFilenameFallback() {
  assert.match(source, /from \|\| "earliest"/);
  assert.match(source, /to \|\| "latest"/);
  assert.match(source, /extractFilename\(response\.headers, fallbackFilename\)/);
}

console.log("Auditor selected-period export contracts passed.");
