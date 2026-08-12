const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
  CHALIN_ONE_STAGING_ENVIRONMENT_ID,
  CHALIN_ONE_STAGING_GIT_BRANCH,
  CHALIN_ONE_STAGING_PUBLIC_DOMAIN,
  checksumBackup,
  isConfirmedRailwayStaging,
  isLiveProductionEnvironment,
  signBackup,
  validateBackupContract,
} = require("../services/backupSafetyService");

function makeBackup(secret = "c".repeat(64)) {
  const backup = {
    app: "Chalin 03 Group Operations Platform",
    version: BACKUP_MANIFEST_VERSION,
    backup_type: BACKUP_TYPE,
    backup_id: "00000000-0000-4000-8000-000000000099",
    created_at: "2026-08-12T12:59:47.484Z",
    included_tables: ["future_table", "products", "users"],
    excluded_tables: ["auth_sessions", "schema_migrations"],
    table_columns: {
      future_table: ["id", "future_value"],
      products: ["id", "name"],
      users: ["id", "username", "token_version"],
    },
    table_counts: { future_table: 0, products: 1, users: 1 },
    total_record_count: 2,
    schema_migrations: [
      { migration_name: "phase0", description: "test", applied_at: null },
      { migration_name: "future_runtime", description: "source only", applied_at: null },
    ],
    tables: {
      future_table: [],
      products: [{ id: 1, name: "Filter" }],
      users: [{ id: 1, username: "admin", token_version: 2 }],
    },
  };
  backup.checksum_sha256 = checksumBackup(backup);
  backup.signature_hmac_sha256 = signBackup(backup, secret);
  return backup;
}

const currentTableColumns = {
  products: ["id", "name"],
  users: ["id", "username", "token_version"],
};

const currentTableMetadata = {
  products: currentTableColumns.products.map((name) => ({
    name,
    nullable: true,
    hasDefault: false,
    extra: "",
  })),
  users: currentTableColumns.users.map((name) => ({
    name,
    nullable: true,
    hasDefault: false,
    extra: "",
  })),
};

const currentSchemaMigrations = [
  { migration_name: "phase0", description: "test", applied_at: null },
];

function withEnvironment(values, callback) {
  const keys = [
    "NODE_ENV",
    "RAILWAY_ENVIRONMENT_NAME",
    "RAILWAY_ENVIRONMENT_ID",
    "RAILWAY_PUBLIC_DOMAIN",
    "RAILWAY_GIT_BRANCH",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  try {
    for (const key of keys) delete process.env[key];
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined && value !== null) process.env[key] = String(value);
    }
    return callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function validateCurrentEnvironment() {
  return validateBackupContract({
    backup: makeBackup(),
    currentIncludedTables: ["users", "products"],
    currentTableColumns,
    currentTableMetadata,
    currentSchemaMigrations,
    signingSecret: "b".repeat(64),
    requireSignature: true,
    allowAdditiveSchemaDrift: true,
  });
}

test("Railway staging is recognized by the chalin-one Git branch even when environment name says production", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      RAILWAY_ENVIRONMENT_NAME: "production",
      RAILWAY_GIT_BRANCH: CHALIN_ONE_STAGING_GIT_BRANCH,
    },
    () => {
      assert.equal(isConfirmedRailwayStaging(), true);
      assert.equal(isLiveProductionEnvironment(), false);

      const report = validateCurrentEnvironment();
      assert.equal(report.valid, true, report.errors.join("\n"));
      assert.equal(report.crossEnvironmentRecovery, true);
      assert.equal(report.signatureVerified, false);
      assert.deepEqual(report.sourceOnlyTables, ["future_table"]);
    }
  );
});

test("Railway staging is recognized by its public domain when environment name is unavailable", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      RAILWAY_PUBLIC_DOMAIN: CHALIN_ONE_STAGING_PUBLIC_DOMAIN,
    },
    () => {
      assert.equal(isConfirmedRailwayStaging(), true);
      assert.equal(isLiveProductionEnvironment(), false);

      const report = validateCurrentEnvironment();
      assert.equal(report.valid, true, report.errors.join("\n"));
      assert.equal(report.crossEnvironmentRecovery, true);
      assert.deepEqual(report.sourceOnlyTables, ["future_table"]);
      assert.match(
        report.warnings.join(" "),
        /signature|future_table|future_runtime/i
      );
    }
  );
});

test("Railway staging is recognized by its environment id when environment name and public domain are unavailable", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      RAILWAY_ENVIRONMENT_ID: CHALIN_ONE_STAGING_ENVIRONMENT_ID,
    },
    () => {
      assert.equal(isConfirmedRailwayStaging(), true);
      assert.equal(isLiveProductionEnvironment(), false);

      const report = validateCurrentEnvironment();
      assert.equal(report.valid, true, report.errors.join("\n"));
      assert.equal(report.crossEnvironmentRecovery, true);
    }
  );
});

test("a non-staging Railway production branch remains strict", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      RAILWAY_ENVIRONMENT_NAME: "production",
      RAILWAY_GIT_BRANCH: "production",
      RAILWAY_PUBLIC_DOMAIN: "chalin03-system-2-production.up.railway.app",
    },
    () => {
      assert.equal(isConfirmedRailwayStaging(), false);
      assert.equal(isLiveProductionEnvironment(), true);

      const report = validateCurrentEnvironment();
      assert.equal(report.valid, false);
      assert.equal(Boolean(report.crossEnvironmentRecovery), false);
      assert.match(
        report.errors.join(" "),
        /signature|unknown backup migrations|not supported by the current database/i
      );
    }
  );
});
