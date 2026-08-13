"use strict";

// Compatibility entrypoint. The canonical runtime implementation lives one
// level up so route imports and direct service imports can never diverge.
module.exports = require("../backupSafetyService.js");
