function stripLineComments(statement) {
  return statement
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

function normalizeLegacyInlinePreparedStatements(sql) {
  // A small set of historical additive migrations format a dynamic-SQL
  // PREPARE / EXECUTE / DEALLOCATE triplet on one physical line. The safe
  // line-oriented runner intentionally does not enable MySQL multiStatements,
  // so normalize only that exact legacy shape into separate physical lines.
  // SQL semantics remain unchanged and arbitrary multi-statement input is not
  // enabled.
  return String(sql || "").replace(
    /(PREPARE\s+([A-Za-z0-9_]+)\s+FROM\s+[^;\r\n]+;)\s*(EXECUTE\s+\2\s*;)\s*(DEALLOCATE\s+PREPARE\s+\2\s*;)/gi,
    "$1\n$3\n$4"
  );
}

function splitSqlStatements(sql) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  const normalizedSql = normalizeLegacyInlinePreparedStatements(sql);

  for (const line of normalizedSql.split(/\r?\n/)) {
    const delimiterMatch = line.trim().match(/^DELIMITER\s+(.+)$/i);
    if (delimiterMatch) {
      if (stripLineComments(buffer)) {
        statements.push(buffer.trim());
        buffer = "";
      }
      delimiter = delimiterMatch[1];
      continue;
    }

    buffer += `${line}\n`;
    const trimmed = buffer.trimEnd();
    if (trimmed.endsWith(delimiter)) {
      const statement = trimmed.slice(0, -delimiter.length).trim();
      if (stripLineComments(statement)) {
        statements.push(statement);
      }
      buffer = "";
    }
  }

  if (stripLineComments(buffer)) {
    statements.push(buffer.trim());
  }

  return statements;
}

async function executeSqlScript(connection, sql, label = "SQL script") {
  const results = [];
  const statements = splitSqlStatements(sql);

  for (const statement of statements) {
    try {
      const [rows] = await connection.query(statement);
      if (Array.isArray(rows)) {
        results.push(rows);
      }
    } catch (error) {
      error.message = `${label}: ${error.message}`;
      throw error;
    }
  }

  return results;
}

module.exports = {
  normalizeLegacyInlinePreparedStatements,
  splitSqlStatements,
  executeSqlScript,
};
