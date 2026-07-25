from pathlib import Path
import re


def replace_exact(source: str, old: str, new: str, label: str) -> str:
    if source.count(old) != 1:
        raise SystemExit(f"{label} was not found exactly once.")
    return source.replace(old, new, 1)


def replace_pattern(source: str, pattern: re.Pattern[str], replacement: str, label: str) -> str:
    updated, count = pattern.subn(lambda _match: replacement, source, count=1)
    if count != 1:
        raise SystemExit(f"{label} matched {count} times instead of once.")
    return updated


def main() -> None:
    route_path = Path("backend/routes/maintenanceRoutes.js")
    frontend_path = Path("frontend/src/pages/MaintenancePage.jsx")
    service_path = Path("backend/services/maintenanceResetService.js")
    test_path = Path("backend/tests/maintenanceResetSafety.test.js")

    route = route_path.read_text(encoding="utf-8")
    frontend = frontend_path.read_text(encoding="utf-8")

    route = replace_exact(
        route,
        'const { requireAuth } = require("../middleware/authMiddleware");',
        '''const { requireAuth } = require("../middleware/authMiddleware");
const {
  clearTablesTransactionally,
  resolveMaintenanceClearAvailability,
} = require("../services/maintenanceResetService");''',
        "Maintenance reset service import",
    )

    route = replace_pattern(
        route,
        re.compile(
            r'function isClearEnabled\(\) \{[\s\S]*?\n}\n\nasync function getExistingTables',
            re.M,
        ),
        '''function clearAvailability() {
  return resolveMaintenanceClearAvailability(process.env);
}

function isClearEnabled() {
  return clearAvailability().enabled;
}

async function getExistingTables''',
        "Legacy clear enablement function",
    )

    route = replace_pattern(
        route,
        re.compile(
            r'async function insertClearActivityLog\(connection, req\) \{[\s\S]*?\n}\n\nasync function truncateTableSafely\(connection, tableName\) \{[\s\S]*?\n}\n\n// GET /api/maintenance/business-data-summary',
            re.M,
        ),
        '''async function insertClearActivityLog(connection, req) {
  const existingTables = await getExistingTables(connection);

  if (!existingTables.includes("activity_log")) {
    return { inserted: false, reason: "activity_log_missing" };
  }

  const columns = await getTableColumns(connection, "activity_log");
  const columnSet = new Set(columns);

  if (columnSet.has("branch_id")) {
    await connection.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, ?, ?, ?)`,
      [
        getBranchId(req),
        req.systemAdmin.id,
        "CLEAR_NON_PRODUCTION_TEST_DATA",
        `${req.systemAdmin.username} transactionally cleared disposable non-production test data for the whole multi-store system`,
      ]
    );
  } else {
    await connection.query(
      `INSERT INTO activity_log (user_id, action, details)
       VALUES (?, ?, ?)`,
      [
        req.systemAdmin.id,
        "CLEAR_NON_PRODUCTION_TEST_DATA",
        `${req.systemAdmin.username} transactionally cleared disposable non-production test data for the whole system`,
      ]
    );
  }

  return { inserted: true };
}

// GET /api/maintenance/business-data-summary''',
        "Legacy clear and audit helper block",
    )

    route = replace_exact(
        route,
        '''        confirmation_required: CONFIRMATION_TEXT,
        clear_enabled: isClearEnabled(),
        system_admin_only: true,''',
        '''        confirmation_required: CONFIRMATION_TEXT,
        clear_enabled: isClearEnabled(),
        production_permanently_blocked:
          clearAvailability().production_permanently_blocked,
        clear_environment: clearAvailability().environment,
        clear_enablement_code: clearAvailability().code,
        system_admin_only: true,''',
        "Maintenance summary availability response",
    )

    delete_route = '''// DELETE /api/maintenance/clear-business-data
router.delete(
  "/clear-business-data",
  requireAuth,
  requireSystemAdministrator,
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const { confirmation, system_admin_password } = req.body;
      const availability = clearAvailability();

      if (!availability.enabled) {
        return res.status(403).json({
          status: "error",
          code: availability.code,
          message: availability.message,
          production_permanently_blocked:
            availability.production_permanently_blocked,
        });
      }

      if (!system_admin_password) {
        return res.status(400).json({
          status: "error",
          message: "System Administrator password is required.",
        });
      }

      const passwordMatches = await bcrypt.compare(
        system_admin_password,
        req.systemAdmin.password_hash
      );

      if (!passwordMatches) {
        return res.status(401).json({
          status: "error",
          message: "System Administrator password is incorrect.",
        });
      }

      if (confirmation !== CONFIRMATION_TEXT) {
        return res.status(400).json({
          status: "error",
          message: `Invalid confirmation text. Type exactly: ${CONFIRMATION_TEXT}`,
        });
      }

      const existingTables = await getExistingTables(connection);
      const availableTables = TABLES_TO_CLEAR.filter((tableName) =>
        existingTables.includes(tableName)
      );
      const protectedTables = PROTECTED_TABLES.filter((tableName) =>
        existingTables.includes(tableName)
      );
      const missingOptionalTables = TABLES_TO_CLEAR.filter(
        (tableName) => !existingTables.includes(tableName)
      );
      const beforeCounts = await getTableCounts(availableTables, connection);

      const resetResult = await clearTablesTransactionally(
        connection,
        availableTables,
        {
          beforeCommit: async ({ connection: transactionConnection }) => {
            const zeroCounts = await getTableCounts(
              availableTables,
              transactionConnection
            );
            const unclearedTables = Object.entries(zeroCounts)
              .filter(([, count]) => Number(count || 0) !== 0)
              .map(([tableName]) => tableName);

            if (unclearedTables.length > 0) {
              const error = new Error(
                `Transactional reset verification failed for: ${unclearedTables.join(", ")}.`
              );
              error.code = "MAINTENANCE_RESET_VERIFICATION_FAILED";
              throw error;
            }

            const auditResult = await insertClearActivityLog(
              transactionConnection,
              req
            );
            const afterCounts = await getTableCounts(
              availableTables,
              transactionConnection
            );

            return {
              zero_counts_before_audit: zeroCounts,
              after_counts: afterCounts,
              audit_log: auditResult,
            };
          },
        }
      );

      return res.json({
        status: "success",
        code: "NON_PRODUCTION_TEST_DATA_RESET_COMPLETED",
        message:
          "Disposable non-production test data was cleared transactionally across all workspaces. Production remains permanently blocked.",
        clear_scope: "full_system_all_stores_non_production_only",
        protected_tables: protectedTables,
        cleared_tables: availableTables,
        missing_optional_tables: missingOptionalTables,
        clear_results: resetResult.clear_results,
        before_counts: beforeCounts,
        after_counts: resetResult.before_commit_result.after_counts,
        production_permanently_blocked: true,
        note:
          "Only transactional DELETE statements were used. No TRUNCATE, ALTER TABLE or AUTO_INCREMENT reset was executed.",
      });
    } catch (error) {
      console.error("Transactional non-production test reset error:", error);

      return res.status(500).json({
        status: "error",
        code: error.code || "NON_PRODUCTION_TEST_RESET_FAILED",
        message:
          "The non-production test reset failed and the transaction was rolled back. Review the backend log before retrying.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;'''

    route = replace_pattern(
        route,
        re.compile(
            r'// DELETE /api/maintenance/clear-business-data[\s\S]*?\nmodule\.exports = router;',
            re.M,
        ),
        delete_route,
        "Maintenance clear route",
    )

    frontend = replace_pattern(
        frontend,
        re.compile(
            r'  async function clearBusinessData\(event\) \{[\s\S]*?\n  \}\n\n  const counts',
            re.M,
        ),
        '''  async function clearBusinessData(event) {
    event.preventDefault();

    const confirmBrowser = window.confirm(
      "This tool is only for disposable non-production test environments. It is permanently blocked in production. Continue with the full test-data reset?"
    );

    if (!confirmBrowser) return;

    const secondConfirm = window.confirm(
      "Final warning: the non-production reset is system-wide across Spare Parts, Mining and Equipment Sales & Hire. Continue?"
    );

    if (!secondConfirm) return;

    const backupConfirm = window.confirm(
      "Confirm that this environment contains only disposable test data or that a verified backup exists. Continue?"
    );

    if (!backupConfirm) return;

    setClearing(true);
    setMessage("");
    setError("");

    try {
      const response = await axiosClient.delete(
        "/maintenance/clear-business-data",
        {
          data: {
            system_admin_password: systemAdminPassword,
            confirmation,
          },
        }
      );

      setMessage(
        response.data.message ||
          "Non-production test data reset completed successfully."
      );
      setSystemAdminPassword("");
      setConfirmation("");

      await loadSummary();
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Something went wrong while resetting non-production test data."
      );
    } finally {
      setClearing(false);
    }
  }

  const counts''',
        "Maintenance frontend submit function",
    )

    frontend = replace_exact(
        frontend,
        '''  const clearEnabled = summary?.clear_enabled !== false;
  const systemAdminOnly = summary?.system_admin_only !== false;''',
        '''  const clearEnabled = summary?.clear_enabled === true;
  const productionPermanentlyBlocked = Boolean(
    summary?.production_permanently_blocked
  );
  const clearEnvironment = summary?.clear_environment || "unknown";
  const systemAdminOnly = summary?.system_admin_only !== false;''',
        "Maintenance frontend availability state",
    )

    frontend = replace_exact(
        frontend,
        '''  const canClear =
    clearEnabled &&
    systemAdminPassword.trim().length > 0 &&''',
        '''  const canClear =
    clearEnabled &&
    !productionPermanentlyBlocked &&
    systemAdminPassword.trim().length > 0 &&''',
        "Maintenance frontend clear enablement",
    )

    frontend = replace_exact(
        frontend,
        '''            <h1>System Maintenance</h1>
            <p>
              Clear test data safely before the business starts real operation.
            </p>''',
        '''            <h1>Non-Production Test Reset</h1>
            <p>
              Transactionally clear disposable test data outside production only.
            </p>''',
        "Maintenance page heading",
    )

    frontend = replace_exact(
        frontend,
        '''        <strong>Important:</strong> This page is for the main System
         Administrator only. It clears business/test records across all stores,
         but keeps users, branches, user store access and business settings.''',
        '''        <strong>Important:</strong> Production is permanently blocked. This
         page is for the original System Administrator in an explicitly enabled,
         disposable non-production environment only.''',
        "Maintenance important notice",
    )

    frontend = replace_exact(
        frontend,
        '''              <strong>Clear Enabled:</strong> {clearEnabled ? "Yes" : "No"}
            </p>''',
        '''              <strong>Reset Enabled:</strong> {clearEnabled ? "Yes" : "No"}
            </p>
            <p>
              <strong>Environment:</strong> {clearEnvironment}
            </p>
            <p>
              <strong>Production Permanently Blocked:</strong>{" "}
              {productionPermanentlyBlocked ? "Yes" : "No"}
            </p>''',
        "Maintenance availability summary",
    )

    frontend = replace_pattern(
        frontend,
        re.compile(
            r'          \{!clearEnabled && \([\s\S]*?\n          \)\}',
            re.M,
        ),
        '''          {!clearEnabled && (
            <div className="warning-box">
              {productionPermanentlyBlocked
                ? "This operation is permanently blocked in production and cannot be enabled with an environment variable."
                : "This non-production reset is disabled. Set ALLOW_CLEAR_BUSINESS_DATA=true only inside a disposable test environment."}
            </div>
          )}''',
        "Maintenance disabled notice",
    )

    frontend = replace_exact(
        frontend,
        '''            Do not use this after real business operation has started unless you
             are intentionally resetting the whole system across all stores.''',
        '''            Never use this against live business data. Production is permanently
             blocked; only disposable local or staging test data may be reset.''',
        "Maintenance protected-data warning",
    )

    frontend = replace_exact(
        frontend,
        '''          If the business has already started real operation, do not clear these
           records unless the owner has approved a full reset and a backup has
           been made.''',
        '''          Live business records cannot be cleared through this page. The backend
           permits only an explicitly enabled non-production test environment.''',
        "Maintenance ledger warning",
    )

    frontend = replace_pattern(
        frontend,
        re.compile(
            r'      <div className="section-card" style=\{\{ marginTop: "18px" \}\}>\n        <h2>Clear Test / Business Data</h2>[\s\S]*?\n      </div>\n    </div>',
            re.M,
        ),
        '''      <div className="section-card" style={{ marginTop: "18px" }}>
        <h2>Reset Disposable Non-Production Test Data</h2>

        <p>
          The backend permanently blocks production. In a disposable test
          environment, enter the System Administrator password and exact
          confirmation text.
        </p>

        <div className="error-box">
          This reset is system-wide across all three workspaces and uses only
          transaction-compatible DELETE operations. A failure must roll back every
          cleared table.
        </div>

        <div className="warning-box">
          Type exactly: <strong>{requiredConfirmation}</strong>
        </div>

        {productionPermanentlyBlocked ? (
          <div className="error-box">
            Production reset is permanently blocked. No destructive form is
            available in this environment.
          </div>
        ) : (
          <form onSubmit={clearBusinessData}>
            <label>System Administrator Password</label>
            <input
              type="password"
              value={systemAdminPassword}
              onChange={(event) => setSystemAdminPassword(event.target.value)}
              placeholder="Enter System Administrator password"
            />

            <label>Confirmation Text</label>
            <input
              type="text"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={requiredConfirmation}
            />

            <button type="submit" className="danger-button" disabled={!canClear}>
              {clearing ? "Resetting..." : "Reset Non-Production Test Data"}
            </button>
          </form>
        )}
      </div>
    </div>''',
        "Maintenance reset form",
    )

    service = r'''function normalizeEnvironment(environment = process.env) {
  return String(environment.NODE_ENV || "development").trim().toLowerCase();
}

function resolveMaintenanceClearAvailability(environment = process.env) {
  const nodeEnvironment = normalizeEnvironment(environment);

  if (nodeEnvironment === "production") {
    return {
      enabled: false,
      production_permanently_blocked: true,
      environment: nodeEnvironment,
      code: "PRODUCTION_BUSINESS_DATA_CLEAR_PERMANENTLY_BLOCKED",
      message:
        "System-wide business-data clearing is permanently blocked in production. Restore or correct production data only through the approved backup and migration procedures.",
    };
  }

  const enabled =
    String(environment.ALLOW_CLEAR_BUSINESS_DATA || "")
      .trim()
      .toLowerCase() === "true";

  return {
    enabled,
    production_permanently_blocked: false,
    environment: nodeEnvironment,
    code: enabled
      ? "NON_PRODUCTION_TEST_RESET_ENABLED"
      : "NON_PRODUCTION_TEST_RESET_DISABLED",
    message: enabled
      ? "Transactional non-production test reset is enabled."
      : "Non-production test reset is disabled. Set ALLOW_CLEAR_BUSINESS_DATA=true only in a disposable test environment.",
  };
}

function safeTableName(tableName) {
  const name = String(tableName || "").trim();
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    const error = new Error("Unsafe maintenance table name.");
    error.code = "UNSAFE_MAINTENANCE_TABLE";
    throw error;
  }
  return `\`${name}\``;
}

async function deleteTableRows(connection, tableName) {
  const [result] = await connection.query(
    `DELETE FROM ${safeTableName(tableName)}`
  );
  return {
    table: tableName,
    method: "DELETE",
    status: "cleared",
    deleted_rows: Number(result.affectedRows || 0),
  };
}

async function clearTablesTransactionally(
  connection,
  tableNames,
  { afterDelete = null, beforeCommit = null } = {}
) {
  let transactionStarted = false;
  let foreignKeysDisabled = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    foreignKeysDisabled = true;

    const clearResults = [];
    for (let index = 0; index < tableNames.length; index += 1) {
      const tableName = tableNames[index];
      const result = await deleteTableRows(connection, tableName);
      clearResults.push(result);

      if (afterDelete) {
        await afterDelete({
          connection,
          tableName,
          index,
          result,
          clearResults,
        });
      }
    }

    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    foreignKeysDisabled = false;

    const beforeCommitResult = beforeCommit
      ? await beforeCommit({ connection, clearResults })
      : null;

    await connection.commit();
    transactionStarted = false;

    return {
      clear_results: clearResults,
      before_commit_result: beforeCommitResult,
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        error.rollback_error = rollbackError.message;
      }
    }
    throw error;
  } finally {
    if (foreignKeysDisabled) {
      try {
        await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      } catch (resetError) {
        console.error(
          "Failed to restore foreign-key checks after maintenance reset:",
          resetError.message
        );
      }
    }
  }
}

module.exports = {
  clearTablesTransactionally,
  deleteTableRows,
  resolveMaintenanceClearAvailability,
  safeTableName,
};
'''

    test = r'''const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "../..");
const {
  resolveMaintenanceClearAvailability,
} = require("../services/maintenanceResetService");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("production business-data clearing is permanently blocked", () => {
  const availability = resolveMaintenanceClearAvailability({
    NODE_ENV: "production",
    ALLOW_CLEAR_BUSINESS_DATA: "true",
  });

  assert.equal(availability.enabled, false);
  assert.equal(availability.production_permanently_blocked, true);
  assert.equal(
    availability.code,
    "PRODUCTION_BUSINESS_DATA_CLEAR_PERMANENTLY_BLOCKED"
  );
});

test("non-production reset requires explicit opt-in", () => {
  assert.equal(
    resolveMaintenanceClearAvailability({ NODE_ENV: "development" }).enabled,
    false
  );
  assert.equal(
    resolveMaintenanceClearAvailability({
      NODE_ENV: "development",
      ALLOW_CLEAR_BUSINESS_DATA: "true",
    }).enabled,
    true
  );
});

test("maintenance reset contains no implicit-commit clearing operations", () => {
  const route = read("backend/routes/maintenanceRoutes.js");
  const service = read("backend/services/maintenanceResetService.js");
  const frontend = read("frontend/src/pages/MaintenancePage.jsx");

  assert.doesNotMatch(route, /TRUNCATE\s+TABLE/i);
  assert.doesNotMatch(route, /ALTER\s+TABLE/i);
  assert.doesNotMatch(service, /TRUNCATE\s+TABLE/i);
  assert.doesNotMatch(service, /ALTER\s+TABLE/i);
  assert.match(service, /DELETE FROM/);
  assert.match(service, /beginTransaction/);
  assert.match(service, /rollback/);
  assert.match(service, /SET FOREIGN_KEY_CHECKS = 1/);
  assert.match(route, /PRODUCTION_BUSINESS_DATA_CLEAR_PERMANENTLY_BLOCKED/);
  assert.match(route, /clearTablesTransactionally/);
  assert.match(frontend, /Production reset is permanently blocked/);
  assert.match(frontend, /Reset Non-Production Test Data/);
  assert.doesNotMatch(
    frontend,
    /Railway[\s\S]{0,120}ALLOW_CLEAR_BUSINESS_DATA must be set to true/i
  );
});
'''

    route_path.write_text(route, encoding="utf-8")
    frontend_path.write_text(frontend, encoding="utf-8")
    service_path.write_text(service, encoding="utf-8")
    test_path.write_text(test, encoding="utf-8")


if __name__ == "__main__":
    main()
