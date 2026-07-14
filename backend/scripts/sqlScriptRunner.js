function stripLineComments(statement) {
  return statement
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

function splitSqlStatements(sql) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const line of String(sql || "").split(/\r?\n/)) {
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
  splitSqlStatements,
  executeSqlScript,
};
