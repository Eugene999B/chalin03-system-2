const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const MIGRATION_DIRECTORY = "database/migrations/";
const MIGRATION_NAME_PATTERN = /^\d{8}_[a-z0-9][a-z0-9_]*\.sql$/;
const VERIFY_SUFFIX = "_verify.sql";

const DESTRUCTIVE_MIGRATION_RULES = [
  {
    code: "DROP_DATABASE_SCHEMA_TABLE",
    pattern: /\bDROP\s+(?!TEMPORARY\s+)(?:DATABASE|SCHEMA|TABLE)\b/i,
    message: "DROP DATABASE, DROP SCHEMA and DROP TABLE are forbidden in production migrations.",
  },
  {
    code: "TRUNCATE",
    pattern: /\bTRUNCATE(?:\s+TABLE)?\b/i,
    message: "TRUNCATE is forbidden in production migrations.",
  },
  {
    code: "DELETE",
    pattern: /\bDELETE\s+FROM\b/i,
    message: "DELETE FROM is forbidden; preserve records and correct forward additively.",
  },
  {
    code: "REPLACE_INTO",
    pattern: /\bREPLACE\s+INTO\b/i,
    message: "REPLACE INTO can overwrite records and is forbidden.",
  },
  {
    code: "DROP_COLUMN",
    pattern: /\bALTER\s+TABLE\b[\s\S]{0,500}?\bDROP\s+(?:COLUMN\s+)?[`a-z0-9_]+/i,
    message: "ALTER TABLE DROP COLUMN is forbidden.",
  },
  {
    code: "DROP_KEY_OR_CONSTRAINT",
    pattern: /\bALTER\s+TABLE\b[\s\S]{0,500}?\bDROP\s+(?:PRIMARY\s+KEY|FOREIGN\s+KEY|INDEX|KEY|CONSTRAINT)\b/i,
    message: "Dropping keys or constraints requires a separately reviewed exceptional process.",
  },
  {
    code: "RENAME_TABLE",
    pattern: /\bRENAME\s+TABLE\b/i,
    message: "RENAME TABLE is forbidden in additive production migrations.",
  },
  {
    code: "CREATE_OR_REPLACE_TABLE",
    pattern: /\bCREATE\s+OR\s+REPLACE\s+TABLE\b/i,
    message: "CREATE OR REPLACE TABLE is forbidden.",
  },
  {
    code: "DISABLE_FOREIGN_KEYS",
    pattern: /\bSET\s+(?:SESSION\s+|GLOBAL\s+)?FOREIGN_KEY_CHECKS\s*=\s*0\b/i,
    message: "Disabling foreign-key checks is forbidden in production migrations.",
  },
  {
    code: "PRODUCTION_DATABASE_SELECTION",
    pattern: /\bUSE\s+[`']?(?:railway|production|prod)[`']?\s*;/i,
    message: "Migrations must not hard-code a production database name.",
  },
];

const VERIFY_WRITE_PATTERN = /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE|CALL|EXECUTE|PREPARE|DEALLOCATE|SET)\b/i;
const SCHEMA_MIGRATION_RECORD_PATTERN = /\bINSERT\s+(?:IGNORE\s+)?INTO\s+schema_migrations\b/i;

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function stripSqlComments(sql) {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function parseNameStatus(output) {
  return String(output || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const columns = line.split("\t");
      const rawStatus = columns[0] || "";
      const status = rawStatus[0] || "";

      if (status === "R" || status === "C") {
        return {
          status,
          oldPath: normalizePath(columns[1]),
          path: normalizePath(columns[2]),
        };
      }

      return {
        status,
        oldPath: null,
        path: normalizePath(columns[1]),
      };
    });
}

function listChangedEntries({ base, head = "HEAD", repoRoot = process.cwd() }) {
  if (!base) {
    throw new Error("A base Git ref or SHA is required for migration safety verification.");
  }

  const output = execFileSync(
    "git",
    ["diff", "--name-status", "--find-renames", `${base}...${head}`],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  return parseNameStatus(output);
}

function isMigrationSql(filePath) {
  const normalized = normalizePath(filePath);
  return (
    normalized.startsWith(MIGRATION_DIRECTORY) &&
    normalized.toLowerCase().endsWith(".sql")
  );
}

function isVerifyMigration(filePath) {
  return normalizePath(filePath).toLowerCase().endsWith(VERIFY_SUFFIX);
}

function expectedVerifyPath(filePath) {
  const normalized = normalizePath(filePath);
  return normalized.replace(/\.sql$/i, VERIFY_SUFFIX);
}

function readRepositoryFile(repoRoot, filePath) {
  return fs.readFileSync(path.join(repoRoot, normalizePath(filePath)), "utf8");
}

function fileExists(repoRoot, filePath) {
  return fs.existsSync(path.join(repoRoot, normalizePath(filePath)));
}

function hasGuardedBackupRunner({ repoRoot, filePath }) {
  const migrationFileName = path.posix.basename(normalizePath(filePath));
  const scriptsDirectory = path.join(repoRoot, "backend", "scripts");
  if (!fs.existsSync(scriptsDirectory)) return false;

  for (const scriptName of fs.readdirSync(scriptsDirectory)) {
    if (!scriptName.endsWith(".js")) continue;
    const scriptPath = path.join(scriptsDirectory, scriptName);
    let scriptContent = "";
    try {
      scriptContent = fs.readFileSync(scriptPath, "utf8");
    } catch {
      continue;
    }
    if (!scriptContent.includes(migrationFileName)) continue;
    if (
      scriptContent.includes("CHALIN03_SIGNED_BACKUP_CONFIRMED") &&
      scriptContent.includes("CHALIN03_SQL_BACKUP_CONFIRMED")
    ) {
      return true;
    }
  }

  return false;
}

function addError(errors, filePath, code, message) {
  errors.push({
    file: normalizePath(filePath),
    code,
    message,
  });
}

function validateVerifySql({ filePath, content, errors }) {
  const executableSql = stripSqlComments(content);

  if (VERIFY_WRITE_PATTERN.test(executableSql)) {
    addError(
      errors,
      filePath,
      "VERIFY_NOT_READ_ONLY",
      "Verification SQL must be read-only and may not create, alter or mutate database state."
    );
  }

  if (!/\b(?:SELECT|SHOW|DESCRIBE|EXPLAIN|WITH)\b/i.test(executableSql)) {
    addError(
      errors,
      filePath,
      "VERIFY_HAS_NO_READ_QUERY",
      "Verification SQL must contain at least one read-only query."
    );
  }
}

function validateAdditiveMigration({ repoRoot, filePath, content, errors }) {
  const executableSql = stripSqlComments(content);
  const upperContent = content.toUpperCase();

  if (!upperContent.includes("ADDITIVE MIGRATION ONLY")) {
    addError(
      errors,
      filePath,
      "MISSING_ADDITIVE_MARKER",
      "Add '-- ADDITIVE MIGRATION ONLY.' near the top of the migration."
    );
  }

  if (
    !upperContent.includes("BACKUP REQUIRED") &&
    !hasGuardedBackupRunner({ repoRoot, filePath })
  ) {
    addError(
      errors,
      filePath,
      "MISSING_BACKUP_MARKER",
      "Add a '-- BACKUP REQUIRED:' instruction or a guarded migration runner that enforces both verified production backups."
    );
  }

  if (!SCHEMA_MIGRATION_RECORD_PATTERN.test(executableSql)) {
    addError(
      errors,
      filePath,
      "MISSING_SCHEMA_MIGRATION_RECORD",
      "Every production migration must record itself in schema_migrations."
    );
  }

  for (const rule of DESTRUCTIVE_MIGRATION_RULES) {
    if (rule.pattern.test(executableSql)) {
      addError(errors, filePath, rule.code, rule.message);
    }
  }

  const verifyPath = expectedVerifyPath(filePath);
  if (!fileExists(repoRoot, verifyPath)) {
    addError(
      errors,
      filePath,
      "MISSING_VERIFY_FILE",
      `Add the matching read-only verification file: ${verifyPath}`
    );
  }
}

function validateNewMigration({ repoRoot, filePath, errors }) {
  const fileName = path.posix.basename(normalizePath(filePath));

  if (!MIGRATION_NAME_PATTERN.test(fileName)) {
    addError(
      errors,
      filePath,
      "INVALID_MIGRATION_FILENAME",
      "Migration filenames must use YYYYMMDD_lowercase_description.sql."
    );
    return;
  }

  const content = readRepositoryFile(repoRoot, filePath);

  if (isVerifyMigration(filePath)) {
    validateVerifySql({ filePath, content, errors });
  } else {
    validateAdditiveMigration({ repoRoot, filePath, content, errors });
  }
}

function isProductionExecutionFile(filePath) {
  const normalized = normalizePath(filePath);

  return (
    normalized.startsWith(".github/workflows/") ||
    normalized === "railway.json" ||
    normalized === "railway.toml" ||
    normalized === "Dockerfile" ||
    normalized === "backend/Dockerfile" ||
    normalized === "backend/package.json"
  );
}

function validateSchemaSqlExecutionReference({ repoRoot, filePath, status, errors }) {
  if (status === "D" || !isProductionExecutionFile(filePath)) {
    return;
  }

  const content = readRepositoryFile(repoRoot, filePath);
  if (/database[\\/]schema\.sql/i.test(content)) {
    addError(
      errors,
      filePath,
      "SCHEMA_SQL_PRODUCTION_REFERENCE",
      "Production workflows and deployment configuration may not execute or reference database/schema.sql."
    );
  }
}

function validateChangedEntries({ repoRoot = process.cwd(), entries }) {
  const errors = [];
  const migrationEntries = entries.filter(
    (entry) => isMigrationSql(entry.path) || isMigrationSql(entry.oldPath)
  );

  for (const entry of migrationEntries) {
    if (entry.status === "D") {
      addError(
        errors,
        entry.path,
        "MIGRATION_DELETED",
        "Committed migration files are immutable and may not be deleted."
      );
      continue;
    }

    if (entry.status === "R" || entry.status === "C") {
      addError(
        errors,
        entry.path,
        "MIGRATION_RENAMED",
        "Committed migration files may not be renamed or copied; add a new forward migration."
      );
      continue;
    }

    if (entry.status === "M") {
      addError(
        errors,
        entry.path,
        "MIGRATION_MODIFIED",
        "Committed migration files are immutable; correct forward with a new timestamped migration."
      );
      continue;
    }

    if (entry.status === "A") {
      validateNewMigration({ repoRoot, filePath: entry.path, errors });
    }
  }

  for (const entry of entries) {
    validateSchemaSqlExecutionReference({
      repoRoot,
      filePath: entry.path,
      status: entry.status,
      errors,
    });
  }

  return errors;
}

function parseArguments(argv) {
  const options = { head: "HEAD" };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--base") {
      options.base = argv[index + 1];
      index += 1;
    } else if (argument === "--head") {
      options.head = argv[index + 1];
      index += 1;
    } else if (argument === "--repo-root") {
      options.repoRoot = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function formatErrors(errors) {
  return errors
    .map(
      (error, index) =>
        `${index + 1}. [${error.code}] ${error.file}: ${error.message}`
    )
    .join("\n");
}

function runCli() {
  const options = parseArguments(process.argv.slice(2));
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, "../.."));
  const entries = listChangedEntries({
    base: options.base,
    head: options.head,
    repoRoot,
  });
  const errors = validateChangedEntries({ repoRoot, entries });

  if (errors.length > 0) {
    console.error("Migration safety verification failed:\n");
    console.error(formatErrors(errors));
    process.exitCode = 1;
    return;
  }

  const changedMigrationCount = entries.filter(
    (entry) => isMigrationSql(entry.path) || isMigrationSql(entry.oldPath)
  ).length;

  console.log(
    `Migration safety verification passed. Checked ${changedMigrationCount} changed migration file(s).`
  );
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(`Migration safety verification could not run: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DESTRUCTIVE_MIGRATION_RULES,
  MIGRATION_NAME_PATTERN,
  SCHEMA_MIGRATION_RECORD_PATTERN,
  VERIFY_WRITE_PATTERN,
  expectedVerifyPath,
  formatErrors,
  hasGuardedBackupRunner,
  isMigrationSql,
  isProductionExecutionFile,
  isVerifyMigration,
  listChangedEntries,
  normalizePath,
  parseNameStatus,
  stripSqlComments,
  validateAdditiveMigration,
  validateChangedEntries,
  validateNewMigration,
  validateSchemaSqlExecutionReference,
  validateVerifySql,
};
