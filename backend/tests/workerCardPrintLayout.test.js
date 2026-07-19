const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const {
  buildA4ProofCardPdf,
  buildExactCr80CardPdf,
} = require("../services/premiumWorkerCardService");
const {
  buildWorkerVerificationUrl,
  createVerificationQr,
  createWorkerCardSignature,
  verifyWorkerCardSignature,
} = require("../services/workerCardVerificationService");

const ROOT = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(
    path.join(ROOT, relativePath),
    "utf8"
  );
}

function pageCount(pdfBuffer) {
  const source = pdfBuffer.toString("latin1");
  return (source.match(/\/Type\s*\/Page\b/g) || []).length;
}

async function fixtureData() {
  const photo = await sharp({
    create: {
      width: 360,
      height: 480,
      channels: 3,
      background: { r: 45, g: 105, b: 160 },
    },
  })
    .png()
    .toBuffer();

  return {
    profile: {
      full_name: "Appiah Amankwah Eugene",
      employee_number: "CH03-SP-0001",
      id_card_serial: "CH03-ID-0001-2026",
      job_title: "IT Personnel",
      department: "Group Operations",
      employment_status: "active",
      id_card_issue_date: "2026-07-19",
      id_card_expiry_date: "2028-07-19",
      blood_group: "O+",
      photo_data: photo,
    },
    assignments: [
      {
        workspace_code: "spare_parts",
        context_label: "Dunkwa Police Barrier",
        is_active: 1,
      },
    ],
    company: {
      name: "Chalin 03 Company Limited",
      address: "Dunkwa Police Barrier, Ghana",
      phone: "0249469080",
    },
  };
}

test("premium exact card remains a two-page CR80 duplex PDF", async () => {
  const data = await fixtureData();
  const pdf = await buildExactCr80CardPdf(data);

  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 5000);
  assert.equal(pageCount(pdf), 2);
});

test("premium A4 proof remains a single page", async () => {
  const data = await fixtureData();
  const pdf = await buildA4ProofCardPdf(data);

  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pageCount(pdf), 1);
});

test("worker QR is real and signed verification rejects tampering", async () => {
  const data = await fixtureData();
  const profile = data.profile;
  const signature = createWorkerCardSignature(profile);
  const url = buildWorkerVerificationUrl(profile);
  const qr = await createVerificationQr(profile);
  const metadata = await sharp(qr).metadata();

  assert.match(url, /worker-card-verification\/CH03-ID-0001-2026/);
  assert.match(url, new RegExp(`sig=${signature}$`));
  assert.equal(metadata.format, "png");
  assert.ok(Number(metadata.width) >= 250);
  assert.equal(
    verifyWorkerCardSignature(profile, signature),
    true
  );
  assert.equal(
    verifyWorkerCardSignature(
      { ...profile, employee_number: "CH03-SP-9999" },
      signature
    ),
    false
  );
});

test("approved first design is premium, QR-verifiable and excludes blood group", () => {
  const drawing = read(
    "backend/services/workerCardDrawingService.js"
  );
  const verificationRoute = read(
    "backend/routes/workerCardVerificationRoutes.js"
  );

  assert.match(drawing, /STAFF IDENTIFICATION CARD/);
  assert.match(drawing, /SCAN TO VERIFY/);
  assert.match(drawing, /drawSecurityBackground/);
  assert.match(drawing, /EMPLOYEE ID/);
  assert.match(drawing, /AUTHORIZED SIGNATURE/);
  assert.doesNotMatch(drawing, /blood[_ ]?group/i);

  assert.match(
    verificationRoute,
    /VALID CHALIN 03 CREDENTIAL/
  );
  assert.match(
    verificationRoute,
    /not a Ghana Card, ECOWAS identity card, passport/i
  );
  assert.match(
    verificationRoute,
    /state\.code !== "invalid"/
  );
  assert.match(
    verificationRoute,
    /No worker details are displayed unless the QR signature is valid/
  );
  assert.doesNotMatch(
    verificationRoute,
    /national_id_number|medical_notes|emergency_contacts/i
  );
});

test("generated employee number is visible in the worker fill-in area", () => {
  const page = read(
    "frontend/src/pages/ExpandedWorkerProfilePage.jsx"
  );

  assert.match(
    page,
    /Employee number \(system generated\)/
  );
  assert.match(page, /selectedProfile\.employee_number/);
  assert.match(page, /Generated employee number:/);
  assert.match(
    page,
    /Generated automatically after saving/
  );
});
