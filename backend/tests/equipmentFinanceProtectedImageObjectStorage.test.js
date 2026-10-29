const assert = require("node:assert/strict");
const test = require("node:test");
const sharp = require("sharp");

const objectStorageService = require("../services/objectStorageService");
const {
  FinanceProtectedImageError,
  normalizeStoredImage,
} = require("../services/equipmentFinanceProtectedImageService");

test("finance protected image normalizer resolves bucket references", async () => {
  const originalGetObject = objectStorageService.getObject;
  const sourceBuffer = await sharp({
    create: {
      width: 3,
      height: 2,
      channels: 3,
      background: { r: 20, g: 40, b: 60 },
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  const requestedKeys = [];

  objectStorageService.getObject = async (key) => {
    requestedKeys.push(key);
    return { buffer: sourceBuffer, contentType: "image/jpeg" };
  };

  try {
    const result = await normalizeStoredImage(
      "bucket://chalin03/media/images/abc123.jpg"
    );
    assert.deepEqual(requestedKeys, ["chalin03/media/images/abc123.jpg"]);
    assert.equal(result.mimeType, "image/jpeg");
    assert.equal(result.width, 3);
    assert.equal(result.height, 2);
    assert.equal(result.transcoded, false);
    assert.deepEqual(result.buffer, sourceBuffer);
  } finally {
    objectStorageService.getObject = originalGetObject;
  }
});

test("finance protected image normalizer returns a readable-image error for a missing bucket object", async () => {
  const originalGetObject = objectStorageService.getObject;
  objectStorageService.getObject = async () => {
    const error = new Error("not found");
    error.statusCode = 404;
    throw error;
  };

  try {
    await assert.rejects(
      () => normalizeStoredImage("bucket://chalin03/media/images/missing.jpg"),
      (error) => {
        assert.ok(error instanceof FinanceProtectedImageError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.code, "FINANCE_PROTECTED_IMAGE_NOT_READABLE");
        return true;
      }
    );
  } finally {
    objectStorageService.getObject = originalGetObject;
  }
});
