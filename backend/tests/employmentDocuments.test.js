const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  normalizeSignatureDataUrl,
} = require("../services/documentSignatureService");
const { buildHrDocumentPdf } = require("../services/hrDocumentPdfService");

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pageCount(buffer) {
  const text = buffer.toString("latin1");
  return (text.match(/\/Type\s*\/Page\b/g) || []).length;
}

test("signature validation accepts a real PNG and rejects non-PNG data", () => {
  assert.equal(normalizeSignatureDataUrl(ONE_PIXEL_PNG), ONE_PIXEL_PNG);
  assert.throws(
    () => normalizeSignatureDataUrl("data:image/jpeg;base64,AAAA"),
    /must be a PNG drawing/i
  );
});

test("compact HR PDF uses only occupied pages and embeds approval identity", async () => {
  const buffer = await buildHrDocumentPdf({
    workspaceCode: "spare_parts",
    person: {
      full_name: "Kwame Mensah",
      preferred_name: "Kwame",
      phone: "0240000000",
      email: "kwame@example.com",
      job_title: "Store Assistant",
      address: "Dunkwa-on-Offin",
    },
    letter: {
      letter_number: "C03-SP-EXT-EMP-2026-000001",
      letter_type: "employment",
      title: "Employment / Appointment Letter",
      subject: "Appointment as Store Assistant",
      letter_date: "2026-07-19",
      status: "issued",
      issued_at: "2026-07-19T12:00:00Z",
      signature_captured_at: "2026-07-19T12:00:00Z",
      signatory_name: "Managing Director",
      signatory_title: "Managing Director",
      payload: {
        role: "Store Assistant",
        department: "Spare Parts",
        work_location: "Dunkwa Police Barrier",
        employment_type: "Permanent",
        start_date: "2026-07-20",
        salary_amount: 2500,
        pay_frequency: "Monthly",
        probation_period: "Three months",
        working_schedule: "Monday to Saturday",
        rules: [
          "Report to work punctually.",
          "Protect company money, stock and property.",
        ],
        worker_agreement:
          "I confirm that I understand and accept the terms in this appointment letter.",
      },
    },
    signatureSnapshot: {
      dataUrl: ONE_PIXEL_PNG,
      name: "Eugene Amankwah Appiah",
      title: "Managing Director",
    },
  });

  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  assert.ok(buffer.length > 3000);
  assert.ok(pageCount(buffer) >= 1);
  assert.ok(pageCount(buffer) <= 2, "a short employment letter must not create empty trailing pages");
});

test("standalone documents preserve linking and signature snapshot requirements", () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, "..", "routes", "standaloneHrDocumentRoutes.js"),
    "utf8"
  );
  const workerV2Source = fs.readFileSync(
    path.join(__dirname, "..", "routes", "workerHrPdfV2Routes.js"),
    "utf8"
  );
  const schemaSource = fs.readFileSync(
    path.join(__dirname, "..", "services", "employmentDocumentSchemaService.js"),
    "utf8"
  );
  const signatureRouteSource = fs.readFileSync(
    path.join(__dirname, "..", "routes", "documentSignatureRoutes.js"),
    "utf8"
  );

  assert.match(routeSource, /standalone_hr_documents/);
  assert.match(routeSource, /link-worker/);
  assert.match(routeSource, /Approve and issue the document before linking/);
  assert.match(routeSource, /linked_worker_letter_id/);
  assert.match(routeSource, /approval_signature_data_url/);
  assert.match(workerV2Source, /getDocumentSignatureSnapshot/);
  assert.match(schemaSource, /document_signature_settings/);
  assert.match(schemaSource, /signature_captured_at/);
  assert.match(signatureRouteSource, /requirePermission\("security\.admin"\)/);
});
