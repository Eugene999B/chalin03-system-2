const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  expectedVerifyPath,
  parseNameStatus,
  stripSqlComments,
  validateChangedEntries,
} = require("../scripts/verifyMigrationSafety");

function createRepository() {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "chalin03-migration-safety-")
  );

  fs.mkdirSync(path.join(repoRoot, "database/migrations"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(repoRoot, ".github/workflows"), {
    recursive: true,
  });

  return repoRoot;
}

function write(repoRoot, relativePath, content) {
  const destination = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content, "utf8");
}

function validMigration() {
  return `-- CHALIN 03 PRODUCTION MIGRATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and SQL backup verified.

DROP PROCEDURE IF EXISTS chalin03_add_safe_column;

CREATE TABLE IF NOT EXISTS migration_safety_example (
  id INT AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_migrations (migration_name, description)
VALUES ('migration_safety_example', 'Creates an additive example table.')
ON DUPLICATE KEY UPDATE description = VALUES(description);
`;
}

function validVerify() {
  return `-- READ-ONLY VERIFICATION
SELECT
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'migration_safety_example';
`;
}

test("name-status parser handles additions, modifications and renames", () => {
  assert.deepEqual(
    parseNameStatus(
      "A\tdatabase/migrations/20260721_example.sql\n" +
        "M\tbackend/package.json\n" +
        "R100\told.sql\tnew.sql\n"
    ),
    [
      {
        status: "A",
        oldPath: null,
        path: "database/migrations/20260721_example.sql",
      },
      {
        status: "M",
        oldPath: null,
        path: "backend/package.json",
      },
      {
        status: "R",
        oldPath: "old.sql",
        path: "new.sql",
      },
    ]
  );
});

test("SQL comment stripping prevents policy words in comments from matching", () => {
  const stripped = stripSqlComments(
    "-- DELETE FROM customers;\nSELECT 1; /* DROP TABLE sales; */"
  );

  assert.doesNotMatch(stripped, /DELETE FROM/i);
  assert.doesNotMatch(stripped, /DROP TABLE/i);
  assert.match(stripped, /SELECT 1/i);
});

test("a new additive migration with a read-only verifier passes", () => {
  const repoRoot = createRepository();
  const migrationPath =
    "database/migrations/20260721_migration_safety_example.sql";
  const verifyPath = expectedVerifyPath(migrationPath);

  write(repoRoot, migrationPath, validMigration());
  write(repoRoot, verifyPath, validVerify());

  const errors = validateChangedEntries({
    repoRoot,
    entries: [
      { status: "A", oldPath: null, path: migrationPath },
      { status: "A", oldPath: null, path: verifyPath },
    ],
  });

  assert.deepEqual(errors, []);
});

test("DROP PROCEDURE remains allowed for idempotent helper procedures", () => {
  const repoRoot = createRepository();
  const migrationPath =
    "database/migrations/20260721_procedure_helper_example.sql";
  const verifyPath = expectedVerifyPath(migrationPath);

  write(repoRoot, migrationPath, validMigration());
  write(repoRoot, verifyPath, validVerify());

  const errors = validateChangedEntries({
    repoRoot,
    entries: [{ status: "A", oldPath: null, path: migrationPath }],
  });

  assert.equal(
    errors.some((error) => error.code === "DROP_DATABASE_SCHEMA_TABLE"),
    false
  );
});

test("destructive migration statements are rejected", () => {
  const repoRoot = createRepository();
  const migrationPath =
    "database/migrations/20260721_destructive_example.sql";
  const verifyPath = expectedVerifyPath(migrationPath);

  write(
    repoRoot,
    migrationPath,
    validMigration() + "\nDROP TABLE customers;\nDELETE FROM sales;\n"
  );
  write(repoRoot, verifyPath, validVerify());

  const errors = validateChangedEntries({
    repoRoot,
    entries: [{ status: "A", oldPath: null, path: migrationPath }],
  });
  const codes = errors.map((error) => error.code);

  assert.ok(codes.includes("DROP_DATABASE_SCHEMA_TABLE"));
  assert.ok(codes.includes("DELETE"));
});

test("new migrations require backup and schema_migrations evidence", () => {
  const repoRoot = createRepository();
  const migrationPath =
    "database/migrations/20260721_missing_controls.sql";
  const verifyPath = expectedVerifyPath(migrationPath);

  write(
    repoRoot,
    migrationPath,
    "-- ADDITIVE MIGRATION ONLY.\nCREATE TABLE IF NOT EXISTS safe_table (id INT);\n"
  );
  write(repoRoot, verifyPath, validVerify());

  const codes = validateChangedEntries({
    repoRoot,
    entries: [{ status: "A", oldPath: null, path: migrationPath }],
  }).map((error) => error.code);

  assert.ok(codes.includes("MISSING_BACKUP_MARKER"));
  assert.ok(codes.includes("MISSING_SCHEMA_MIGRATION_RECORD"));
});

test("verification files must remain read-only", () => {
  const repoRoot = createRepository();
  const verifyPath =
    "database/migrations/20260721_example_verify.sql";

  write(
    repoRoot,
    verifyPath,
    "SELECT 1;\nUPDATE users SET is_active = 0;\n"
  );

  const errors = validateChangedEntries({
    repoRoot,
    entries: [{ status: "A", oldPath: null, path: verifyPath }],
  });

  assert.ok(
    errors.some((error) => error.code === "VERIFY_NOT_READ_ONLY")
  );
});

test("committed migrations cannot be modified, deleted or renamed", () => {
  const repoRoot = createRepository();
  const migrationPath =
    "database/migrations/20260721_immutable_example.sql";

  const errors = validateChangedEntries({
    repoRoot,
    entries: [
      { status: "M", oldPath: null, path: migrationPath },
      { status: "D", oldPath: null, path: migrationPath },
      {
        status: "R",
        oldPath: migrationPath,
        path: "database/migrations/20260721_renamed_example.sql",
      },
    ],
  });
  const codes = errors.map((error) => error.code);

  assert.ok(codes.includes("MIGRATION_MODIFIED"));
  assert.ok(codes.includes("MIGRATION_DELETED"));
  assert.ok(codes.includes("MIGRATION_RENAMED"));
});

test("deployment workflows cannot reference database/schema.sql", () => {
  const repoRoot = createRepository();
  const workflowPath = ".github/workflows/dangerous-deploy.yml";

  write(
    repoRoot,
    workflowPath,
    "steps:\n  - run: mysql -h production < database/schema.sql\n"
  );

  const errors = validateChangedEntries({
    repoRoot,
    entries: [{ status: "A", oldPath: null, path: workflowPath }],
  });

  assert.ok(
    errors.some(
      (error) => error.code === "SCHEMA_SQL_PRODUCTION_REFERENCE"
    )
  );
});
