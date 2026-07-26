function quoteIdentifier(value) {
  return `\`${String(value || "").replaceAll("`", "``")}\``;
}

async function loadForeignKeyDependencies(
  connection,
  parentTable,
  parentId,
  parentColumn = "id"
) {
  const [references] = await connection.query(
    `SELECT DISTINCT
       kcu.TABLE_NAME AS table_name,
       kcu.COLUMN_NAME AS column_name,
       COALESCE(rc.DELETE_RULE, 'RESTRICT') AS delete_rule
     FROM information_schema.KEY_COLUMN_USAGE kcu
     LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      AND rc.TABLE_NAME = kcu.TABLE_NAME
     WHERE kcu.REFERENCED_TABLE_SCHEMA = DATABASE()
       AND kcu.REFERENCED_TABLE_NAME = ?
       AND kcu.REFERENCED_COLUMN_NAME = ?
     ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME`,
    [parentTable, parentColumn]
  );

  const dependencies = [];

  for (const reference of references) {
    const tableName = String(reference.table_name || "");
    const columnName = String(reference.column_name || "");

    if (!tableName || !columnName) continue;

    const [rows] = await connection.query(
      `SELECT COUNT(*) AS total_count
       FROM ${quoteIdentifier(tableName)}
       WHERE ${quoteIdentifier(columnName)} = ?`,
      [parentId]
    );

    dependencies.push({
      table_name: tableName,
      column_name: columnName,
      delete_rule: String(reference.delete_rule || "RESTRICT").toUpperCase(),
      count: Number(rows[0]?.total_count || 0),
    });
  }

  return dependencies;
}

function findBlockingDependencies(dependencies, removableTables = []) {
  const removable = new Set(removableTables.map((value) => String(value)));

  return (dependencies || []).filter((dependency) => {
    if (Number(dependency.count || 0) < 1) return false;
    if (removable.has(String(dependency.table_name))) return false;
    return ["RESTRICT", "NO ACTION"].includes(
      String(dependency.delete_rule || "RESTRICT").toUpperCase()
    );
  });
}

function summarizeDependencies(dependencies) {
  return (dependencies || [])
    .filter((dependency) => Number(dependency.count || 0) > 0)
    .map((dependency) => ({
      table: dependency.table_name,
      records: Number(dependency.count || 0),
      delete_rule: dependency.delete_rule,
    }));
}

module.exports = {
  loadForeignKeyDependencies,
  findBlockingDependencies,
  summarizeDependencies,
};
