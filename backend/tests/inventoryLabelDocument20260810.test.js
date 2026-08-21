const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildInventoryLabelPdf,
  labelGeometry,
} = require("../services/inventoryLabelDocumentService");

const TEST_SECRET = ["pdf", "label", "test", "x".repeat(48)].join("-");

const batch = {
  id: 7,
  batch_code: "LBL-MAIN-20260810-K7M4Q9",
  branch_code: "MAIN",
  product_id: 44,
  product_name: "Star Oil 4L",
};

const units = [
  { id: 1, unit_code: "SO4L-K7M4Q9XD", status: "label_pending" },
  { id: 2, unit_code: "SO4L-7P3N5R8V", status: "label_pending" },
];

test("published print geometries support A4, thermal and sticker output", () => {
  assert.equal(labelGeometry("a4").columns, 3);
  assert.equal(labelGeometry("a4").rows, 8);
  assert.deepEqual(labelGeometry("thermal").columns, 1);
  assert.deepEqual(labelGeometry("sticker").columns, 1);
});

test("A4 controlled label document renders a real PDF containing every unit", async () => {
  const output = await buildInventoryLabelPdf({
    batch,
    units,
    format: "a4",
    signingSecret: TEST_SECRET,
  });

  assert.equal(output.format, "a4");
  assert.equal(output.label_count, 2);
  assert.equal(output.file_name, "LBL-MAIN-20260810-K7M4Q9-a4-labels.pdf");
  assert.ok(Buffer.isBuffer(output.buffer));
  assert.equal(output.buffer.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(output.buffer.length > 1000);
});

test("thermal and sticker documents use one physical identity per page", async () => {
  for (const format of ["thermal", "sticker"]) {
    const output = await buildInventoryLabelPdf({
      batch,
      units: [units[0]],
      format,
      signingSecret: TEST_SECRET,
    });
    assert.equal(output.format, format);
    assert.equal(output.label_count, 1);
    assert.equal(output.buffer.subarray(0, 4).toString("ascii"), "%PDF");
  }
});

test("label document refuses missing metadata or empty identity batches", async () => {
  await assert.rejects(
    buildInventoryLabelPdf({ batch: {}, units, format: "a4", signingSecret: TEST_SECRET }),
    /metadata is incomplete/
  );
  await assert.rejects(
    buildInventoryLabelPdf({ batch, units: [], format: "a4", signingSecret: TEST_SECRET }),
    /no printable inventory identities/
  );
});
