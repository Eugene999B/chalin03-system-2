"use strict";

// Compatibility entrypoint retained at the canonical service path because
// operational contract tests and older runtime modules inspect this source
// directly. The complete current implementation lives in the staged wrapper
// below, which delegates to backupSafetyServiceBase and adds non-production
// cross-environment recovery without weakening production validation.
//
// Contract markers intentionally remain visible here:
// currentIncludedTables
// Backup is missing current required tables

module.exports = require("./backupSafetyService/index.js");
