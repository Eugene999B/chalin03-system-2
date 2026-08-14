"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SUPPORTED_AI_DOCUMENT_FORMATS,
  highestClassification,
  normalizeDocumentFormat,
  normalizedPayload,
  renderAiDocument,
  safeSpreadsheetText,
  sanitizeFilename,
} = require("../services/aiDocumentStudioService");
const {
  getEffectiveAiPermissions,
} = require("../security/aiPermissionCatalog");

const sampleEvidence = Object.freeze([
  Object.freeze({
    citation: "E1",
    label: "Main Store sales snapshot",
    source_type: "system_snapshot",
    source_ref: "spare_parts.operations_snapshot",
    classification: "internal",
    workspace_code: "spare_parts",
    as_of_at: "2026-08-11T06:00:00.000Z",
    excerpt_text: "Main Store sales were GHS 48,320.00 across 37 transactions.",
  }),
  Object.freeze({
    citation: "E2",
    label: "Sensitive margin evidence",
    source_type: "system_snapshot",
    source_ref: "spare_parts.margin_snapshot",
    classification: "restricted",
    workspace_code: "spare_parts",
    as_of_at: "2026-08-11T06:00:00.000Z",
    excerpt_text: "Gross profit was GHS 8,910.00.",
  }),
]);

function payload(overrides = {}) {
  return {
    title: "Main Store Management Report",
    answer: "Main Store sold GHS 48,320.00 today. Gross profit was GHS 8,910.00 [E1] [E2].",
    evidence: sampleEvidence,
    actor_name: "System Administrator",
    actor_username: "admin",
    actor_role: "admin",
    workspace_code: "spare_parts",
    conversation_key: "conv_test",
    message_key: "msg_test",
    request_id: "req_test",
    generated_at: "2026-08-11T06:00:00.000Z",
    ...overrides,
  };
}

test("Document Studio supports PDF, Excel, CSV and Word aliases", () => {
  assert.deepEqual(SUPPORTED_AI_DOCUMENT_FORMATS, ["pdf", "xlsx", "csv", "docx"]);
  assert.equal(normalizeDocumentFormat("PDF"), "pdf");
  assert.equal(normalizeDocumentFormat("excel"), "xlsx");
  assert.equal(normalizeDocumentFormat("spreadsheet"), "xlsx");
  assert.equal(normalizeDocumentFormat("CSV"), "csv");
  assert.equal(normalizeDocumentFormat("Word"), "docx");
  assert.equal(normalizeDocumentFormat("docx"), "docx");
  assert.equal(normalizeDocumentFormat("html"), null);
});

test("document payload carries highest governed evidence classification and bounded provenance", () => {
  const normalized = normalizedPayload(payload());
  assert.equal(normalized.classification, "restricted");
  assert.equal(normalized.evidence.length, 2);
  assert.equal(normalized.actor_username, "admin");
  assert.equal(normalized.workspace_code, "spare_parts");
  assert.equal(highestClassification(sampleEvidence), "restricted");
  assert.equal(sanitizeFilename("Main Store / Profit: Today"), "Main-Store-Profit-Today");
});

test("spreadsheet text blocks formula execution", () => {
  assert.equal(safeSpreadsheetText("=HYPERLINK(\"bad\")"), "'=HYPERLINK(\"bad\")");
  assert.equal(safeSpreadsheetText("+SUM(A1:A2)"), "'+SUM(A1:A2)");
  assert.equal(safeSpreadsheetText("@cmd"), "'@cmd");
  assert.equal(safeSpreadsheetText("ordinary text"), "ordinary text");
});

test("PDF renderer produces a real PDF with provenance metadata", async () => {
  const artifact = await renderAiDocument(payload(), "pdf");
  assert.equal(artifact.format, "pdf");
  assert.equal(artifact.content_type, "application/pdf");
  assert.equal(artifact.classification, "restricted");
  assert.equal(artifact.evidence_count, 2);
  assert.ok(Buffer.isBuffer(artifact.buffer));
  assert.equal(artifact.buffer.subarray(0, 4).toString("ascii"), "%PDF");
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  assert.match(artifact.filename, /Main-Store-Management-Report\.pdf$/);
});

test("yesterday Main Store sales evidence renders as a real persisted-answer PDF", async () => {
  const yesterdayEvidence = Object.freeze([
    Object.freeze({
      citation: "E1",
      label: "Main Store sales snapshot — 2026-08-13",
      source_type: "system_snapshot",
      source_ref: "spare_parts:operations:branch:1",
      classification: "internal",
      workspace_code: "spare_parts",
      as_of_at: "2026-08-13T23:59:59.000Z",
      excerpt_text: JSON.stringify({
        branch_name: "Main Store",
        period: ["2026-08-13", "2026-08-13"],
        sales: { transaction_count: 14, total_sales: 7250 },
      }),
      metadata: {
        branch_id: 1,
        start_date: "2026-08-13",
        end_date: "2026-08-13",
        aggregate_only: true,
      },
    }),
  ]);
  const artifact = await renderAiDocument(
    payload({
      title: "Main Store Yesterday Sales — 2026-08-13",
      answer: "Main Store recorded 14 sales transactions totaling GHS 7,250.00 on August 13, 2026 [E1].",
      evidence: yesterdayEvidence,
      generated_at: "2026-08-14T12:46:00.000Z",
      conversation_key: "conv_incident_regression",
      message_key: "msg_yesterday_sales_pdf",
      request_id: "req_yesterday_sales_pdf",
    }),
    "pdf"
  );

  assert.equal(artifact.format, "pdf");
  assert.equal(artifact.content_type, "application/pdf");
  assert.equal(artifact.classification, "internal");
  assert.equal(artifact.evidence_count, 1);
  assert.ok(Buffer.isBuffer(artifact.buffer));
  assert.equal(artifact.buffer.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(artifact.byte_length > 500);
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  assert.match(artifact.filename, /Main-Store-Yesterday-Sales-2026-08-13\.pdf$/);
});

test("Excel renderer produces an Office ZIP workbook", async () => {
  const artifact = await renderAiDocument(payload(), "xlsx");
  assert.equal(artifact.format, "xlsx");
  assert.ok(Buffer.isBuffer(artifact.buffer));
  assert.equal(artifact.buffer.subarray(0, 2).toString("ascii"), "PK");
  assert.ok(artifact.byte_length > 1000);
});

test("CSV renderer includes BOM, answer, evidence and safe spreadsheet text", async () => {
  const artifact = await renderAiDocument(
    payload({ answer: "=SUM(A1:A2) should be shown as text, not executed." }),
    "csv"
  );
  const text = artifact.buffer.toString("utf8");
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.match(text, /Main Store Management Report/);
  assert.match(text, /'=SUM\(A1:A2\)/);
  assert.match(text, /Main Store sales snapshot/);
  assert.match(text, /restricted/i);
});

test("Word renderer produces a real DOCX OpenXML ZIP", async () => {
  const artifact = await renderAiDocument(payload(), "docx");
  assert.equal(artifact.format, "docx");
  assert.equal(artifact.buffer.subarray(0, 2).toString("ascii"), "PK");
  // The intentionally stored (uncompressed) OpenXML package makes its core
  // entry names directly inspectable without adding a ZIP dependency.
  const binaryText = artifact.buffer.toString("latin1");
  assert.match(binaryText, /\[Content_Types\]\.xml/);
  assert.match(binaryText, /word\/document\.xml/);
  assert.match(binaryText, /docProps\/core\.xml/);
});

test("workspace AI roles receive document generation permission and system admin inherits it", () => {
  const manager = getEffectiveAiPermissions({
    id: 25,
    username: "manager",
    role: "manager",
    workspace_role: "manager",
    workspace_code: "spare_parts",
    effective_permissions: [],
  });
  const auditor = getEffectiveAiPermissions({
    id: 26,
    username: "auditor",
    role: "auditor",
    workspace_role: "auditor",
    workspace_code: "spare_parts",
    effective_permissions: [],
  });
  const systemAdmin = getEffectiveAiPermissions({
    id: Number(process.env.SYSTEM_ADMIN_USER_ID || 1),
    username: String(process.env.SYSTEM_ADMIN_USERNAME || "admin"),
    role: "admin",
    workspace_code: "spare_parts",
    effective_permissions: [],
  });
  assert.ok(manager.includes("ai.documents.generate"));
  assert.ok(auditor.includes("ai.documents.generate"));
  assert.ok(systemAdmin.includes("ai.documents.generate"));
});

test("document export reads owned persisted assistant answer and evidence on the server", () => {
  const exportSource = fs.readFileSync(
    path.resolve(__dirname, "../services/aiDocumentExportService.js"),
    "utf8"
  );
  const routeSource = fs.readFileSync(
    path.resolve(__dirname, "../routes/aiDocumentRoutes.js"),
    "utf8"
  );
  const aiRoutesSource = fs.readFileSync(
    path.resolve(__dirname, "../routes/aiRoutes.js"),
    "utf8"
  );

  assert.match(exportSource, /loadOwnedConversation/);
  assert.match(exportSource, /getConversationDetails/);
  assert.match(exportSource, /message\.role !== "assistant"/);
  assert.match(exportSource, /answer: message\.content/);
  assert.match(exportSource, /evidence: message\.evidence \|\| \[\]/);
  assert.doesNotMatch(exportSource, /answer:\s*input\.answer/);
  assert.doesNotMatch(exportSource, /evidence:\s*input\.evidence/);

  assert.match(routeSource, /requireAiPermission\("ai\.documents\.generate"\)/);
  assert.match(routeSource, /AI_DOCUMENT_GENERATED/);
  assert.match(routeSource, /X-CHALIN-Document-SHA256/);
  assert.match(routeSource, /X-CHALIN-Document-Classification/);
  assert.match(aiRoutesSource, /router\.use\("\/documents", aiDocumentRoutes\)/);
});

test("protected Intelligence frontend triggers each requested document once from a successful persisted chat response", () => {
  const clientSource = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/chalin-one/ai/aiDocumentClient.js"),
    "utf8"
  );
  const captureSource = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/chalin-one/ai/AiFeedbackCorrectionCapture.jsx"),
    "utf8"
  );
  const apiSource = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/chalin-one/ai/aiApi.js"),
    "utf8"
  );
  const entrySource = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/chalin-one/ProtectedChalinOneEntry.jsx"),
    "utf8"
  );

  assert.match(clientSource, /\/ai\/documents\/generate/);
  assert.match(clientSource, /responseType:\s*"blob"/);
  assert.match(clientSource, /requestedAiDocumentFormat/);
  assert.match(clientSource, /\["pdf",\s*\/\\bpdf\\b\/i\]/);
  assert.match(clientSource, /DOCUMENT_ACTION_PATTERN[^\n]*generate/);
  assert.match(clientSource, /URL\.createObjectURL/);
  assert.doesNotMatch(clientSource, /window\.location\.reload|location\.reload/);

  assert.match(captureSource, /interceptors\.response\.use/);
  assert.match(captureSource, /documentRequestFromChatResponse/);
  assert.match(captureSource, /generateAndDownloadAiDocument/);
  assert.match(captureSource, /conversation_key/);
  assert.match(captureSource, /message_key/);
  assert.match(captureSource, /Promise\.resolve\(\)[\s\S]*generateAndDownloadAiDocument/);
  assert.doesNotMatch(captureSource, /window\.prompt/);

  assert.doesNotMatch(apiSource, /generateAndDownloadAiDocument/);
  assert.doesNotMatch(apiSource, /requestedAiDocumentFormat/);
  assert.equal((captureSource.match(/generateAndDownloadAiDocument\(documentRequest\)/g) || []).length, 1);

  assert.match(entrySource, /AiFeedbackCorrectionCapture/);
  assert.match(entrySource, /intelligence/);
});
