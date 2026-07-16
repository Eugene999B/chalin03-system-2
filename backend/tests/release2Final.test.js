const assert = require("node:assert/strict");
const {
  readFileSync,
} = require("node:fs");
const {
  join,
} = require("node:path");
const test = require("node:test");

const backendRoot = join(
  __dirname,
  ".."
);

const projectRoot = join(
  backendRoot,
  ".."
);

function readBackend(path) {
  return readFileSync(
    join(
      backendRoot,
      path
    ),
    "utf8"
  );
}

function readProject(path) {
  return readFileSync(
    join(
      projectRoot,
      path
    ),
    "utf8"
  );
}

test(
  "Release 2 Final migration is additive and complete",
  () => {
    const migration =
      readProject(
        "database/migrations/20260716_release2_final_security_backup_workers_executive.sql"
      );

    for (const table of [
      "protected_action_sessions",
      "owner_break_glass_accounts",
      "owner_recovery_sessions",
      "privileged_action_ledger",
      "backup_history",
      "worker_profiles",
      "worker_assignments",
      "worker_documents",
      "worker_licenses",
      "worker_property_assignments",
      "worker_status_history",
    ]) {
      assert.match(
        migration,
        new RegExp(
          `CREATE TABLE IF NOT EXISTS ${table}`
        )
      );
    }

    assert.match(
      migration,
      /release2_final_security_backup_workers_executive/
    );

    assert.doesNotMatch(
      migration,
      /\bDROP\s+TABLE\b/i
    );

    assert.doesNotMatch(
      migration,
      /\bTRUNCATE\b/i
    );

    assert.doesNotMatch(
      migration,
      /\bDELETE\s+FROM\b/i
    );
  }
);

test(
  "Release 2 Final backend exposes the approved consolidated controls",
  () => {
    const source =
      readBackend(
        "routes/release2FinalRoutes.js"
      );

    for (const marker of [
      "PROTECTED_ACTION_UNLOCKED",
      "OWNER_BREAK_GLASS_CONFIGURED",
      "OWNER_RESET_SYSTEM_ADMIN",
      "PROFESSIONAL_BACKUP_CREATED",
      "WORKER_DEACTIVATED",
      "executive/summary",
      "verifyLedgerChain",
      "GET_LOCK",
      "RELEASE_LOCK",
      "package_checksum_sha256",
      "restore_policy",
    ]) {
      assert.match(
        source,
        new RegExp(marker)
      );
    }

    assert.match(
      source,
      /Release 2 Final does not provide automatic selective production restore or merge/
    );

    assert.doesNotMatch(
      source,
      /temporary_password_recorded:\s*true/
    );
  }
);

test(
  "Release 2 Final routes and permissions are registered",
  () => {
    const server =
      readBackend(
        "server.js"
      );

    const permissions =
      readBackend(
        "security/permissionCatalog.js"
      );

    assert.match(
      server,
      /release2FinalRoutes/
    );

    assert.match(
      server,
      /\/api\/release2-final/
    );

    for (const permission of [
      "security.view",
      "workers.view",
      "workers.manage",
      "workers.documents.manage",
      "workers.deactivate",
      "executive.operations.view",
    ]) {
      assert.match(
        permissions,
        new RegExp(
          permission.replace(
            ".",
            "\\."
          )
        )
      );
    }
  }
);

test(
  "Release 2 Final SMS boundary remains security and backup failure only",
  () => {
    const source =
      readBackend(
        "routes/release2FinalRoutes.js"
      );

    assert.match(
      source,
      /Approved backup-failure alert/
    );

    assert.match(
      source,
      /Owner Break-Glass successfully reset/
    );

    assert.doesNotMatch(
      source,
      /mining.*sms.*customer/i
    );

    assert.doesNotMatch(
      source,
      /hire.*sms.*customer/i
    );
  }
);