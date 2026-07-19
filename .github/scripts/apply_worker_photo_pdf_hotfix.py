from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


service = r'''const sharp = require("sharp");

function asBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value?.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  if (typeof value === "string") {
    const dataUrlMatch = value.match(/^data:[^;]+;base64,(.+)$/i);
    try {
      return Buffer.from(dataUrlMatch ? dataUrlMatch[1] : value, "base64");
    } catch {
      return null;
    }
  }
  return null;
}

async function normalizePdfImageBuffer(value, mimeType = "") {
  const input = asBuffer(value);
  if (!input?.length) return null;

  try {
    return await sharp(input)
      .rotate()
      .png({ compressionLevel: 6 })
      .toBuffer();
  } catch (error) {
    const normalizedMime = String(mimeType || "").trim().toLowerCase();
    if (normalizedMime === "image/png" || normalizedMime === "image/jpeg" || normalizedMime === "image/jpg") {
      return input;
    }
    console.warn("Worker PDF photo conversion failed:", error.message);
    return null;
  }
}

module.exports = {
  asBuffer,
  normalizePdfImageBuffer,
};
'''
write("backend/services/pdfImageService.js", service)

routes_path = "backend/routes/workerPrintRoutes.js"
routes = read(routes_path)
import_marker = '''const {
  calculateCardDates,
  ensureWorkerIdentitySchema,
  loadWorkerIdentitySettings,
} = require("../services/workerIdentityService");
'''
import_replacement = import_marker + '''const {
  normalizePdfImageBuffer,
} = require("../services/pdfImageService");
'''
if "normalizePdfImageBuffer" not in routes:
    if import_marker not in routes:
        raise RuntimeError("Worker print import marker not found")
    routes = routes.replace(import_marker, import_replacement, 1)

photo_marker = '''  if (!profileRows.length) {
    return null;
  }

  const [
'''
photo_replacement = '''  if (!profileRows.length) {
    return null;
  }

  profileRows[0].photo_data = await normalizePdfImageBuffer(
    profileRows[0].photo_data,
    profileRows[0].photo_mime_type
  );

  const [
'''
if "profileRows[0].photo_data = await normalizePdfImageBuffer" not in routes:
    if photo_marker not in routes:
        raise RuntimeError("Worker photo normalization marker not found")
    routes = routes.replace(photo_marker, photo_replacement, 1)
write(routes_path, routes)

test = r'''const test = require("node:test");
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
'''
write("backend/tests/workerPdfPhotoRendering.test.js", test)

print("Worker photo PDF hotfix applied.")
