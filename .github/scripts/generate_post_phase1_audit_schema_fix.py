from pathlib import Path
import re


def replace_pattern(source: str, pattern: re.Pattern[str], replacement: str, label: str) -> str:
    updated, count = pattern.subn(lambda _match: replacement, source, count=1)
    if count != 1:
        raise SystemExit(f"{label} matched {count} times instead of once.")
    return updated


def replace_exact(source: str, old: str, new: str, label: str) -> str:
    if source.count(old) != 1:
        raise SystemExit(f"{label} was not found exactly once.")
    return source.replace(old, new, 1)


def main() -> None:
    route_path = Path("backend/routes/auditSignoffRoutes.js")
    schema_path = Path("database/schema.sql")
    migration_path = Path(
        "database/migrations/20260725_post_phase1_audit_signoff_readiness.sql"
    )
    verify_path = Path(
        "database/migrations/20260725_post_phase1_audit_signoff_readiness_verify.sql"
    )
    test_path = Path("backend/tests/auditSchemaReadiness.test.js")

    route = route_path.read_text(encoding="utf-8")
    schema = schema_path.read_text(encoding="utf-8")

    requirements = '''let auditSchemaReadyPromise = null;

const AUDIT_SCHEMA_REQUIREMENTS = Object.freeze({
  audit_signoffs: {
    columns: [
      "id",
      "branch_id",
      "period_type",
      "period_label",
      "period_start",
      "period_end",
      "audit_score",
      "audit_status",
      "prepared_by_name",
      "reviewed_by_name",
      "approved_by_name",
      "review_date",
      "period_status",
      "sales_checked",
      "expenses_checked",
      "debts_checked",
      "stock_checked",
      "warnings_checked",
      "reports_checked",
      "purchases_checked",
      "returns_checked",
      "transfers_checked",
      "sms_checked",
      "stock_ledger_checked",
      "backup_checked",
      "maintenance_checked",
      "accountant_notes",
      "management_notes",
      "created_by",
      "approved_by",
      "created_at",
      "updated_at",
    ],
    indexes: ["idx_audit_signoff_branch"],
  },
  audit_reapproval_log: {
    columns: [
      "id",
      "branch_id",
      "audit_signoff_id",
      "unlock_request_id",
      "period_label",
      "period_start",
      "period_end",
      "previous_status",
      "new_status",
      "audit_score",
      "audit_status",
      "reapproved_by",
      "reapproved_by_name",
      "reapproved_at",
      "reapproval_notes",
      "accountant_notes",
      "management_notes",
      "created_at",
    ],
    indexes: ["idx_reapproval_branch"],
  },
});'''

    route = replace_pattern(
        route,
        re.compile(
            r'let tableReadyPromise = null;\nlet reapprovalTableReadyPromise = null;\n\nconst EXTENDED_SIGNOFF_CHECK_COLUMNS = \[[\s\S]*?\n\];',
            re.M,
        ),
        requirements,
        "Legacy audit schema declaration block",
    )

    route = replace_pattern(
        route,
        re.compile(
            r'async function ensureColumn\([\s\S]*?\n}\n\nasync function ensureIndex\([\s\S]*?\n}\n\nasync function tableExists',
            re.M,
        ),
        "async function tableExists",
        "Runtime column/index mutation helpers",
    )

    readiness_helpers = '''function auditSchemaReadinessError(state) {
  const details = [
    ...state.missing_tables.map((tableName) => `missing table ${tableName}`),
    ...state.missing_columns.map(
      ({ table_name, column_name }) => `missing column ${table_name}.${column_name}`
    ),
    ...state.missing_indexes.map(
      ({ table_name, index_name }) => `missing index ${table_name}.${index_name}`
    ),
  ];
  const error = new Error(
    `Audit schema is not ready. Apply and verify database/migrations/20260725_post_phase1_audit_signoff_readiness.sql before using Audit Sign-Offs.${
      details.length > 0 ? ` ${details.join("; ")}.` : ""
    }`
  );
  error.code = "AUDIT_SCHEMA_NOT_READY";
  error.statusCode = 503;
  error.schema_state = state;
  return error;
}

async function readAuditSchemaState(connection = pool) {
  const state = {
    ready: true,
    missing_tables: [],
    missing_columns: [],
    missing_indexes: [],
  };

  for (const [tableName, requirement] of Object.entries(
    AUDIT_SCHEMA_REQUIREMENTS
  )) {
    if (!(await tableExists(connection, tableName))) {
      state.missing_tables.push(tableName);
      continue;
    }

    const [columnRows] = await connection.query(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?`,
      [tableName]
    );
    const columns = new Set(columnRows.map((row) => row.COLUMN_NAME));

    for (const columnName of requirement.columns) {
      if (!columns.has(columnName)) {
        state.missing_columns.push({
          table_name: tableName,
          column_name: columnName,
        });
      }
    }

    const [indexRows] = await connection.query(
      `SELECT DISTINCT INDEX_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?`,
      [tableName]
    );
    const indexes = new Set(indexRows.map((row) => row.INDEX_NAME));

    for (const indexName of requirement.indexes) {
      if (!indexes.has(indexName)) {
        state.missing_indexes.push({
          table_name: tableName,
          index_name: indexName,
        });
      }
    }
  }

  state.ready =
    state.missing_tables.length === 0 &&
    state.missing_columns.length === 0 &&
    state.missing_indexes.length === 0;
  return state;
}

async function assertAuditSchemaReady(connection = pool) {
  if (connection !== pool) {
    const state = await readAuditSchemaState(connection);
    if (!state.ready) throw auditSchemaReadinessError(state);
    return state;
  }

  if (!auditSchemaReadyPromise) {
    auditSchemaReadyPromise = readAuditSchemaState(pool)
      .then((state) => {
        if (!state.ready) throw auditSchemaReadinessError(state);
        return state;
      })
      .catch((error) => {
        auditSchemaReadyPromise = null;
        throw error;
      });
  }

  return auditSchemaReadyPromise;
}

function resetAuditSchemaReadinessCache() {
  auditSchemaReadyPromise = null;
}

async function ensureAuditSignoffsTable() {
  return assertAuditSchemaReady(pool);
}

async function ensureAuditReapprovalLogTable() {
  return assertAuditSchemaReady(pool);
}'''

    route = replace_pattern(
        route,
        re.compile(
            r'async function ensureAuditSignoffsTable\(\) \{[\s\S]*?\n}\n\nasync function ensureAuditReapprovalLogTable\(\) \{[\s\S]*?\n}\n\nasync function safeLogActivity',
            re.M,
        ),
        readiness_helpers + "\n\nasync function safeLogActivity",
        "Request-time audit schema mutation functions",
    )

    route = replace_exact(
        route,
        "module.exports = router;",
        '''module.exports = router;
module.exports.AUDIT_SCHEMA_REQUIREMENTS = AUDIT_SCHEMA_REQUIREMENTS;
module.exports.assertAuditSchemaReady = assertAuditSchemaReady;
module.exports.readAuditSchemaState = readAuditSchemaState;
module.exports.resetAuditSchemaReadinessCache = resetAuditSchemaReadinessCache;''',
        "Audit router export",
    )

    schema = replace_exact(
        schema,
        '''    reports_checked BOOLEAN NOT NULL DEFAULT FALSE,

    accountant_notes TEXT,''',
        '''    reports_checked BOOLEAN NOT NULL DEFAULT FALSE,
    purchases_checked BOOLEAN NOT NULL DEFAULT FALSE,
    returns_checked BOOLEAN NOT NULL DEFAULT FALSE,
    transfers_checked BOOLEAN NOT NULL DEFAULT FALSE,
    sms_checked BOOLEAN NOT NULL DEFAULT FALSE,
    stock_ledger_checked BOOLEAN NOT NULL DEFAULT FALSE,
    backup_checked BOOLEAN NOT NULL DEFAULT FALSE,
    maintenance_checked BOOLEAN NOT NULL DEFAULT FALSE,

    accountant_notes TEXT,''',
        "Clean schema audit evidence columns",
    )

    migration = r'''-- CHALIN 03 POST-PHASE-1 AUDIT SIGN-OFF READINESS
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: download and validate a fresh signed full-system backup before production execution.
-- Adds the audit evidence columns that legacy route code previously attempted to create at request time.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS audit_signoffs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    period_type ENUM('all', 'today', 'week', 'month', 'year', 'custom') NOT NULL DEFAULT 'month',
    period_label VARCHAR(255) NOT NULL,
    period_start DATE NULL,
    period_end DATE NULL,
    audit_score INT NOT NULL DEFAULT 0,
    audit_status VARCHAR(50) NOT NULL DEFAULT 'Needs Review',
    prepared_by_name VARCHAR(150) NULL,
    reviewed_by_name VARCHAR(150) NULL,
    approved_by_name VARCHAR(150) NULL,
    review_date DATE NULL,
    period_status ENUM('draft', 'reviewed', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
    sales_checked BOOLEAN NOT NULL DEFAULT FALSE,
    expenses_checked BOOLEAN NOT NULL DEFAULT FALSE,
    debts_checked BOOLEAN NOT NULL DEFAULT FALSE,
    stock_checked BOOLEAN NOT NULL DEFAULT FALSE,
    warnings_checked BOOLEAN NOT NULL DEFAULT FALSE,
    reports_checked BOOLEAN NOT NULL DEFAULT FALSE,
    purchases_checked BOOLEAN NOT NULL DEFAULT FALSE,
    returns_checked BOOLEAN NOT NULL DEFAULT FALSE,
    transfers_checked BOOLEAN NOT NULL DEFAULT FALSE,
    sms_checked BOOLEAN NOT NULL DEFAULT FALSE,
    stock_ledger_checked BOOLEAN NOT NULL DEFAULT FALSE,
    backup_checked BOOLEAN NOT NULL DEFAULT FALSE,
    maintenance_checked BOOLEAN NOT NULL DEFAULT FALSE,
    accountant_notes TEXT NULL,
    management_notes TEXT NULL,
    created_by INT NULL,
    approved_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_audit_signoff_branch (branch_id),
    INDEX idx_audit_signoff_period_type (period_type),
    INDEX idx_audit_signoff_period_dates (period_start, period_end),
    INDEX idx_audit_signoff_status (period_status),
    INDEX idx_audit_signoff_created_by (created_by),
    INDEX idx_audit_signoff_approved_by (approved_by),
    INDEX idx_audit_signoff_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS audit_reapproval_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    audit_signoff_id INT NULL,
    unlock_request_id INT NULL,
    period_label VARCHAR(255) NOT NULL,
    period_start DATE NULL,
    period_end DATE NULL,
    previous_status VARCHAR(50) NULL,
    new_status VARCHAR(50) NOT NULL DEFAULT 'approved',
    audit_score INT NOT NULL DEFAULT 0,
    audit_status VARCHAR(50) NULL,
    reapproved_by INT NULL,
    reapproved_by_name VARCHAR(150) NULL,
    reapproved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reapproval_notes TEXT NULL,
    accountant_notes TEXT NULL,
    management_notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_reapproval_branch (branch_id),
    INDEX idx_reapproval_signoff (audit_signoff_id),
    INDEX idx_reapproval_unlock_request (unlock_request_id),
    INDEX idx_reapproval_period_dates (period_start, period_end),
    INDEX idx_reapproval_user (reapproved_by),
    INDEX idx_reapproval_date (reapproved_at)
);

SET @post_phase1_audit_readiness_applied = (
    SELECT COUNT(*)
    FROM schema_migrations
    WHERE migration_name = '20260725_post_phase1_audit_signoff_readiness'
);

DROP PROCEDURE IF EXISTS chalin03_post_phase1_audit_add_column;
DROP PROCEDURE IF EXISTS chalin03_post_phase1_audit_add_index;

DELIMITER $$

CREATE PROCEDURE chalin03_post_phase1_audit_add_column(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_column_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @post_phase1_audit_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_definition
        );
        PREPARE post_phase1_audit_statement FROM @post_phase1_audit_sql;
        EXECUTE post_phase1_audit_statement;
        DEALLOCATE PREPARE post_phase1_audit_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_post_phase1_audit_add_index(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_index_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @post_phase1_audit_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD ', p_index_definition
        );
        PREPARE post_phase1_audit_statement FROM @post_phase1_audit_sql;
        EXECUTE post_phase1_audit_statement;
        DEALLOCATE PREPARE post_phase1_audit_statement;
    END IF;
END$$

DELIMITER ;

CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'branch_id',
    '`branch_id` INT NOT NULL DEFAULT 1 AFTER `id`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'purchases_checked',
    '`purchases_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `reports_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'returns_checked',
    '`returns_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `purchases_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'transfers_checked',
    '`transfers_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `returns_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'sms_checked',
    '`sms_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `transfers_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'stock_ledger_checked',
    '`stock_ledger_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `sms_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'backup_checked',
    '`backup_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `stock_ledger_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'maintenance_checked',
    '`maintenance_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `backup_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_reapproval_log', 'branch_id',
    '`branch_id` INT NOT NULL DEFAULT 1 AFTER `id`'
);

CALL chalin03_post_phase1_audit_add_index(
    'audit_signoffs', 'idx_audit_signoff_branch',
    'INDEX `idx_audit_signoff_branch` (`branch_id`)'
);
CALL chalin03_post_phase1_audit_add_index(
    'audit_reapproval_log', 'idx_reapproval_branch',
    'INDEX `idx_reapproval_branch` (`branch_id`)'
);

INSERT INTO schema_migrations (migration_name, description)
SELECT
    '20260725_post_phase1_audit_signoff_readiness',
    'Adds the seven extended Audit Sign-Off evidence checks and branch readiness indexes so production routes use read-only schema validation instead of request-time DDL.'
WHERE @post_phase1_audit_readiness_applied = 0;

DROP PROCEDURE IF EXISTS chalin03_post_phase1_audit_add_index;
DROP PROCEDURE IF EXISTS chalin03_post_phase1_audit_add_column;
'''

    verify = r'''-- Read-only verification for 20260725_post_phase1_audit_signoff_readiness.sql

SELECT migration_name, description, applied_at
FROM schema_migrations
WHERE migration_name = '20260725_post_phase1_audit_signoff_readiness';

WITH required_columns AS (
    SELECT 'audit_signoffs' AS table_name, 'branch_id' AS column_name
    UNION ALL SELECT 'audit_signoffs', 'purchases_checked'
    UNION ALL SELECT 'audit_signoffs', 'returns_checked'
    UNION ALL SELECT 'audit_signoffs', 'transfers_checked'
    UNION ALL SELECT 'audit_signoffs', 'sms_checked'
    UNION ALL SELECT 'audit_signoffs', 'stock_ledger_checked'
    UNION ALL SELECT 'audit_signoffs', 'backup_checked'
    UNION ALL SELECT 'audit_signoffs', 'maintenance_checked'
    UNION ALL SELECT 'audit_reapproval_log', 'branch_id'
)
SELECT COUNT(*) AS missing_audit_readiness_columns
FROM required_columns required
LEFT JOIN information_schema.COLUMNS columns
  ON columns.TABLE_SCHEMA = DATABASE()
 AND columns.TABLE_NAME = required.table_name
 AND columns.COLUMN_NAME = required.column_name
WHERE columns.COLUMN_NAME IS NULL;

WITH required_indexes AS (
    SELECT 'audit_signoffs' AS table_name, 'idx_audit_signoff_branch' AS index_name
    UNION ALL SELECT 'audit_reapproval_log', 'idx_reapproval_branch'
)
SELECT COUNT(*) AS missing_audit_readiness_indexes
FROM required_indexes required
LEFT JOIN information_schema.STATISTICS indexes
  ON indexes.TABLE_SCHEMA = DATABASE()
 AND indexes.TABLE_NAME = required.table_name
 AND indexes.INDEX_NAME = required.index_name
WHERE indexes.INDEX_NAME IS NULL;

SELECT
    TABLE_NAME,
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (TABLE_NAME = 'audit_signoffs' AND COLUMN_NAME IN (
      'branch_id', 'purchases_checked', 'returns_checked',
      'transfers_checked', 'sms_checked', 'stock_ledger_checked',
      'backup_checked', 'maintenance_checked'
    ))
    OR (TABLE_NAME = 'audit_reapproval_log' AND COLUMN_NAME = 'branch_id')
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;
'''

    test = r'''const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("audit routes use read-only schema readiness instead of request-time DDL", () => {
  const route = read("backend/routes/auditSignoffRoutes.js");

  assert.doesNotMatch(route, /CREATE\s+TABLE/i);
  assert.doesNotMatch(route, /ALTER\s+TABLE/i);
  assert.doesNotMatch(route, /async function ensureColumn/);
  assert.doesNotMatch(route, /async function ensureIndex/);
  assert.match(route, /AUDIT_SCHEMA_NOT_READY/);
  assert.match(route, /information_schema\.COLUMNS/);
  assert.match(route, /information_schema\.STATISTICS/);
  assert.match(route, /assertAuditSchemaReady/);
  assert.match(route, /readAuditSchemaState/);
  assert.match(route, /resetAuditSchemaReadinessCache/);

  for (const column of [
    "purchases_checked",
    "returns_checked",
    "transfers_checked",
    "sms_checked",
    "stock_ledger_checked",
    "backup_checked",
    "maintenance_checked",
  ]) {
    assert.match(route, new RegExp(column));
  }
});

test("audit readiness migration is additive and has read-only verification", () => {
  const migration = read(
    "database/migrations/20260725_post_phase1_audit_signoff_readiness.sql"
  );
  const verification = read(
    "database/migrations/20260725_post_phase1_audit_signoff_readiness_verify.sql"
  );
  const schema = read("database/schema.sql");

  assert.match(migration, /ADDITIVE MIGRATION ONLY/);
  assert.match(migration, /BACKUP REQUIRED/);
  assert.match(migration, /INSERT INTO schema_migrations/);
  assert.match(
    migration,
    /20260725_post_phase1_audit_signoff_readiness/
  );
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|INDEX|KEY|CONSTRAINT)/i);

  assert.match(verification, /missing_audit_readiness_columns/);
  assert.match(verification, /missing_audit_readiness_indexes/);
  assert.doesNotMatch(
    verification.replace(/^--.*$/gm, ""),
    /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE|CALL|EXECUTE|PREPARE|DEALLOCATE|SET)\b/i
  );

  for (const column of [
    "purchases_checked",
    "returns_checked",
    "transfers_checked",
    "sms_checked",
    "stock_ledger_checked",
    "backup_checked",
    "maintenance_checked",
  ]) {
    assert.match(migration, new RegExp(column));
    assert.match(schema, new RegExp(column));
  }
});
'''

    route_path.write_text(route, encoding="utf-8")
    schema_path.write_text(schema, encoding="utf-8")
    migration_path.write_text(migration, encoding="utf-8")
    verify_path.write_text(verify, encoding="utf-8")
    test_path.write_text(test, encoding="utf-8")


if __name__ == "__main__":
    main()
