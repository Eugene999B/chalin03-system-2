const express = require("express");

// Full-system backup, validation and restore are implemented exclusively by
// delegatedBackupRoutes.js for both the protected original owner and explicitly
// delegated System Administrators. Keeping this compatibility router empty avoids
// duplicate recovery engines with different table manifests or restore behavior.
module.exports = express.Router();
