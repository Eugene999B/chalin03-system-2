function normalizeEnvironment(environment = process.env) {
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
