const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
test("object storage migration is repeatable and preserves legacy payloads", {
  skip: process.env.RUN_STORAGE_MIGRATION_TEST !== "1"
}, async () => {
  const mysql = require("mysql2/promise");
  const connection = await mysql.createConnection({
    host: "127.0.0.1", user: "root", password: "ci-pool-only", database: "pool_test"
  });
  try {
    await connection.query("CREATE TABLE equipment_media (id INT PRIMARY KEY, storage_key VARCHAR(255), payload TEXT)");
    await connection.query("INSERT INTO equipment_media VALUES (1, 'legacy-key', 'keep-media')");
    await connection.query("CREATE TABLE equipment_finance_private_documents (id INT PRIMARY KEY, content_checksum VARCHAR(64), encrypted_payload TEXT)");
    await connection.query("INSERT INTO equipment_finance_private_documents VALUES (1, 'checksum', 'keep-encrypted')");
    await connection.query("CREATE TABLE schema_migrations (migration_name VARCHAR(255) PRIMARY KEY, description TEXT)");
    const source = fs.readFileSync("../database/migrations/20260904_object_storage_foundation.sql", "utf8");
    const statements = []; let delimiter = ";"; let buffer = "";
    for (const line of source.split(/\r?\n/)) {
      if (/^DELIMITER /.test(line)) { delimiter = line.slice(10).trim(); continue; }
      if (line.trim().startsWith("--") || !line.trim()) continue;
      buffer += line + "\n";
      if (buffer.trimEnd().endsWith(delimiter)) {
        statements.push(buffer.trimEnd().slice(0, -delimiter.length)); buffer = "";
      }
    }
    assert.equal(buffer.trim(), "");
    for (let i = 0; i < 2; i++) for (const sql of statements) await connection.query(sql);
    const [media] = await connection.query("SELECT payload, storage_provider, storage_bucket, storage_status FROM equipment_media");
    assert.equal(media[0].payload, "keep-media");
    const [docs] = await connection.query("SELECT encrypted_payload, storage_provider, storage_bucket, storage_key, storage_etag, storage_status, stored_at FROM equipment_finance_private_documents");
    assert.equal(docs[0].encrypted_payload, "keep-encrypted");
    const [versions] = await connection.query("SELECT COUNT(*) AS count FROM schema_migrations");
    assert.equal(versions[0].count, 1);
  } finally { await connection.end(); }
});
