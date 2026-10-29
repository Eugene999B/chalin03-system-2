const express = require("express");
const { recover } = require("./installmentLegacyRecoveryMiddlewareV13");
const installmentRoutes = require("./installmentDeepDeleteRoutesV12");

const router = express.Router();
router.use(recover);
router.use(installmentRoutes);

module.exports = router;
