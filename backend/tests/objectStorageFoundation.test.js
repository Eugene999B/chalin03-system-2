const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  config,
  status,
  uploadObject,
  deleteObject,
  ObjectStorageError,
} = require("../services/objectStorageService");

const migrationPath = path.join(
  __dirname,
  "../../database/migrations/20260904_object_storage_foundation.sql"
);

const ENV_NAMES = [
  "CHALIN03_OBJECT_STORAGE_ENABLED",
  "CHALIN03_OBJECT_STORAGE_ENDPOINT",
  "CHALIN03_OBJECT_STORAGE_BUCKET",
  "CHALIN03_OBJECT_STORAGE_ACCESS_KEY",
  "CHALIN03_OBJECT_STORAGE_SECRET_KEY",
];

test("object storage stays inactive unless explicitly enabled", () => {
  const previous = Object.fromEntries(
    ENV_NAMES.map((name) => [name, process.env[name]])
  );

  for (const name of ENV_NAMES) delete process.env[name];

  try {
    assert.equal(config().enabled, false);
    assert.equal(status().enabled, false);
    assert.equal(status().configured, false);
    assert.throws(
      () =>
        uploadObject({
          key: "test.txt",
          buffer: Buffer.from("test"),
          contentType: "text/plain",
        }),
      (error) =>
        error instanceof ObjectStorageError &&
        error.code === "OBJECT_STORAGE_NOT_CONFIGURED" &&
        error.statusCode === 503
    );
    assert.throws(
      () => deleteObject("test.txt"),
      (error) =>
        error instanceof ObjectStorageError &&
        error.code === "OBJECT_STORAGE_NOT_CONFIGURED" &&
        error.statusCode === 503
    );
  } finally {
    for (const name of ENV_NAMES) delete process.env[name];
    for (const [name, value] of Object.entries(previous)) {
      if (value !== undefined) process.env[name] = value;
    }
  }
});

test("object storage migration is additive and preserves legacy payloads", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /ADD COLUMN storage_provider/i);
  assert.match(sql, /ADD COLUMN storage_key/i);
  assert.match(sql, /ADD COLUMN storage_status/i);
  assert.doesNotMatch(sql, /DROP TABLE\s+equipment_(?:media|finance_private_documents)/i);
  assert.doesNotMatch(sql, /DROP COLUMN\s+encrypted_payload/i);
  assert.doesNotMatch(sql, /TRUNCATE\s+TABLE/i);
});
