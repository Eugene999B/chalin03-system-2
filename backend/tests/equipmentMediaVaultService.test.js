const assert = require("node:assert/strict");
const test = require("node:test");

const {
  presignGetObject,
  transformResponseBody,
} = require("../services/equipmentMediaVaultService");

const ENV_NAMES = [
  "CHALIN03_OBJECT_STORAGE_ENABLED",
  "CHALIN03_OBJECT_STORAGE_ENDPOINT",
  "CHALIN03_OBJECT_STORAGE_REGION",
  "CHALIN03_OBJECT_STORAGE_BUCKET",
  "CHALIN03_OBJECT_STORAGE_ACCESS_KEY",
  "CHALIN03_OBJECT_STORAGE_SECRET_KEY",
];

function clearStorageEnv() {
  for (const name of ENV_NAMES) delete process.env[name];
}

test("media vault leaves inline images untouched when object storage is disabled", async () => {
  const previous = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  clearStorageEnv();
  const original = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  try {
    const body = { image_url: original, nested: { thumbnail_url: original } };
    const transformed = await transformResponseBody(body);
    assert.equal(transformed.image_url, original);
    assert.equal(transformed.nested.thumbnail_url, original);
  } finally {
    clearStorageEnv();
    for (const [name, value] of Object.entries(previous)) {
      if (value !== undefined) process.env[name] = value;
    }
  }
});

test("media vault presigns only when all object storage settings are present", () => {
  const previous = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  try {
    clearStorageEnv();
    assert.equal(presignGetObject("chalin03/media/images/test.jpg"), null);
    process.env.CHALIN03_OBJECT_STORAGE_ENABLED = "true";
    process.env.CHALIN03_OBJECT_STORAGE_ENDPOINT = "https://storage.example.test";
    process.env.CHALIN03_OBJECT_STORAGE_REGION = "auto";
    process.env.CHALIN03_OBJECT_STORAGE_BUCKET = "test-bucket";
    process.env.CHALIN03_OBJECT_STORAGE_ACCESS_KEY = "test-access";
    process.env.CHALIN03_OBJECT_STORAGE_SECRET_KEY = "test-secret";
    const url = presignGetObject("chalin03/media/images/test.jpg", 900);
    assert.match(url, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
    assert.match(url, /X-Amz-Expires=900/);
    assert.match(url, /X-Amz-Signature=[0-9a-f]{64}$/);
  } finally {
    clearStorageEnv();
    for (const [name, value] of Object.entries(previous)) {
      if (value !== undefined) process.env[name] = value;
    }
  }
});
