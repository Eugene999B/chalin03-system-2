const { pool } = require("../config/db");

const MIGRATION_NAME = "20260723_release31_runtime_schema_baseline";
const REQUIRED_TABLE_COLUMNS = Object.freeze({
  users: [
    "id",
    "full_name",
    "username",
    "password_hash",
    "role",
    "phone",
    "default_branch_id",
    "can_access_all_branches",
    "is_active",
    "failed_login_attempts",
    "is_login_locked",
    "login_locked_at",
    "login_lock_reason",
    "last_failed_login_at",
    "last_failed_login_ip",
    "token_version",
    "primary_workspace_code",
    "category_assignment_status",
    "category_conflict_reason",
    "category_assignment_reviewed_at",
    "category_assignment_reviewed_by",
    "created_at",
    "updated_at",
  ],
  branches: [
    "id",
    "code",
    "branch_code",
    "name",
    "location",
    "phone",
    "is_active",
  ],
  user_branch_access: [
    "user_id",
    "branch_id",
    "can_access",
    "created_at",
    "updated_at",
  ],
  activity_log: ["id", "branch_id", "user_id", "action", "details", "created_at"],
});

const REQUIRED_ROLES = Object.freeze([
  "admin",
  "manager",
  "staff",
  "cashier",
  "auditor",
]);

let readinessPromise = null;

function schemaError(message, metadata = {}) {
  const error = new Error(message);
  error.code = "USER_ADMINISTRATION_SCHEMA_NOT_READY";
  error.statusCode = 503;
  Object.assign(error, metadata);
  return error;
}

async function ensureUserAdministrationSchema(connection = pool) {
  if (connection === pool && readinessPromise) return readinessPromise;

  const verify = async () => {
    const tableNames = Object.keys(REQUIRED_TABLE_COLUMNS);
    const [tableRows] = await connection.query(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_TYPE = 'BASE TABLE'
         AND TABLE_NAME IN (${tableNames.map(() => "?").join(", ")})`,
      tableNames
    );
    const existingTables = new Set(tableRows.map((row) => row.TABLE_NAME));
    const missingTables = tableNames.filter(
      (tableName) => !existingTables.has(tableName)
    );

    const [columnRows] = await connection.query(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN (${tableNames.map(() => "?").join(", ")})`,
      tableNames
    );
    const columnsByTable = new Map(
      tableNames.map((tableName) => [tableName, new Map()])
    );
    for (const row of columnRows) {
      columnsByTable
        .get(row.TABLE_NAME)
        ?.set(row.COLUMN_NAME, String(row.COLUMN_TYPE || ""));
    }

    const missingColumns = [];
    for (const [tableName, columns] of Object.entries(REQUIRED_TABLE_COLUMNS)) {
      if (!existingTables.has(tableName)) continue;
      for (const columnName of columns) {
        if (!columnsByTable.get(tableName)?.has(columnName)) {
          missingColumns.push(`${tableName}.${columnName}`);
        }
      }
    }

    const invalidColumns = [];
    const roleType = columnsByTable.get("users")?.get("role")?.toLowerCase() || "";
    if (roleType.startsWith("enum(")) {
      for (const role of REQUIRED_ROLES) {
        if (!roleType.includes(`'${role}'`)) {
          invalidColumns.push(`users.role is missing ${role}`);
        }
      }
    } else if (!/^varchar\((\d+)\)/.test(roleType)) {
      invalidColumns.push("users.role must be the approved ENUM or VARCHAR contract");
    }

    if (missingTables.length || missingColumns.length || invalidColumns.length) {
      throw schemaError(
        `User administration migration ${MIGRATION_NAME} is incomplete.`,
        { missingTables, missingColumns, invalidColumns }
      );
    }

    return {
      ready: true,
      migration_name: MIGRATION_NAME,
      missing_tables: [],
      missing_columns: [],
      invalid_columns: [],
    };
  };

  if (connection !== pool) return verify();
  readinessPromise = verify().catch((error) => {
    readinessPromise = null;
    throw error;
  });
  return readinessPromise;
}

module.exports = {
  MIGRATION_NAME,
  REQUIRED_ROLES,
  REQUIRED_TABLE_COLUMNS,
  ensureUserAdministrationSchema,
};
