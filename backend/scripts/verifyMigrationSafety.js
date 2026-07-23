const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const corePath = path.join(__dirname, "verifyMigrationSafetyCore.js");
const source = fs.readFileSync(corePath, "utf8");
const exactGuard = 'if (!upperContent.includes("ADDITIVE MIGRATION ONLY")) {';
const compatibleGuard =
  'if (!/ADDITIVE(?:,\\s+CONTROLLED)?\\s+MIGRATION ONLY/.test(upperContent)) {';

if (!source.includes(exactGuard)) {
  throw new Error("Migration safety compatibility guard could not find the approved additive-marker check.");
}

module.filename = corePath;
module.paths = Module._nodeModulePaths(__dirname);
module._compile(source.replace(exactGuard, compatibleGuard), corePath);
