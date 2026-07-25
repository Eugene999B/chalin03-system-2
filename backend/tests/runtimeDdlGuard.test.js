const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runtimeDdlDecision,
  stripSqlComments,
} = require("../config/db");

const production = { NODE_ENV: "production" };
const development = { NODE_ENV: "development" };

test("production blocks schema-changing DDL", () => {
  for (const sql of [
    "ALTER TABLE users ADD COLUMN unsafe_flag INT",
    "CREATE TABLE unsafe_runtime_table (id INT)",
    "CREATE INDEX idx_runtime ON users (id)",
    "CREATE TRIGGER unsafe_trigger BEFORE INSERT ON users FOR EACH ROW SET @x=1",
    "DROP TABLE users",
    "TRUNCATE TABLE expenses",
    "RENAME TABLE users TO users_old",
  ]) {
    assert.equal(runtimeDdlDecision(sql, production).action, "block", sql);
  }
});

test("a single legacy CREATE TABLE IF NOT EXISTS probe becomes a no-op", () => {
  assert.equal(
    runtimeDdlDecision(
      "CREATE TABLE IF NOT EXISTS user_branch_access (id INT)",
      production
    ).action,
    "noop"
  );
});

test("multi-statement input cannot hide behind the compatibility no-op", () => {
  assert.equal(
    runtimeDdlDecision(
      "CREATE TABLE IF NOT EXISTS safe_probe (id INT); DROP TABLE users;",
      production
    ).action,
    "block"
  );
});

test("read and ordinary business-write SQL remain allowed", () => {
  for (const sql of [
    "SELECT * FROM users WHERE id = ?",
    "INSERT INTO expenses (amount) VALUES (?)",
    "UPDATE expenses SET is_voided = 1 WHERE id = ?",
    "DELETE FROM auth_sessions WHERE expires_at < NOW()",
  ]) {
    assert.equal(runtimeDdlDecision(sql, production).action, "allow", sql);
  }
});

test("development does not intercept migration development", () => {
  assert.equal(
    runtimeDdlDecision("ALTER TABLE users ADD COLUMN local_test INT", development)
      .action,
    "allow"
  );
});

test("comment stripping prevents commented DDL from triggering the guard", () => {
  const stripped = stripSqlComments(
    "-- ALTER TABLE users ADD COLUMN x INT\nSELECT 1 /* DROP TABLE sales */"
  );
  assert.equal(stripped, "SELECT 1");
  assert.equal(runtimeDdlDecision(stripped, production).action, "allow");
});
