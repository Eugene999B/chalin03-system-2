"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeLegacyInlinePreparedStatements,
  splitSqlStatements,
} = require("../scripts/sqlScriptRunner");

test("legacy PREPARE EXECUTE DEALLOCATE triplet is normalized without enabling arbitrary multiStatements", () => {
  const source = [
    "SET @sql := 'SELECT 1';",
    "PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;",
    "SELECT 2;",
  ].join("\n");

  const normalized = normalizeLegacyInlinePreparedStatements(source);
  assert.match(
    normalized,
    /PREPARE stmt FROM @sql;\nEXECUTE stmt;\nDEALLOCATE PREPARE stmt;/
  );

  assert.deepEqual(splitSqlStatements(source), [
    "SET @sql := 'SELECT 1'",
    "PREPARE stmt FROM @sql",
    "EXECUTE stmt",
    "DEALLOCATE PREPARE stmt",
    "SELECT 2",
  ]);
});

test("normalizer is deliberately narrow and does not split unrelated same-line SQL", () => {
  const source = "SELECT 1; SELECT 2;";
  assert.equal(normalizeLegacyInlinePreparedStatements(source), source);
  assert.deepEqual(splitSqlStatements(source), ["SELECT 1; SELECT 2"]);
});

test("custom DELIMITER procedure bodies keep their internal semicolons", () => {
  const source = [
    "DELIMITER $$",
    "CREATE PROCEDURE p()",
    "BEGIN",
    "  SELECT 1;",
    "  SELECT 2;",
    "END$$",
    "DELIMITER ;",
    "CALL p();",
  ].join("\n");

  const statements = splitSqlStatements(source);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /CREATE PROCEDURE p\(\)[\s\S]*SELECT 1;[\s\S]*SELECT 2;/);
  assert.equal(statements[1], "CALL p()" );
});
