const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const {
  asBuffer,
  normalizePdfImageBuffer,
} = require("../services/pdfImageService");

const ROOT = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("worker PDF photo service converts WebP uploads to PDF-safe PNG", async () => {
  const webp = await sharp({
    create: {
      width: 24,
      height: 30,
      channels: 3,
      background: { r: 30, g: 90, b: 150 },
    },
  })
    .webp()
    .toBuffer();

  const normalized = await normalizePdfImageBuffer(webp, "image/webp");
  assert.ok(Buffer.isBuffer(normalized));
  assert.ok(normalized.length > 0);

  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 24);
  assert.equal(metadata.height, 30);
});

test("worker PDF photo service accepts MySQL-style buffer objects", () => {
  const converted = asBuffer({ type: "Buffer", data: [1, 2, 3, 4] });
  assert.ok(Buffer.isBuffer(converted));
  assert.deepEqual([...converted], [1, 2, 3, 4]);
});

test("both worker ID card and full worker document use the normalized photo", () => {
  const routes = read("backend/routes/workerPrintRoutes.js");
  assert.match(routes, /photo_data = await normalizePdfImageBuffer/);
  const photoUses = routes.match(/profile\.photo_data/g) || [];
  assert.ok(photoUses.length >= 2, "Expected the shared worker photo in both PDF outputs");
  assert.match(routes, /buildWorkerProfilePdf/);
  assert.match(routes, /drawIdCardFront/);
});
