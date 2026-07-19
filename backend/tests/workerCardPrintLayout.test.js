const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const {
  CARD_PIXEL_HEIGHT,
  CARD_PIXEL_WIDTH,
  backSvg,
  buildA4ProofCardPdf,
  buildExactCr80CardPdf,
  frontSvg,
  renderWorkerCardArtwork,
} = require("../services/workerCardArtworkService");

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
      id_card_serial: "CH03-SP-0001",
      job_title: "IT Personnel",
      department: "Information Technology",
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
    emergency_contacts: [
      {
        full_name: "Primary Contact",
        primary_phone: "0240000000",
        is_primary: 1,
      },
    ],
    company: {
      name: "Chalin 03 Company Limited",
      address: "Dunkwa Police Barrier, Ghana",
      phone: "0249469080",
    },
  };
}

test("staff card artwork is rendered at print-quality CR80 proportions", async () => {
  const data = await fixtureData();
  const artwork = await renderWorkerCardArtwork(data);

  for (const side of [artwork.front, artwork.back]) {
    assert.ok(Buffer.isBuffer(side));
    assert.ok(side.length > 1000);
    const metadata = await sharp(side).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, CARD_PIXEL_WIDTH);
    assert.equal(metadata.height, CARD_PIXEL_HEIGHT);
  }
});

test("exact card PDF has only two pages with one complete side per page", async () => {
  const data = await fixtureData();
  const pdf = await buildExactCr80CardPdf(data);
  const source = pdf.toString("latin1");

  assert.equal(pageCount(pdf), 2);
  assert.ok((source.match(/\/Subtype\s*\/Image\b/g) || []).length >= 2);
  assert.doesNotMatch(source, /STAFF ID CARD — A4 PRINT PROOF/);
});

test("A4 proof PDF remains a single page", async () => {
  const data = await fixtureData();
  const pdf = await buildA4ProofCardPdf(data);
  assert.equal(pageCount(pdf), 1);
});

test("corporate card is professional but clearly distinct from government IDs", async () => {
  const data = await fixtureData();
  const front = frontSvg(data);
  const back = backSvg(data);

  assert.match(front, /STAFF IDENTIFICATION CARD/);
  assert.match(front, /NOT A NATIONAL ID/);
  assert.match(back, /not a national, ECOWAS, travel or government identity document/i);
  assert.match(front, /CH03-SP-0001/);
  assert.match(front, /Appiah Amankwah Eugene/);
  assert.match(back, /DUNKWA POLICE BARRIER/i);
  assert.doesNotMatch(`${front}${back}`, /ECOWAS LOGO|MACHINE READABLE ZONE|E-PASSPORT/i);
});
