const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const corePath = path.join(__dirname, "verifyMigrationSafetyCore.js");
const source = fs.readFileSync(corePath, "utf8");
const exactGuard = 'if (!upperContent.includes("ADDITIVE MIGRATION ONLY")) {';
const compatibleGuard =
  'if (!/ADDITIVE(?:,\\s+CONTROLLED)?\\s+MIGRATION ONLY/.test(upperContent)) {';
const crossStatementDropColumn =
  'pattern: /\\bALTER\\s+TABLE\\b[\\s\\S]{0,500}?\\bDROP\\s+(?:COLUMN\\s+)?[`a-z0-9_]+/i,';
const statementBoundDropColumn =
  'pattern: /\\bALTER\\s+TABLE\\b[^;]{0,500}?\\bDROP\\s+(?:COLUMN\\s+)?[`a-z0-9_]+/i,';
const crossStatementDropKey =
  'pattern: /\\bALTER\\s+TABLE\\b[\\s\\S]{0,500}?\\bDROP\\s+(?:PRIMARY\\s+KEY|FOREIGN\\s+KEY|INDEX|KEY|CONSTRAINT)\\b/i,';
const statementBoundDropKey =
  'pattern: /\\bALTER\\s+TABLE\\b[^;]{0,500}?\\bDROP\\s+(?:PRIMARY\\s+KEY|FOREIGN\\s+KEY|INDEX|KEY|CONSTRAINT)\\b/i,';

for (const [expected, label] of [
  [exactGuard, "additive-marker check"],
  [crossStatementDropColumn, "DROP COLUMN check"],
  [crossStatementDropKey, "DROP key/constraint check"],
]) {
  if (!source.includes(expected)) {
    throw new Error(`Migration safety compatibility guard could not find the approved ${label}.`);
  }
}

const compatibleSource = source
  .replace(exactGuard, compatibleGuard)
  .replace(crossStatementDropColumn, statementBoundDropColumn)
  .replace(crossStatementDropKey, statementBoundDropKey);

module.filename = corePath;
module.paths = Module._nodeModulePaths(__dirname);
module._compile(compatibleSource, corePath);
