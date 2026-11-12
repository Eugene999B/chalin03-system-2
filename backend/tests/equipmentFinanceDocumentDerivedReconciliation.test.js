const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const professional = fs.readFileSync(
  path.join(__dirname, "../services/equipmentFinanceProfessionalService.js"),
  "utf8"
);
const completion = fs.readFileSync(
  path.join(__dirname, "../services/equipmentFinanceDocumentCompletionService.js"),
  "utf8"
);

test("Finance document issue repairs only derived cached status and overdue metadata", () => {
  assert.match(professional, /DOCUMENT_SAFE_DERIVED_FIELDS = new Set\(\[\s*"overdue_amount",\s*"next_due_date",\s*"agreement_status"/);
  assert.match(professional, /severity === "critical" \|\| !DOCUMENT_SAFE_DERIVED_FIELDS\.has\(field\)/);
  assert.match(professional, /await client\.beginTransaction\(\)/);
  assert.match(professional, /await refreshFinanceAgreementFromEvidence\(client, agreementId\)/);
  assert.match(professional, /await client\.commit\(\)/);
  assert.match(professional, /await client\.rollback\(\)/);
  assert.match(professional, /if \(!verified\.reconciliation\?\.consistent\)/);
});

test("Both legacy and completion document paths use verified reconciled snapshots", () => {
  assert.match(professional, /const snapshot = await loadReconciledDocumentSnapshot\(agreementId, connection\)/);
  assert.match(completion, /const baseSnapshot = await loadReconciledDocumentSnapshot\(agreementId\)/);
  assert.match(completion, /assertIssueAllowed\(type, snapshot\)/);
  assert.match(professional, /if \(!snapshot\.reconciliation\.consistent\)/);
});
